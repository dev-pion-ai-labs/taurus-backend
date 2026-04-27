import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ConsultationScope } from '@prisma/client';
import { PrismaService } from '../../prisma';
import { AiService } from '../../ai';
import { ChallengeService } from '../challenge/challenge.service';
import {
  SessionService,
  getBufferThresholdForScope,
} from '../session/session.service';
import { TemplateService } from './template.service';

/**
 * Per-scope batch sizes for AI question generation.
 *
 * First-time ORG sessions load BASE template questions first (~6-8 org-wide
 * intro questions) and use the personalized layer to top up with company-
 * specific questions, so the initial batch is small (defaults to 4-5).
 *
 * Follow-up ORG sessions and scoped sessions (DEPARTMENT / WORKFLOW) skip the
 * BASE template entirely — the personalized batch is the ENTIRE source of
 * questions, so we ask for a larger initial set that fills most of the cap,
 * leaving a couple of slots for adaptive follow-ups at the end.
 */
const INITIAL_BATCH_BY_SCOPE: Record<
  ConsultationScope,
  { count: string; minExpected: number } | undefined
> = {
  ORG: undefined,
  DEPARTMENT: { count: '8-10', minExpected: 6 }, // cap 12 → leave ~2 for adaptive
  WORKFLOW: { count: '5-6', minExpected: 4 },    // cap 8  → leave ~2 for adaptive
};

/**
 * Override for follow-up ORG sessions (org has completed a prior consultation).
 * Cap stays 20; this batch fills most of it because BASE is skipped.
 */
const FOLLOW_UP_ORG_INITIAL_BATCH = { count: '8-10', minExpected: 6 };

/**
 * Smaller batch when scoped sessions already have pre-generated starter
 * questions on the entity record. The pre-gen makes the start instant; this
 * top-up generates while the user answers the first 2-3 questions.
 */
const PREGEN_TOPUP_BATCH_BY_SCOPE: Record<
  ConsultationScope,
  { count: string; minExpected: number } | undefined
> = {
  // ORG follow-up that arrived with 8-10 starter questions already seeded
  // from the cached pregen. Cap is 20; this top-up brings us to ~12-14,
  // leaving a few slots for the adaptive layer at the end.
  ORG: { count: '4-5', minExpected: 3 },
  DEPARTMENT: { count: '6-7', minExpected: 5 },
  WORKFLOW: { count: '3-4', minExpected: 2 },
};

/**
 * Number of starter questions we generate per dept/workflow at create time.
 * We pre-generate the FULL per-scope set up-front so the user lands on Q1
 * instantly AND the consultation never relies on the async topup batch
 * arriving in time. Eliminates the race that caused premature completion
 * when users answered the starters faster than topup could land.
 */
const PREGEN_QUESTION_COUNT_BY_SCOPE: Partial<
  Record<ConsultationScope, { count: string; minExpected: number }>
> = {
  DEPARTMENT: { count: '8-10', minExpected: 7 },
  WORKFLOW:   { count: '5-6',  minExpected: 4 },
};

const ADAPTIVE_BATCH_BY_SCOPE: Record<
  ConsultationScope,
  { count: string; minExpected: number } | undefined
> = {
  ORG: undefined,
  DEPARTMENT: { count: '1-2', minExpected: 1 },
  WORKFLOW: { count: '1-2', minExpected: 1 },
};

interface TemplateGenerationJob {
  templateId: string;
  industryId: string;
}

interface PersonalizedBatchJob {
  sessionId: string;
  organizationId: string;
}

interface AdaptiveFollowUpJob {
  sessionId: string;
  organizationId: string;
}

interface DepartmentPreGenJob {
  departmentId: string;
  organizationId: string;
}

interface WorkflowPreGenJob {
  workflowId: string;
  organizationId: string;
}

interface OrgFollowUpPreGenJob {
  organizationId: string;
  /** The session whose completion triggered this pregen — used both to load
   *  prior answers and as a staleness key when consuming. */
  sourceSessionId: string;
}

@Processor('template-generation', { concurrency: 3 })
export class TemplateGeneratorProcessor extends WorkerHost {
  private readonly logger = new Logger(TemplateGeneratorProcessor.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private challengeService: ChallengeService,
    private sessionService: SessionService,
    private templateService: TemplateService,
  ) {
    super();
  }

  async process(
    job: Job<
      | TemplateGenerationJob
      | PersonalizedBatchJob
      | AdaptiveFollowUpJob
      | DepartmentPreGenJob
      | WorkflowPreGenJob
      | OrgFollowUpPreGenJob
    >,
  ) {
    if (job.name === 'generate-template') {
      return this.handleTemplateGeneration(job as Job<TemplateGenerationJob>);
    } else if (job.name === 'generate-personalized-batch') {
      return this.handlePersonalizedBatch(job as Job<PersonalizedBatchJob>);
    } else if (job.name === 'generate-adaptive-followup') {
      return this.handleAdaptiveFollowUp(job as Job<AdaptiveFollowUpJob>);
    } else if (job.name === 'generate-prequestions-dept') {
      return this.handleDepartmentPreGen(job as Job<DepartmentPreGenJob>);
    } else if (job.name === 'generate-prequestions-workflow') {
      return this.handleWorkflowPreGen(job as Job<WorkflowPreGenJob>);
    } else if (job.name === 'generate-prequestions-org-followup') {
      return this.handleOrgFollowUpPreGen(job as Job<OrgFollowUpPreGenJob>);
    } else {
      this.logger.error(`Unknown job type: ${job.name}`);
      throw new Error(`Unknown job type: ${job.name}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Legacy: Generate industry template
  // ──────────────────────────────────────────────────────────────────────

  private async handleTemplateGeneration(job: Job<TemplateGenerationJob>) {
    const { templateId, industryId } = job.data;
    this.logger.log(`Processing template generation: ${templateId}`);

    const template = await this.prisma.consultationTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template || template.status === 'ACTIVE') {
      this.logger.log(`Template ${templateId} already processed, skipping`);
      return;
    }

    try {
      const industry = await this.prisma.industry.findUniqueOrThrow({
        where: { id: industryId },
      });
      const challengeAreas = await this.challengeService.list();
      const challengeAreaNames = challengeAreas.map((ca) => ca.name);

      const generated = await this.aiService.generateIndustryQuestions(
        industry.name,
        challengeAreaNames,
      );

      for (let i = 0; i < generated.length; i++) {
        const q = generated[i];
        const question = await this.prisma.templateQuestion.create({
          data: {
            templateId,
            questionText: q.questionText,
            questionType: q.questionType,
            ...(q.options && { options: q.options }),
            orderIndex: (i + 1) * 10,
          },
        });

        if (q.challengeAreaTags?.length) {
          const normalizedTags = q.challengeAreaTags.map((tag) =>
            this.challengeService.normalizeKey(tag),
          );
          const matchedAreas =
            await this.challengeService.findByKeys(normalizedTags);

          if (matchedAreas.length) {
            await this.prisma.questionChallengeArea.createMany({
              data: matchedAreas.map((ca) => ({
                questionId: question.id,
                challengeAreaId: ca.id,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      await this.prisma.consultationTemplate.update({
        where: { id: templateId },
        data: { status: 'ACTIVE', generatedAt: new Date() },
      });

      // Unblock any PENDING_TEMPLATE sessions for this industry
      const pendingSessions = await this.prisma.consultationSession.findMany({
        where: {
          status: 'PENDING_TEMPLATE',
          organization: { industryId },
        },
        include: {
          baseTemplate: {
            include: { questions: { orderBy: { orderIndex: 'asc' } } },
          },
        },
      });

      if (pendingSessions.length) {
        this.logger.log(
          `Unblocking ${pendingSessions.length} pending sessions`,
        );

        const newIndustryTemplate =
          await this.templateService.getIndustryTemplate(industryId);

        for (const session of pendingSessions) {
          await this.prisma.consultationSession.update({
            where: { id: session.id },
            data: {
              industryTemplateId: templateId,
              status: 'IN_PROGRESS',
            },
          });

          await this.sessionService.compileSessionQuestions(
            session.id,
            session.baseTemplate,
            newIndustryTemplate ?? undefined,
          );
        }
      }

      this.logger.log(
        `Template ${templateId} generated with ${generated.length} questions`,
      );
    } catch (error) {
      this.logger.error(
        `Template generation failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      await this.prisma.consultationTemplate.update({
        where: { id: templateId },
        data: { status: 'DEPRECATED' },
      });

      await this.prisma.consultationSession.updateMany({
        where: {
          status: 'PENDING_TEMPLATE',
          organization: { industryId },
        },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Personalized Batch: generated at session start using full context
  // ──────────────────────────────────────────────────────────────────────

  private async handlePersonalizedBatch(job: Job<PersonalizedBatchJob>) {
    const { sessionId, organizationId } = job.data;
    const start = Date.now();
    this.logger.log(
      `[${sessionId}] Generating personalized question batch...`,
    );

    try {
      // Verify session is still active. Scoped sessions start in
      // PENDING_TEMPLATE — they wait for this batch before going IN_PROGRESS.
      const session = await this.prisma.consultationSession.findUnique({
        where: { id: sessionId },
      });
      if (
        !session ||
        (session.status !== 'IN_PROGRESS' &&
          session.status !== 'PENDING_TEMPLATE')
      ) {
        this.logger.log(`[${sessionId}] Session no longer active, skipping`);
        return;
      }

      // Scoped sessions now pre-generate the FULL set of questions at
      // entity-create time. If the session is already adequately filled
      // from that pregen, this topup job is a no-op — avoids racing the
      // user and producing duplicate / late questions.
      if (session.scope !== ConsultationScope.ORG) {
        const existingCount = await this.prisma.sessionQuestion.count({
          where: { sessionId },
        });
        const initialMin =
          INITIAL_BATCH_BY_SCOPE[session.scope]?.minExpected ?? 0;
        if (existingCount >= initialMin) {
          this.logger.log(
            `[${sessionId}] Already filled from pregen (${existingCount} >= ${initialMin}), skipping topup`,
          );
          return;
        }
      }

      const ctx = await this.sessionService.buildAdaptiveContext(
        sessionId,
        organizationId,
      );

      // Pick batch size by scope + state:
      // - Scoped session that was already seeded with pre-gen starter
      //   questions (status=IN_PROGRESS at processor start, scope is scoped)
      //   → smaller top-up batch.
      // - ORG follow-up that was seeded with pre-gen starter questions
      //   (status=IN_PROGRESS, ctx.isFollowUp=true) → smaller top-up batch.
      //   First-time ORG also has IN_PROGRESS at this point but isFollowUp
      //   is false, so it correctly falls through to the default 4-5 batch.
      // - Scoped session waiting on first batch (status=PENDING_TEMPLATE)
      //   → full initial batch.
      // - Follow-up ORG without seed (status=PENDING_TEMPLATE) → bigger
      //   ORG-specific initial batch.
      // - First-time ORG → default 4-5 batch (BASE template covers the rest).
      const isPreGenSeeded =
        session.status === 'IN_PROGRESS' &&
        (session.scope !== ConsultationScope.ORG || ctx.isFollowUp === true);
      const batchOpts = isPreGenSeeded
        ? PREGEN_TOPUP_BATCH_BY_SCOPE[session.scope]
        : session.scope === ConsultationScope.ORG && ctx.isFollowUp
          ? FOLLOW_UP_ORG_INITIAL_BATCH
          : INITIAL_BATCH_BY_SCOPE[session.scope];
      const questions =
        await this.aiService.generateInitialPersonalizedQuestions(
          ctx,
          batchOpts ?? {},
        );

      const added = await this.sessionService.appendAdaptiveQuestions(
        sessionId,
        questions,
        'PERSONALIZED',
      );

      // For scoped sessions that were waiting on this batch, flip to
      // IN_PROGRESS so the frontend leaves the "generating questions" screen.
      if (session.status === 'PENDING_TEMPLATE' && added > 0) {
        await this.prisma.consultationSession.update({
          where: { id: sessionId },
          data: { status: 'IN_PROGRESS' },
        });
      }

      this.logger.log(
        `[${sessionId}] Personalized batch (scope=${session.scope}, count=${batchOpts?.count ?? '4-5'}): ${added} added in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      this.logger.error(
        `[${sessionId}] Personalized batch generation failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Org-level sessions still have BASE questions to answer, so the
      // adaptive layer can recover later. Scoped sessions have no questions
      // at all if this batch failed — mark the session FAILED so the
      // frontend's pending-state timeout doesn't strand the user.
      try {
        const fresh = await this.prisma.consultationSession.findUnique({
          where: { id: sessionId },
          select: { status: true },
        });
        if (fresh?.status === 'PENDING_TEMPLATE') {
          await this.prisma.consultationSession.update({
            where: { id: sessionId },
            data: { status: 'FAILED' },
          });
        }
      } catch {
        // Best-effort — if we can't update we'd rather leave the original log.
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Adaptive Follow-up: generated mid-session based on answers
  // ──────────────────────────────────────────────────────────────────────

  private async handleAdaptiveFollowUp(job: Job<AdaptiveFollowUpJob>) {
    const { sessionId, organizationId } = job.data;
    const start = Date.now();
    this.logger.log(
      `[${sessionId}] Generating adaptive follow-up questions...`,
    );

    try {
      const session = await this.prisma.consultationSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.status !== 'IN_PROGRESS') {
        this.logger.log(`[${sessionId}] Session no longer active, skipping`);
        return;
      }

      // Check if buffer has already been replenished (dedup — another job might have run).
      // Use the same per-scope buffer the session-side trigger uses.
      const scopeBuffer = getBufferThresholdForScope(session.scope);
      const remaining = await this.prisma.sessionQuestion.count({
        where: { sessionId, answeredAt: null, skipped: false },
      });
      if (remaining > scopeBuffer) {
        this.logger.log(
          `[${sessionId}] Buffer already sufficient (${remaining} remaining, scope=${session.scope}), skipping`,
        );
        return;
      }

      const ctx = await this.sessionService.buildAdaptiveContext(
        sessionId,
        organizationId,
      );

      // Only generate if we have some answers to work with
      if (ctx.previousQA.length < 2) {
        this.logger.log(
          `[${sessionId}] Not enough answers yet for adaptive questions, skipping`,
        );
        return;
      }

      const batchOpts = ADAPTIVE_BATCH_BY_SCOPE[session.scope];
      const questions = await this.aiService.generateAdaptiveFollowUps(
        ctx,
        batchOpts ?? {},
      );

      const added = await this.sessionService.appendAdaptiveQuestions(
        sessionId,
        questions,
        'ADAPTIVE',
      );

      this.logger.log(
        `[${sessionId}] Adaptive follow-up (scope=${session.scope}, count=${batchOpts?.count ?? '2-3'}): ${added} added in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      this.logger.error(
        `[${sessionId}] Adaptive follow-up generation failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Don't throw — session continues with existing questions
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Department / Workflow pre-generation (run on entity create)
  //  These cache 2-3 starter questions on the entity so a later consultation
  //  can skip the PENDING_TEMPLATE waiting screen.
  // ──────────────────────────────────────────────────────────────────────

  private async handleDepartmentPreGen(job: Job<DepartmentPreGenJob>) {
    const { departmentId, organizationId } = job.data;
    const start = Date.now();
    this.logger.log(`[dept:${departmentId}] Pre-generating starter questions...`);

    try {
      const dept = await this.prisma.department.findUnique({
        where: { id: departmentId },
        select: { id: true, organizationId: true },
      });
      if (!dept || dept.organizationId !== organizationId) {
        this.logger.log(`[dept:${departmentId}] Not found or org mismatch, skipping`);
        return;
      }

      const ctx = await this.sessionService.buildPrePopulationContext(
        ConsultationScope.DEPARTMENT,
        organizationId,
        departmentId,
      );

      const questions = await this.aiService.generateInitialPersonalizedQuestions(
        ctx,
        PREGEN_QUESTION_COUNT_BY_SCOPE.DEPARTMENT ?? {},
      );

      await this.prisma.department.update({
        where: { id: departmentId },
        data: {
          preGeneratedQuestions: questions as any,
          preGeneratedAt: new Date(),
        },
      });

      this.logger.log(
        `[dept:${departmentId}] Cached ${questions.length} starter questions in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      this.logger.error(
        `[dept:${departmentId}] Pre-gen failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Don't throw — falling back to live generation at session start is fine.
    }
  }

  private async handleWorkflowPreGen(job: Job<WorkflowPreGenJob>) {
    const { workflowId, organizationId } = job.data;
    const start = Date.now();
    this.logger.log(`[wf:${workflowId}] Pre-generating starter questions...`);

    try {
      const wf = await this.prisma.workflow.findUnique({
        where: { id: workflowId },
        select: {
          id: true,
          departmentId: true,
          department: { select: { organizationId: true } },
        },
      });
      if (!wf || wf.department.organizationId !== organizationId) {
        this.logger.log(`[wf:${workflowId}] Not found or org mismatch, skipping`);
        return;
      }

      const ctx = await this.sessionService.buildPrePopulationContext(
        ConsultationScope.WORKFLOW,
        organizationId,
        wf.departmentId,
        workflowId,
      );

      const questions = await this.aiService.generateInitialPersonalizedQuestions(
        ctx,
        PREGEN_QUESTION_COUNT_BY_SCOPE.WORKFLOW ?? {},
      );

      await this.prisma.workflow.update({
        where: { id: workflowId },
        data: {
          preGeneratedQuestions: questions as any,
          preGeneratedAt: new Date(),
        },
      });

      this.logger.log(
        `[wf:${workflowId}] Cached ${questions.length} starter questions in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      this.logger.error(
        `[wf:${workflowId}] Pre-gen failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Org Follow-Up Pre-Gen: chained off the analysis processor AFTER the
  //  prior session's report has been generated. Caches starter questions on
  //  the Organization row so the user's NEXT org consultation skips the
  //  live-generation wait.
  // ──────────────────────────────────────────────────────────────────────

  private async handleOrgFollowUpPreGen(job: Job<OrgFollowUpPreGenJob>) {
    const { organizationId, sourceSessionId } = job.data;
    const start = Date.now();
    this.logger.log(
      `[org:${organizationId}] Pre-generating starter questions (source session ${sourceSessionId})...`,
    );

    try {
      const ctx = await this.sessionService.buildOrgFollowUpPreGenContext(
        organizationId,
        sourceSessionId,
      );

      const questions = await this.aiService.generateInitialPersonalizedQuestions(
        ctx,
        FOLLOW_UP_ORG_INITIAL_BATCH,
      );

      await this.prisma.organization.update({
        where: { id: organizationId },
        data: {
          preGeneratedQuestions: {
            generatedFor: sourceSessionId,
            questions,
          } as any,
          preGeneratedAt: new Date(),
        },
      });

      this.logger.log(
        `[org:${organizationId}] Cached ${questions.length} starter questions in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      this.logger.error(
        `[org:${organizationId}] Org follow-up pre-gen failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Don't throw — falling back to live generation at session start is fine.
    }
  }
}
