import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma';

@Injectable()
export class ReportService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('analysis') private analysisQueue: Queue,
  ) {}

  async getReport(sessionId: string, organizationId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.organizationId !== organizationId) {
      throw new ForbiddenException('Not your organization\'s session');
    }

    const report = await this.prisma.transformationReport.findUnique({
      where: { sessionId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  async regenerateReport(
    sessionId: string,
    userId: string,
    organizationId: string,
  ) {
    // Verify session
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.organizationId !== organizationId) {
      throw new ForbiddenException('Not your organization\'s session');
    }
    if (session.status !== 'COMPLETED') {
      throw new BadRequestException('Session must be completed to regenerate report');
    }

    // Verify user is ADMIN
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (user?.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can regenerate reports');
    }

    // Upsert report as GENERATING
    const report = await this.prisma.transformationReport.upsert({
      where: { sessionId },
      create: {
        sessionId,
        organizationId: session.organizationId,
        status: 'GENERATING',
      },
      update: {
        status: 'GENERATING',
        overallScore: null,
        maturityLevel: null,
        totalEfficiencyValue: null,
        totalGrowthValue: null,
        totalAiValue: null,
        fteRedeployable: null,
        executiveSummary: Prisma.DbNull,
        departmentScores: Prisma.DbNull,
        recommendations: Prisma.DbNull,
        implementationPlan: Prisma.DbNull,
        generatedAt: null,
      },
    });

    // Queue regeneration
    await this.analysisQueue.add('generate-report', {
      reportId: report.id,
      sessionId: session.id,
      organizationId: session.organizationId,
    });

    return { id: report.id, sessionId, status: report.status };
  }
}
