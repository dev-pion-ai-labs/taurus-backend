import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma';
import { AiService } from '../../ai';
import { ChallengeService } from '../challenge/challenge.service';
import { buildQuestionGenerationPrompt } from '../../ai/prompts/question-generation.prompt';

@Injectable()
export class TemplateGeneratorService {
  private readonly logger = new Logger(TemplateGeneratorService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private challengeService: ChallengeService,
    @InjectQueue('template-generation') private templateQueue: Queue,
  ) {}

  async generateForIndustry(industryId: string) {
    // Check if already generating or active
    const existing = await this.prisma.consultationTemplate.findFirst({
      where: {
        type: 'INDUSTRY',
        industryId,
        status: { in: ['GENERATING', 'ACTIVE'] },
      },
    });

    if (existing) {
      this.logger.log(
        `Template already ${existing.status} for industry ${industryId}`,
      );
      return existing;
    }

    // Get latest version
    const latest = await this.prisma.consultationTemplate.findFirst({
      where: { type: 'INDUSTRY', industryId },
      orderBy: { version: 'desc' },
    });

    const version = latest ? latest.version + 1 : 1;

    // Compute prompt hash
    const challengeAreas = await this.challengeService.list();
    const industry = await this.prisma.industry.findUniqueOrThrow({
      where: { id: industryId },
    });
    const { system, user } = buildQuestionGenerationPrompt(
      industry.name,
      challengeAreas.map((ca) => ca.name),
    );
    const promptHash = crypto
      .createHash('sha256')
      .update(system + user)
      .digest('hex')
      .slice(0, 16);

    const template = await this.prisma.consultationTemplate.create({
      data: {
        type: 'INDUSTRY',
        status: 'GENERATING',
        version,
        industryId,
        aiModel: this.aiService.getModel(),
        aiPromptHash: promptHash,
      },
    });

    await this.templateQueue.add('generate', {
      templateId: template.id,
      industryId,
    });

    this.logger.log(
      `Queued template generation for industry ${industry.name} (v${version})`,
    );
    return template;
  }

  async regenerate(templateId: string) {
    const existing = await this.prisma.consultationTemplate.findUnique({
      where: { id: templateId },
    });

    if (!existing || existing.type !== 'INDUSTRY') {
      throw new Error('Can only regenerate industry templates');
    }

    // Deprecate old
    await this.prisma.consultationTemplate.update({
      where: { id: templateId },
      data: { status: 'DEPRECATED' },
    });

    return this.generateForIndustry(existing.industryId!);
  }
}
