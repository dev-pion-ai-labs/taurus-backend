import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma';
import { AiService } from '../../ai';
import { TemplateService } from '../template/template.service';
import { TemplateGeneratorService } from '../template/template-generator.service';
import { PaginatedResponseDto } from '../../common';
import { ConsultationScope, QuestionSection, Prisma } from '@prisma/client';
import type {
  AdaptiveQuestionContext,
  ScopedDepartmentContext,
  ScopedWorkflowContext,
} from '../../ai/prompts/adaptive-question.prompt';
import type { StartSessionDto } from './dto/start-session.dto';
import type { ListSessionsQueryDto } from './dto/list-sessions-query.dto';

/**
 * Hard cap per scope — narrower scopes need fewer questions.
 * Org-level keeps the original 20-question depth; scoped sessions are tighter
 * because there's less ground to cover and respondents have less patience.
 */
const MAX_QUESTIONS_BY_SCOPE: Record<ConsultationScope, number> = {
  ORG: 20,
  DEPARTMENT: 12,
  WORKFLOW: 8,
};

/**
 * Minimum total questions a scoped session must reach before it's allowed
 * to complete. Guards against a race where the user answers all 3 pre-gen
 * starter questions before the async personalized-batch topup arrives —
 * without this, `remaining=0` would prematurely mark the session COMPLETED
 * with only 3 questions. When this floor is hit, submitAnswer force-generates
 * more questions synchronously before allowing completion.
 *
 * Org-scoped sessions don't need this guard: first-time ORG seeds 6-8 BASE
 * template questions immediately, and ORG follow-up seeds 8-10 from the
 * cached pregen — neither path can reach `remaining=0` after only 3 answers.
 */
const MIN_QUESTIONS_BEFORE_COMPLETE: Partial<Record<ConsultationScope, number>> = {
  DEPARTMENT: 8,
  WORKFLOW: 5,
};

/** Buffer that triggers more adaptive questions, sized to the scope's cap. */
const BUFFER_THRESHOLD_BY_SCOPE: Record<ConsultationScope, number> = {
  ORG: 3,
  DEPARTMENT: 2,
  WORKFLOW: 1,
};

/** How long to cache org context in memory (ms). */
const CONTEXT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Maximum age of cached org-followup starter questions before we treat them as
 * stale and fall back to live generation. Long enough to cover the typical
 * gap between consultations; short enough that a 6-month-old cache built
 * against an org's outdated profile won't be used.
 */
const ORG_PREGEN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** Public so the queue processor can apply the same per-scope buffer. */
export function getMaxQuestionsForScope(scope: ConsultationScope): number {
  return MAX_QUESTIONS_BY_SCOPE[scope];
}
export function getBufferThresholdForScope(scope: ConsultationScope): number {
  return BUFFER_THRESHOLD_BY_SCOPE[scope];
}

/**
 * Shape returned to the frontend for a "next question". Wraps both template
 * questions (which already have a `.question` relation) and adaptive questions
 * (which need a synthesized one).
 */
function normalizeNextQuestion(
  raw:
    | (Prisma.SessionQuestionGetPayload<{ include: { question: true } }> | null),
) {
  if (!raw) return null;
  return {
    ...raw,
    question: raw.question ?? {
      id: raw.id,
      templateId: null,
      questionText: raw.adaptiveText,
      questionType: raw.adaptiveType,
      options: raw.adaptiveOptions,
      isRequired: true,
      orderIndex: raw.orderIndex,
      metadata: null,
      createdAt: raw.createdAt,
    },
  };
}

interface CachedOrgContext {
  organization: { name: string; industry: string; size: string | null };
  onboarding: {
    businessDescription: string;
    revenueStreams: string;
    challenges: string[];
    tools: string[];
    goals: string[];
  };
  scrapedInsights?: AdaptiveQuestionContext['scrapedInsights'];
  expiresAt: number;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly orgContextCache = new Map<string, CachedOrgContext>();

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private templateService: TemplateService,
    private templateGeneratorService: TemplateGeneratorService,
    @InjectQueue('analysis') private analysisQueue: Queue,
    @InjectQueue('template-generation')
    private templateQueue: Queue,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  //  Start Session
  // ──────────────────────────────────────────────────────────────────────

  async startSession(userId: string, orgId: string, dto: StartSessionDto = {}) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const scope = dto.scope ?? ConsultationScope.ORG;
    await this.validateScopeOwnership(orgId, scope, dto.departmentId, dto.workflowId);

    // Base template is required by the schema (baseTemplateId is non-nullable)
    // but its questions are only loaded for an org's FIRST-EVER ORG-level
    // consultation. Scoped sessions and follow-up org sessions skip the
    // BASE intro questions entirely — every question is AI-generated and
    // grounded in either the scope record or the prior session's answers.
    const baseTemplate = await this.templateService.getBaseTemplate();
    const isScoped = scope !== ConsultationScope.ORG;

    // For ORG scope, detect whether this org has ever completed a
    // consultation before. If yes, we treat it like a scoped session
    // (skip BASE, hydrate AI prompt with prior answers).
    let isFollowUpOrg = false;
    if (!isScoped) {
      const priorCompletedCount = await this.prisma.consultationSession.count({
        where: {
          organizationId: orgId,
          scope: ConsultationScope.ORG,
          status: 'COMPLETED',
        },
      });
      isFollowUpOrg = priorCompletedCount > 0;
    }
    const skipBase = isScoped || isFollowUpOrg;

    const session = await this.prisma.consultationSession.create({
      data: {
        organizationId: orgId,
        userId,
        status: skipBase ? 'PENDING_TEMPLATE' : 'IN_PROGRESS',
        scope,
        departmentId: scope === ConsultationScope.ORG ? null : dto.departmentId ?? null,
        workflowId: scope === ConsultationScope.WORKFLOW ? dto.workflowId ?? null : null,
        baseTemplateId: baseTemplate.id,
        industryTemplateId: null,
      },
    });

    let coreCount = 0;
    if (!skipBase) {
      // First-ever org consultation: load BASE template's predefined org-wide
      // questions immediately. User sees these while the personalized batch
      // generates in background.
      let orderIndex = 0;
      const coreQuestions = baseTemplate.questions.map((q) => ({
        sessionId: session.id,
        questionId: q.id,
        section: 'BASE' as const,
        orderIndex: orderIndex++,
      }));
      await this.prisma.sessionQuestion.createMany({ data: coreQuestions });
      coreCount = coreQuestions.length;
    }

    // For scoped sessions AND for follow-up ORG sessions, check if pre-gen
    // starter questions are cached on the entity record. If so, insert them
    // as the first session questions and skip the PENDING wait — the user
    // lands directly on Q1.
    let preGenCount = 0;
    if (isScoped || isFollowUpOrg) {
      preGenCount = await this.consumePreGeneratedQuestions(
        session.id,
        scope,
        orgId,
        dto.departmentId,
        dto.workflowId,
      );
      if (preGenCount > 0) {
        // We already have starter questions; flip the session straight to
        // IN_PROGRESS so the frontend skips the waiting screen.
        await this.prisma.consultationSession.update({
          where: { id: session.id },
          data: { status: 'IN_PROGRESS' },
        });
      }
    }

    // Queue personalized question generation. When pre-gen seeded the start,
    // the processor will produce a smaller top-up batch (driven by
    // PREGEN_TOPUP_BATCH_BY_SCOPE in the processor). Otherwise it produces
    // the full initial batch and flips PENDING → IN_PROGRESS.
    await this.templateQueue.add('generate-personalized-batch', {
      sessionId: session.id,
      organizationId: orgId,
    });

    this.logger.log(
      `Session ${session.id} started (scope=${scope}, followUp=${isFollowUpOrg}, preGen=${preGenCount}) with ${coreCount} core questions; personalized batch queued`,
    );

    return this.getSession(session.id, userId);
  }

  /**
   * Reads cached starter questions off the relevant entity record and inserts
   * them as SessionQuestion rows. Returns the count inserted (0 if none /
   * stale / missing).
   *
   * Sources by scope:
   *  - DEPARTMENT → Department.preGeneratedQuestions (set when the dept was created)
   *  - WORKFLOW   → Workflow.preGeneratedQuestions (set when the workflow was created)
   *  - ORG (follow-up only) → Organization.preGeneratedQuestions (set after the
   *     prior session's report finished generating)
   *
   * For ORG, the cache is wrapped in an envelope `{ generatedFor, questions }`
   * so we can verify it was generated against the most recent completed
   * session. Stale caches (older than ORG_PREGEN_MAX_AGE_MS, or generated
   * against an older session) are skipped — live generation kicks in instead.
   * Successfully consumed ORG caches are cleared so they aren't double-used.
   */
  private async consumePreGeneratedQuestions(
    sessionId: string,
    scope: ConsultationScope,
    organizationId: string,
    departmentId?: string,
    workflowId?: string,
  ): Promise<number> {
    type PreGenQuestion = {
      questionText: string;
      questionType: string;
      options: string[] | null;
    };

    let questions: PreGenQuestion[] = [];

    if (scope === ConsultationScope.DEPARTMENT && departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: departmentId },
        select: { preGeneratedQuestions: true },
      });
      const raw = dept?.preGeneratedQuestions;
      if (Array.isArray(raw)) questions = raw as unknown as PreGenQuestion[];
    } else if (scope === ConsultationScope.WORKFLOW && workflowId) {
      const wf = await this.prisma.workflow.findUnique({
        where: { id: workflowId },
        select: { preGeneratedQuestions: true },
      });
      const raw = wf?.preGeneratedQuestions;
      if (Array.isArray(raw)) questions = raw as unknown as PreGenQuestion[];
    } else if (scope === ConsultationScope.ORG) {
      questions = await this.consumeOrgPreGenIfFresh(organizationId, sessionId);
    }

    if (questions.length === 0) return 0;

    await this.prisma.sessionQuestion.createMany({
      data: questions.map((q, i) => ({
        sessionId,
        section: 'PERSONALIZED' as const,
        orderIndex: i,
        isAdaptive: true,
        adaptiveText: q.questionText,
        adaptiveType: q.questionType,
        adaptiveOptions: (q.options as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      })),
    });

    return questions.length;
  }

  /**
   * Returns ORG starter questions if the cache is fresh AND generated against
   * the most recent completed ORG session. Clears the cache on the way out so
   * a single pre-gen is never consumed twice.
   */
  private async consumeOrgPreGenIfFresh(
    organizationId: string,
    currentSessionId: string,
  ): Promise<
    Array<{ questionText: string; questionType: string; options: string[] | null }>
  > {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { preGeneratedQuestions: true, preGeneratedAt: true },
    });

    const envelope = org?.preGeneratedQuestions as
      | { generatedFor?: string; questions?: unknown }
      | null
      | undefined;
    const generatedAt = org?.preGeneratedAt;

    if (!envelope || !Array.isArray(envelope.questions) || !generatedAt) {
      return [];
    }

    // Stale by age?
    if (Date.now() - generatedAt.getTime() > ORG_PREGEN_MAX_AGE_MS) {
      this.logger.log(
        `[org:${organizationId}] Pre-gen cache stale (age > ${ORG_PREGEN_MAX_AGE_MS}ms), skipping`,
      );
      // Clear the stale cache so it doesn't sit around — saves the next
      // consume from re-checking.
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { preGeneratedQuestions: Prisma.JsonNull, preGeneratedAt: null },
      });
      return [];
    }

    // Stale by source: was this cache generated against the actual most
    // recent completed session? If a newer completed session exists, the
    // cache was built on outdated context — skip it.
    const latestCompleted = await this.prisma.consultationSession.findFirst({
      where: {
        organizationId,
        scope: ConsultationScope.ORG,
        status: 'COMPLETED',
        id: { not: currentSessionId },
      },
      orderBy: { completedAt: 'desc' },
      select: { id: true },
    });
    if (latestCompleted && latestCompleted.id !== envelope.generatedFor) {
      this.logger.log(
        `[org:${organizationId}] Pre-gen cache out of date (generatedFor=${envelope.generatedFor} vs latest=${latestCompleted.id}), skipping`,
      );
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { preGeneratedQuestions: Prisma.JsonNull, preGeneratedAt: null },
      });
      return [];
    }

    // Fresh — clear the cache so it can't be re-consumed by a sibling start.
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { preGeneratedQuestions: Prisma.JsonNull, preGeneratedAt: null },
    });

    return envelope.questions as Array<{
      questionText: string;
      questionType: string;
      options: string[] | null;
    }>;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Compile Session Questions (legacy — kept for template generator compat)
  // ──────────────────────────────────────────────────────────────────────

  async compileSessionQuestions(
    sessionId: string,
    baseTemplate: { questions: { id: string; orderIndex: number }[] },
    industryTemplate?: { questions: { id: string; orderIndex: number }[] },
  ) {
    let orderIndex = 0;

    const baseQuestions = baseTemplate.questions.map((q) => ({
      sessionId,
      questionId: q.id,
      section: 'BASE' as const,
      orderIndex: orderIndex++,
    }));

    const industryQuestions = (industryTemplate?.questions || []).map((q) => ({
      sessionId,
      questionId: q.id,
      section: 'INDUSTRY' as const,
      orderIndex: orderIndex++,
    }));

    await this.prisma.sessionQuestion.createMany({
      data: [...baseQuestions, ...industryQuestions],
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Append Adaptive Questions
  // ──────────────────────────────────────────────────────────────────────

  async appendAdaptiveQuestions(
    sessionId: string,
    questions: Array<{
      questionText: string;
      questionType: string;
      options: string[] | null;
    }>,
    section: QuestionSection,
  ) {
    // Fetch scope + last orderIndex + count in parallel
    const [session, lastQ, currentCount] = await Promise.all([
      this.prisma.consultationSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { scope: true },
      }),
      this.prisma.sessionQuestion.findFirst({
        where: { sessionId },
        orderBy: { orderIndex: 'desc' },
        select: { orderIndex: true },
      }),
      this.prisma.sessionQuestion.count({ where: { sessionId } }),
    ]);

    let orderIndex = (lastQ?.orderIndex ?? -1) + 1;

    const max = getMaxQuestionsForScope(session.scope);
    const slotsLeft = max - currentCount;
    const toAdd = questions.slice(0, slotsLeft);

    if (toAdd.length === 0) {
      this.logger.log(
        `Session ${sessionId} at max questions (${max}, scope=${session.scope}), skipping append`,
      );
      return 0;
    }

    await this.prisma.sessionQuestion.createMany({
      data: toAdd.map((q) => ({
        sessionId,
        section,
        orderIndex: orderIndex++,
        isAdaptive: true,
        adaptiveText: q.questionText,
        adaptiveType: q.questionType,
        adaptiveOptions: q.options ?? Prisma.JsonNull,
      })),
    });

    this.logger.log(
      `Appended ${toAdd.length} ${section} questions to session ${sessionId}`,
    );
    return toAdd.length;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Get Session
  // ──────────────────────────────────────────────────────────────────────

  async getSession(sessionId: string, userId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: true },
        },
        organization: { include: { industry: true } },
        department: { select: { id: true, name: true } },
        workflow: { select: { id: true, name: true, departmentId: true } },
      },
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId)
      throw new ForbiddenException('Not your session');

    return session;
  }

  async getSessionWithReport(sessionId: string, userId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: true },
        },
        organization: { include: { industry: true } },
        department: { select: { id: true, name: true } },
        workflow: { select: { id: true, name: true, departmentId: true } },
        report: {
          select: { id: true, status: true },
        },
      },
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId)
      throw new ForbiddenException('Not your session');

    return session;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Get Current Question (normalized for adaptive + template questions)
  // ──────────────────────────────────────────────────────────────────────

  async getCurrentQuestion(sessionId: string, userId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId)
      throw new ForbiddenException('Not your session');

    if (session.status !== 'IN_PROGRESS') {
      const [total, answered] = await Promise.all([
        this.prisma.sessionQuestion.count({ where: { sessionId } }),
        this.prisma.sessionQuestion.count({
          where: { sessionId, answeredAt: { not: null } },
        }),
      ]);
      return {
        status: session.status,
        question: null,
        progress: { answered, total },
      };
    }

    const nextQuestion = await this.prisma.sessionQuestion.findFirst({
      where: {
        sessionId,
        answeredAt: null,
        skipped: false,
      },
      orderBy: { orderIndex: 'asc' },
      include: { question: true },
    });

    const total = await this.prisma.sessionQuestion.count({
      where: { sessionId },
    });
    const answered = await this.prisma.sessionQuestion.count({
      where: { sessionId, answeredAt: { not: null } },
    });

    // Normalize: if adaptive, synthesize the `question` field so the frontend
    // sees the same shape regardless of question source.
    const normalized = nextQuestion
      ? {
          ...nextQuestion,
          question: nextQuestion.question ?? {
            id: nextQuestion.id,
            templateId: null,
            questionText: nextQuestion.adaptiveText,
            questionType: nextQuestion.adaptiveType,
            options: nextQuestion.adaptiveOptions,
            isRequired: true,
            orderIndex: nextQuestion.orderIndex,
            metadata: null,
            createdAt: nextQuestion.createdAt,
          },
        }
      : null;

    return {
      status: session.status,
      question: normalized,
      progress: { answered, total },
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Submit Answer
  // ──────────────────────────────────────────────────────────────────────

  async submitAnswer(
    sessionId: string,
    userId: string,
    sessionQuestionId: string,
    value: string | string[] | number,
  ) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId)
      throw new ForbiddenException('Not your session');
    if (session.status !== 'IN_PROGRESS')
      throw new BadRequestException('Session is not in progress');

    // Look up by SessionQuestion id (works for both template and adaptive)
    const sessionQuestion = await this.prisma.sessionQuestion.findUnique({
      where: { id: sessionQuestionId },
      include: { question: true },
    });
    if (!sessionQuestion || sessionQuestion.sessionId !== sessionId)
      throw new NotFoundException('Question not found in session');
    if (sessionQuestion.answeredAt)
      throw new BadRequestException('Question already answered');

    // Resolve question type and options (adaptive vs template)
    const questionType = sessionQuestion.isAdaptive
      ? sessionQuestion.adaptiveType!
      : sessionQuestion.question!.questionType;
    const options = sessionQuestion.isAdaptive
      ? sessionQuestion.adaptiveOptions
      : sessionQuestion.question!.options;

    this.validateAnswer(questionType, value, options);

    // Save answer + fetch all session questions in parallel (1 write + 1 read instead of 1 write + 3 reads)
    const [, allQuestions] = await Promise.all([
      this.prisma.sessionQuestion.update({
        where: { id: sessionQuestion.id },
        data: { answer: { value }, answeredAt: new Date() },
      }),
      this.prisma.sessionQuestion.findMany({
        where: { sessionId },
        orderBy: { orderIndex: 'asc' },
        include: { question: true },
      }),
    ]);

    // Derive remaining, total, and next question in memory — zero additional DB calls
    const totalQuestions = allQuestions.length;
    // Exclude the question we just answered from "remaining"
    const unanswered = allQuestions.filter(
      (q) => q.id !== sessionQuestion.id && !q.answeredAt && !q.skipped,
    );
    const remaining = unanswered.length;
    const nextRaw = unanswered[0] ?? null;

    // Queue adaptive generation when buffer is low but not empty.
    // Buffer + cap are scope-aware: scoped sessions are shorter overall.
    const scopeBuffer = getBufferThresholdForScope(session.scope);
    const scopeMax = getMaxQuestionsForScope(session.scope);
    if (remaining > 0 && remaining <= scopeBuffer && totalQuestions < scopeMax) {
      this.templateQueue
        .add('generate-adaptive-followup', {
          sessionId,
          organizationId: session.organizationId,
        })
        .catch((err) =>
          this.logger.warn(`Failed to queue adaptive generation: ${err.message}`),
        );
    }

    if (remaining === 0) {
      // Race-condition guard for scoped sessions: if the user answered all
      // pre-gen starters before the async personalized-batch topup arrived,
      // totalQuestions can be as low as 3. Try a synchronous fill first.
      const minBeforeComplete = MIN_QUESTIONS_BEFORE_COMPLETE[session.scope];
      if (minBeforeComplete && totalQuestions < minBeforeComplete) {
        await this.fillScopedSessionBeforeComplete(
          sessionId,
          session.organizationId,
          session.scope,
          totalQuestions,
        ).catch((err) =>
          this.logger.warn(
            `[${sessionId}] fillScopedSessionBeforeComplete threw: ${(err as Error).message}`,
          ),
        );
      }

      // BULLETPROOF FINAL RECHECK: by the time we get here, any of these
      // could have written new questions to the DB:
      //   - the async personalized-batch topup (BullMQ worker)
      //   - the adaptive-followup we may have queued earlier in this call
      //   - the synchronous fill above
      // If ANY unanswered question exists right now, return it instead of
      // completing. This guard makes premature completion impossible
      // regardless of which background job happened to win the race.
      const freshNext = await this.prisma.sessionQuestion.findFirst({
        where: { sessionId, answeredAt: null, skipped: false },
        orderBy: { orderIndex: 'asc' },
        include: { question: true },
      });
      if (freshNext) {
        const [freshTotal, freshAnswered] = await Promise.all([
          this.prisma.sessionQuestion.count({ where: { sessionId } }),
          this.prisma.sessionQuestion.count({
            where: { sessionId, answeredAt: { not: null } },
          }),
        ]);
        this.logger.log(
          `[${sessionId}] Recheck found unanswered Q${freshNext.orderIndex + 1} (total=${freshTotal}, answered=${freshAnswered}); returning instead of completing`,
        );
        return {
          status: 'IN_PROGRESS' as const,
          nextQuestion: normalizeNextQuestion(freshNext),
          progress: { answered: freshAnswered, total: freshTotal },
        };
      }

      const completedSession = await this.prisma.consultationSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      const report = await this.prisma.transformationReport.create({
        data: {
          sessionId: completedSession.id,
          organizationId: completedSession.organizationId,
          status: 'GENERATING',
        },
      });

      await this.analysisQueue.add('generate-report', {
        reportId: report.id,
        sessionId: completedSession.id,
        organizationId: completedSession.organizationId,
      });
      this.logger.log(
        `Session ${sessionId} completed, report ${report.id} generation queued`,
      );

      return { status: 'COMPLETED', nextQuestion: null };
    }

    // Normalize next question for frontend
    const nextQuestion = nextRaw
      ? {
          ...nextRaw,
          question: nextRaw.question ?? {
            id: nextRaw.id,
            templateId: null,
            questionText: nextRaw.adaptiveText,
            questionType: nextRaw.adaptiveType,
            options: nextRaw.adaptiveOptions,
            isRequired: true,
            orderIndex: nextRaw.orderIndex,
            metadata: null,
            createdAt: nextRaw.createdAt,
          },
        }
      : null;

    return {
      status: 'IN_PROGRESS' as const,
      nextQuestion,
      progress: { answered: totalQuestions - remaining, total: totalQuestions },
    };
  }

  /**
   * Synchronously generate more questions for a scoped session that ran out
   * before reaching the per-scope minimum. This happens when the user answers
   * the 3 pre-gen starter questions faster than the async personalized-batch
   * topup can arrive — without this guard, `submitAnswer` would mark the
   * session COMPLETED with only 3 questions.
   *
   * Returns the next unanswered question (normalized for the frontend) and
   * the new totals, or `{ added: 0 }` if the AI couldn't produce more — in
   * which case the caller falls through to graceful completion.
   */
  private async fillScopedSessionBeforeComplete(
    sessionId: string,
    organizationId: string,
    scope: ConsultationScope,
    currentTotal: number,
  ): Promise<{
    added: number;
    nextQuestion?: ReturnType<typeof normalizeNextQuestion>;
    answered: number;
    total: number;
  }> {
    this.logger.warn(
      `[${sessionId}] Scoped session would complete with only ${currentTotal} questions (scope=${scope}); force-generating to avoid premature completion`,
    );
    try {
      const ctx = await this.buildAdaptiveContext(sessionId, organizationId);
      // Use a smallish synchronous batch — the user is waiting on the submit
      // call, so we trade some latency for more questions. 4-5 lands the
      // session well above the floor without making the user wait too long.
      const questions = await this.aiService.generateInitialPersonalizedQuestions(
        ctx,
        { count: '4-5', minExpected: 3 },
      );
      const added = await this.appendAdaptiveQuestions(
        sessionId,
        questions,
        'PERSONALIZED',
      );
      if (added === 0) {
        return { added: 0, answered: currentTotal, total: currentTotal };
      }

      const [nextRaw, total, answered] = await Promise.all([
        this.prisma.sessionQuestion.findFirst({
          where: { sessionId, answeredAt: null, skipped: false },
          orderBy: { orderIndex: 'asc' },
          include: { question: true },
        }),
        this.prisma.sessionQuestion.count({ where: { sessionId } }),
        this.prisma.sessionQuestion.count({
          where: { sessionId, answeredAt: { not: null } },
        }),
      ]);

      this.logger.log(
        `[${sessionId}] Force-filled ${added} questions (total now ${total})`,
      );

      return {
        added,
        nextQuestion: normalizeNextQuestion(nextRaw),
        answered,
        total,
      };
    } catch (err) {
      this.logger.warn(
        `[${sessionId}] Force-fill failed; completing with ${currentTotal} questions: ${(err as Error).message}`,
      );
      return { added: 0, answered: currentTotal, total: currentTotal };
    }
  }

  private validateAnswer(
    questionType: string,
    value: string | string[] | number,
    options: unknown,
  ) {
    switch (questionType) {
      case 'TEXT':
        if (typeof value !== 'string' || !value.trim())
          throw new BadRequestException(
            'TEXT answer must be a non-empty string',
          );
        break;
      case 'SINGLE_CHOICE':
        if (typeof value !== 'string')
          throw new BadRequestException(
            'SINGLE_CHOICE answer must be a string',
          );
        if (options && Array.isArray(options) && !options.includes(value))
          throw new BadRequestException('Answer not in valid options');
        break;
      case 'MULTI_CHOICE':
        if (!Array.isArray(value))
          throw new BadRequestException('MULTI_CHOICE answer must be an array');
        if (options && Array.isArray(options)) {
          const invalid = value.filter((v) => !options.includes(v));
          if (invalid.length)
            throw new BadRequestException(
              `Invalid options: ${invalid.join(', ')}`,
            );
        }
        break;
      case 'SCALE':
        if (typeof value !== 'number' || value < 1 || value > 5)
          throw new BadRequestException('SCALE answer must be a number 1-5');
        break;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Build Adaptive Context (shared by queue processor)
  // ──────────────────────────────────────────────────────────────────────

  async buildAdaptiveContext(
    sessionId: string,
    organizationId: string,
  ): Promise<AdaptiveQuestionContext> {
    // Org + onboarding data doesn't change during a session — cache it
    const orgCtx = await this.getOrgContext(organizationId);

    // Fetch session (for scope) + answered questions in parallel.
    // Scope info is read off the session record — never inferred.
    const [session, answeredQuestions] = await Promise.all([
      this.prisma.consultationSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: {
          id: true,
          scope: true,
          departmentId: true,
          workflowId: true,
        },
      }),
      this.prisma.sessionQuestion.findMany({
        where: { sessionId, answeredAt: { not: null } },
        include: { question: true },
        orderBy: { orderIndex: 'asc' },
      }),
    ]);

    const { scopedDepartment, scopedWorkflow } = await this.loadScopedContext(
      session.scope,
      session.departmentId,
      session.workflowId,
    );

    // Follow-up detection: only meaningful for ORG-scope sessions. We pull the
    // most recent prior COMPLETED ORG session's answered questions to feed the
    // AI prompt as grounding ("here's what they told us last time, ask what's
    // changed"). Limited to last 20 to keep prompt size bounded.
    const { isFollowUp, priorOrgAnswers } =
      session.scope === ConsultationScope.ORG
        ? await this.loadPriorOrgAnswers(organizationId, session.id)
        : { isFollowUp: false, priorOrgAnswers: undefined };

    return {
      ...orgCtx,
      scope: session.scope,
      scopedDepartment,
      scopedWorkflow,
      isFollowUp,
      priorOrgAnswers,
      previousQA: answeredQuestions.map((sq) => ({
        question: sq.isAdaptive
          ? sq.adaptiveText!
          : sq.question!.questionText,
        questionType: sq.isAdaptive
          ? sq.adaptiveType!
          : sq.question!.questionType,
        answer: (sq.answer as any)?.value ?? sq.answer,
        section: sq.section,
      })),
    };
  }

  /**
   * Returns the most recent prior COMPLETED ORG-level consultation's answered
   * questions, capped at 20. Excludes the current session.
   */
  private async loadPriorOrgAnswers(
    organizationId: string,
    currentSessionId: string,
  ): Promise<{
    isFollowUp: boolean;
    priorOrgAnswers?: AdaptiveQuestionContext['priorOrgAnswers'];
  }> {
    const priorSession = await this.prisma.consultationSession.findFirst({
      where: {
        organizationId,
        scope: ConsultationScope.ORG,
        status: 'COMPLETED',
        id: { not: currentSessionId },
      },
      orderBy: { completedAt: 'desc' },
      select: { id: true, completedAt: true },
    });

    if (!priorSession) return { isFollowUp: false };

    const answers = await this.prisma.sessionQuestion.findMany({
      where: { sessionId: priorSession.id, answeredAt: { not: null } },
      include: { question: true },
      orderBy: { orderIndex: 'asc' },
      take: 20,
    });

    const completedAt = priorSession.completedAt
      ? priorSession.completedAt.toISOString()
      : '';

    return {
      isFollowUp: true,
      priorOrgAnswers: answers.map((sq) => ({
        question: sq.isAdaptive
          ? sq.adaptiveText!
          : sq.question!.questionText,
        answer: (sq.answer as any)?.value ?? sq.answer,
        completedAt,
      })),
    };
  }

  /**
   * Build an AdaptiveQuestionContext for entity-create-time pre-generation,
   * before any session exists. Same shape as buildAdaptiveContext but with
   * empty previousQA and isFollowUp=false. Used by the queue processor when
   * a new Department/Workflow is created so we can cache 2-3 starter
   * questions on the entity record.
   */
  async buildPrePopulationContext(
    scope: ConsultationScope,
    organizationId: string,
    departmentId?: string,
    workflowId?: string,
  ): Promise<AdaptiveQuestionContext> {
    const orgCtx = await this.getOrgContext(organizationId);
    const { scopedDepartment, scopedWorkflow } = await this.loadScopedContext(
      scope,
      departmentId ?? null,
      workflowId ?? null,
    );

    return {
      ...orgCtx,
      scope,
      scopedDepartment,
      scopedWorkflow,
      previousQA: [],
    };
  }

  /**
   * Build an AdaptiveQuestionContext for pre-generating starter questions for
   * the NEXT org-level follow-up consultation. Called by the queue processor
   * AFTER the source session's report has been generated. Pulls answers from
   * the specific source session rather than "most recent completed" so the
   * cache is unambiguously tied to a single completion.
   */
  async buildOrgFollowUpPreGenContext(
    organizationId: string,
    sourceSessionId: string,
  ): Promise<AdaptiveQuestionContext> {
    const orgCtx = await this.getOrgContext(organizationId);

    const source = await this.prisma.consultationSession.findUnique({
      where: { id: sourceSessionId },
      select: { completedAt: true, organizationId: true, scope: true },
    });
    if (
      !source ||
      source.organizationId !== organizationId ||
      source.scope !== ConsultationScope.ORG
    ) {
      throw new Error(
        `Source session ${sourceSessionId} missing or not an ORG session for org ${organizationId}`,
      );
    }

    const answers = await this.prisma.sessionQuestion.findMany({
      where: { sessionId: sourceSessionId, answeredAt: { not: null } },
      include: { question: true },
      orderBy: { orderIndex: 'asc' },
      take: 20,
    });

    const completedAt = source.completedAt
      ? source.completedAt.toISOString()
      : '';

    return {
      ...orgCtx,
      scope: ConsultationScope.ORG,
      isFollowUp: true,
      priorOrgAnswers: answers.map((sq) => ({
        question: sq.isAdaptive
          ? sq.adaptiveText!
          : sq.question!.questionText,
        answer: (sq.answer as any)?.value ?? sq.answer,
        completedAt,
      })),
      previousQA: [],
    };
  }

  /**
   * Loads the real Department/Workflow records for a scoped session. Returns
   * undefined for both when scope is ORG. Pulls only fields used by the prompt
   * preamble — no inference, no synthesis.
   */
  private async loadScopedContext(
    scope: ConsultationScope,
    departmentId: string | null,
    workflowId: string | null,
  ): Promise<{
    scopedDepartment?: ScopedDepartmentContext;
    scopedWorkflow?: ScopedWorkflowContext;
  }> {
    if (scope === ConsultationScope.ORG) return {};

    if (scope === ConsultationScope.DEPARTMENT && departmentId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: departmentId },
        include: { workflows: true },
      });
      if (!dept) return {};
      return {
        scopedDepartment: {
          name: dept.name,
          headcount: dept.headcount,
          avgSalary: dept.avgSalary,
          notes: dept.notes,
          workflows: dept.workflows.map((w) => ({
            name: w.name,
            description: w.description,
            weeklyHours: w.weeklyHours,
            peopleInvolved: w.peopleInvolved,
            automationLevel: w.automationLevel,
            painPoints: w.painPoints,
            priority: w.priority,
          })),
        },
      };
    }

    if (scope === ConsultationScope.WORKFLOW && workflowId) {
      const wf = await this.prisma.workflow.findUnique({
        where: { id: workflowId },
        include: { department: true },
      });
      if (!wf) return {};
      return {
        scopedWorkflow: {
          name: wf.name,
          description: wf.description,
          weeklyHours: wf.weeklyHours,
          peopleInvolved: wf.peopleInvolved,
          automationLevel: wf.automationLevel,
          painPoints: wf.painPoints,
          priority: wf.priority,
          department: {
            name: wf.department.name,
            headcount: wf.department.headcount,
          },
        },
      };
    }

    return {};
  }

  /**
   * Validates that department/workflow ids belong to the org and that the
   * workflow (if given) belongs to the given department.
   */
  private async validateScopeOwnership(
    orgId: string,
    scope: ConsultationScope,
    departmentId?: string,
    workflowId?: string,
  ): Promise<void> {
    if (scope === ConsultationScope.ORG) return;

    if (!departmentId)
      throw new BadRequestException('departmentId is required for scoped sessions');

    const dept = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true, organizationId: true },
    });
    if (!dept) throw new NotFoundException('Department not found');
    if (dept.organizationId !== orgId)
      throw new ForbiddenException('Department does not belong to your organization');

    if (scope === ConsultationScope.WORKFLOW) {
      if (!workflowId)
        throw new BadRequestException('workflowId is required for WORKFLOW scope');
      const wf = await this.prisma.workflow.findUnique({
        where: { id: workflowId },
        select: { id: true, departmentId: true },
      });
      if (!wf) throw new NotFoundException('Workflow not found');
      if (wf.departmentId !== departmentId)
        throw new BadRequestException(
          'Workflow does not belong to the given department',
        );
    }
  }

  private async getOrgContext(organizationId: string): Promise<Omit<AdaptiveQuestionContext, 'previousQA'>> {
    const cached = this.orgContextCache.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        organization: cached.organization,
        onboarding: cached.onboarding,
        scrapedInsights: cached.scrapedInsights,
      };
    }

    const [org, onboarding] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: { industry: true },
      }),
      this.prisma.onboarding.findUnique({
        where: { organizationId },
        select: {
          businessDescription: true,
          revenueStreams: true,
          selectedChallenges: true,
          selectedTools: true,
          selectedGoals: true,
          scrapedContent: true,
        },
      }),
    ]);

    const scraped = onboarding?.scrapedContent as any;
    const scrapedInsights = scraped?.businessData
      ? {
          aiDetected: scraped.businessData.aiDetected ?? false,
          aiMentions: scraped.businessData.aiMentions ?? [],
          automationDetected: scraped.businessData.automationDetected ?? false,
          automationMentions: scraped.businessData.automationMentions ?? [],
          technologies: scraped.businessData.technologies ?? [],
          products:
            scraped.businessData.products?.map((p: any) => p.name || p) ?? [],
          services:
            scraped.businessData.services?.map((s: any) => s.name || s) ?? [],
        }
      : undefined;

    const result = {
      organization: {
        name: org.name,
        industry: org.industry.name,
        size: org.size,
      },
      onboarding: {
        businessDescription: onboarding?.businessDescription || '',
        revenueStreams: onboarding?.revenueStreams || '',
        challenges: onboarding?.selectedChallenges || [],
        tools: onboarding?.selectedTools || [],
        goals: onboarding?.selectedGoals || [],
      },
      scrapedInsights,
    };

    this.orgContextCache.set(organizationId, {
      ...result,
      expiresAt: Date.now() + CONTEXT_CACHE_TTL,
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  List / Abandon
  // ──────────────────────────────────────────────────────────────────────

  async listSessions(orgId: string, query: ListSessionsQueryDto) {
    const where: Prisma.ConsultationSessionWhereInput = {
      organizationId: orgId,
      ...(query.scope && { scope: query.scope }),
      ...(query.departmentId && { departmentId: query.departmentId }),
      ...(query.workflowId && { workflowId: query.workflowId }),
    };

    const [sessions, total] = await Promise.all([
      this.prisma.consultationSession.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          department: { select: { id: true, name: true } },
          workflow: { select: { id: true, name: true, departmentId: true } },
          report: { select: { id: true, status: true } },
          _count: { select: { questions: true } },
        },
      }),
      this.prisma.consultationSession.count({ where }),
    ]);

    return new PaginatedResponseDto(sessions, total, query);
  }

  async abandonSession(sessionId: string, userId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId)
      throw new ForbiddenException('Not your session');
    if (session.status === 'COMPLETED' || session.status === 'ABANDONED')
      throw new BadRequestException('Session already ended');

    return this.prisma.consultationSession.update({
      where: { id: sessionId },
      data: { status: 'ABANDONED' },
    });
  }
}
