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

/** Buffer that triggers more adaptive questions, sized to the scope's cap. */
const BUFFER_THRESHOLD_BY_SCOPE: Record<ConsultationScope, number> = {
  ORG: 3,
  DEPARTMENT: 2,
  WORKFLOW: 1,
};

/** How long to cache org context in memory (ms). */
const CONTEXT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/** Public so the queue processor can apply the same per-scope buffer. */
export function getMaxQuestionsForScope(scope: ConsultationScope): number {
  return MAX_QUESTIONS_BY_SCOPE[scope];
}
export function getBufferThresholdForScope(scope: ConsultationScope): number {
  return BUFFER_THRESHOLD_BY_SCOPE[scope];
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

    // Always grab the base template for core questions
    const baseTemplate = await this.templateService.getBaseTemplate();

    const session = await this.prisma.consultationSession.create({
      data: {
        organizationId: orgId,
        userId,
        status: 'IN_PROGRESS',
        scope,
        departmentId: scope === ConsultationScope.ORG ? null : dto.departmentId ?? null,
        workflowId: scope === ConsultationScope.WORKFLOW ? dto.workflowId ?? null : null,
        baseTemplateId: baseTemplate.id,
        industryTemplateId: null,
      },
    });

    // 1. Add predefined core questions immediately (user sees these first)
    let orderIndex = 0;
    const coreQuestions = baseTemplate.questions.map((q) => ({
      sessionId: session.id,
      questionId: q.id,
      section: 'BASE' as const,
      orderIndex: orderIndex++,
    }));

    await this.prisma.sessionQuestion.createMany({ data: coreQuestions });

    // 2. Queue personalized question generation in background
    //    These will be ready by the time user finishes core questions
    await this.templateQueue.add('generate-personalized-batch', {
      sessionId: session.id,
      organizationId: orgId,
    });

    this.logger.log(
      `Session ${session.id} started with ${coreQuestions.length} core questions, personalized batch queued`,
    );

    return this.getSession(session.id, userId);
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
        select: { scope: true, departmentId: true, workflowId: true },
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

    return {
      ...orgCtx,
      scope: session.scope,
      scopedDepartment,
      scopedWorkflow,
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
