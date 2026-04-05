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

  async process(job: Job<TemplateGenerationJob>) {
    const { templateId, industryId } = job.data;
    this.logger.log(`Processing template generation: ${templateId}`);

    // Deduplication: check if already ACTIVE
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

      // Generate questions via AI
      const generated = await this.aiService.generateIndustryQuestions(
        industry.name,
        challengeAreaNames,
      );

      // Create questions and challenge area links
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

        // Link challenge areas
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

      // Mark template as ACTIVE
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
        include: { baseTemplate: { include: { questions: { orderBy: { orderIndex: 'asc' } } } } },
      });

      if (pendingSessions.length) {
        this.logger.log(
          `Unblocking ${pendingSessions.length} pending sessions`,
        );

        const newIndustryTemplate = await this.templateService.getIndustryTemplate(industryId);

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
        `Template generation failed: ${error.message}`,
        error.stack,
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
}
