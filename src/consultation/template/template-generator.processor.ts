import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma';
import { AiService } from '../../ai';
import { ChallengeService } from '../challenge/challenge.service';
import { SessionService } from '../session/session.service';
import { TemplateService } from './template.service';

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
    job: Job<TemplateGenerationJob | PersonalizedBatchJob | AdaptiveFollowUpJob>,
  ) {
    if (job.name === 'generate-template') {
      return this.handleTemplateGeneration(job as Job<TemplateGenerationJob>);
    } else if (job.name === 'generate-personalized-batch') {
      return this.handlePersonalizedBatch(job as Job<PersonalizedBatchJob>);
    } else if (job.name === 'generate-adaptive-followup') {
      return this.handleAdaptiveFollowUp(job as Job<AdaptiveFollowUpJob>);
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
      // Verify session is still active
      const session = await this.prisma.consultationSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.status !== 'IN_PROGRESS') {
        this.logger.log(`[${sessionId}] Session no longer active, skipping`);
        return;
      }

      const ctx = await this.sessionService.buildAdaptiveContext(
        sessionId,
        organizationId,
      );

      const questions =
        await this.aiService.generateInitialPersonalizedQuestions(ctx);

      const added = await this.sessionService.appendAdaptiveQuestions(
        sessionId,
        questions,
        'PERSONALIZED',
      );

      this.logger.log(
        `[${sessionId}] Personalized batch: ${added} questions added in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      this.logger.error(
        `[${sessionId}] Personalized batch generation failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Don't throw — session continues with core questions only
      // The adaptive follow-up mechanism will generate more as needed
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

      // Check if buffer has already been replenished (dedup — another job might have run)
      const remaining = await this.prisma.sessionQuestion.count({
        where: { sessionId, answeredAt: null, skipped: false },
      });
      if (remaining > 3) {
        this.logger.log(
          `[${sessionId}] Buffer already sufficient (${remaining} remaining), skipping`,
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

      const questions = await this.aiService.generateAdaptiveFollowUps(ctx);

      const added = await this.sessionService.appendAdaptiveQuestions(
        sessionId,
        questions,
        'ADAPTIVE',
      );

      this.logger.log(
        `[${sessionId}] Adaptive follow-up: ${added} questions added in ${((Date.now() - start) / 1000).toFixed(1)}s`,
      );
    } catch (error) {
      this.logger.error(
        `[${sessionId}] Adaptive follow-up generation failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Don't throw — session continues with existing questions
    }
  }
}
