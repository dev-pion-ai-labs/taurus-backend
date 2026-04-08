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
import { PaginationQueryDto, PaginatedResponseDto } from '../../common';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private prisma: PrismaService,
    private templateService: TemplateService,
    private templateGeneratorService: TemplateGeneratorService,
    @InjectQueue('analysis') private analysisQueue: Queue,
  ) {}

  async startSession(userId: string, orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const baseTemplate = await this.templateService.getBaseTemplate();
    let industryTemplate = await this.templateService.getIndustryTemplate(
      org.industryId,
    );

    let status: 'IN_PROGRESS' | 'PENDING_TEMPLATE' = 'IN_PROGRESS';

    if (!industryTemplate) {
      // Trigger generation
      const generating =
        await this.templateGeneratorService.generateForIndustry(org.industryId);
      if (generating.status === 'ACTIVE') {
        industryTemplate = await this.templateService.getIndustryTemplate(
          org.industryId,
        );
      } else {
        status = 'PENDING_TEMPLATE';
      }
    }

    const session = await this.prisma.consultationSession.create({
      data: {
        organizationId: orgId,
        userId,
        status,
        baseTemplateId: baseTemplate.id,
        industryTemplateId: industryTemplate?.id || null,
      },
    });

    // Compile session questions
    if (status === 'IN_PROGRESS') {
      await this.compileSessionQuestions(
        session.id,
        baseTemplate,
        industryTemplate ?? undefined,
      );
    }

    return this.getSession(session.id, userId);
  }

  async compileSessionQuestions(
    sessionId: string,
    baseTemplate: { questions: { id: string; orderIndex: number }[] },
    industryTemplate?: { questions: { id: string; orderIndex: number }[] },
  ) {
    let orderIndex = 0;

    // Base questions first
    const baseQuestions = baseTemplate.questions.map((q) => ({
      sessionId,
      questionId: q.id,
      section: 'BASE' as const,
      orderIndex: orderIndex++,
    }));

    // Then industry questions
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

  async getSession(sessionId: string, userId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: true },
        },
        organization: { include: { industry: true } },
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

  async getCurrentQuestion(sessionId: string, userId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId)
      throw new ForbiddenException('Not your session');

    if (session.status !== 'IN_PROGRESS') {
      return { status: session.status, question: null };
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

    return {
      status: session.status,
      question: nextQuestion,
      progress: { answered, total },
    };
  }

  async submitAnswer(
    sessionId: string,
    userId: string,
    questionId: string,
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

    const sessionQuestion = await this.prisma.sessionQuestion.findUnique({
      where: { sessionId_questionId: { sessionId, questionId } },
      include: { question: true },
    });
    if (!sessionQuestion)
      throw new NotFoundException('Question not found in session');
    if (sessionQuestion.answeredAt)
      throw new BadRequestException('Question already answered');

    // Validate answer by type
    this.validateAnswer(
      sessionQuestion.question.questionType,
      value,
      sessionQuestion.question.options,
    );

    await this.prisma.sessionQuestion.update({
      where: { id: sessionQuestion.id },
      data: { answer: { value }, answeredAt: new Date() },
    });

    // Check if all questions answered
    const remaining = await this.prisma.sessionQuestion.count({
      where: { sessionId, answeredAt: null, skipped: false },
    });

    if (remaining === 0) {
      const completedSession = await this.prisma.consultationSession.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      // Auto-generate transformation report
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

    // Get next question
    const nextQuestion = await this.prisma.sessionQuestion.findFirst({
      where: { sessionId, answeredAt: null, skipped: false },
      orderBy: { orderIndex: 'asc' },
      include: { question: true },
    });

    return { status: 'IN_PROGRESS', nextQuestion };
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

  async listSessions(orgId: string, query: PaginationQueryDto) {
    const [sessions, total] = await Promise.all([
      this.prisma.consultationSession.findMany({
        where: { organizationId: orgId },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          report: { select: { id: true, status: true } },
          _count: { select: { questions: true } },
        },
      }),
      this.prisma.consultationSession.count({
        where: { organizationId: orgId },
      }),
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
