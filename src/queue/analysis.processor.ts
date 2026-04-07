import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma';
import { AiService } from '../ai';
import type { ReportGenerationContext } from '../ai/prompts/report-generation.prompt';

interface ReportGenerationJob {
  reportId: string;
  sessionId: string;
  organizationId: string;
}

@Processor('analysis', { concurrency: 2 })
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {
    super();
  }

  async process(job: Job<ReportGenerationJob>) {
    const { reportId, sessionId, organizationId } = job.data;
    this.logger.log(
      `Processing report generation for session ${sessionId}, report ${reportId}`,
    );

    try {
      // Gather all context
      const context = await this.gatherContext(sessionId, organizationId);

      // Generate report via Claude
      const reportData =
        await this.aiService.generateTransformationReport(context);

      // Calculate financial totals
      const totalEfficiencyValue = reportData.departmentScores.reduce(
        (sum, d) => sum + (d.efficiencyValue || 0),
        0,
      );
      const totalGrowthValue = reportData.departmentScores.reduce(
        (sum, d) => sum + (d.growthValue || 0),
        0,
      );

      // Save report
      await this.prisma.transformationReport.update({
        where: { id: reportId },
        data: {
          status: 'COMPLETED',
          overallScore: reportData.overallScore,
          maturityLevel: reportData.maturityLevel,
          totalEfficiencyValue,
          totalGrowthValue,
          totalAiValue: totalEfficiencyValue + totalGrowthValue,
          fteRedeployable: reportData.fteRedeployable,
          executiveSummary: reportData.executiveSummary as any,
          departmentScores: reportData.departmentScores as any,
          recommendations: reportData.recommendations as any,
          implementationPlan: reportData.implementationPlan as any,
          generatedAt: new Date(),
        },
      });

      this.logger.log(
        `Report ${reportId} generated successfully. Score: ${reportData.overallScore}, Value: $${(totalEfficiencyValue + totalGrowthValue).toLocaleString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Report generation failed for ${reportId}: ${error.message}`,
        error.stack,
      );

      await this.prisma.transformationReport.update({
        where: { id: reportId },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  private async gatherContext(
    sessionId: string,
    organizationId: string,
  ): Promise<ReportGenerationContext> {
    const [org, onboarding, departments, sessionQuestions] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: { industry: true },
      }),
      this.prisma.onboarding.findUnique({
        where: { organizationId },
      }),
      this.prisma.department.findMany({
        where: { organizationId },
        include: { workflows: true },
      }),
      this.prisma.sessionQuestion.findMany({
        where: { sessionId, answeredAt: { not: null } },
        include: { question: true },
        orderBy: { orderIndex: 'asc' },
      }),
    ]);

    return {
      organization: {
        name: org.name,
        industry: org.industry.name,
        size: org.size,
      },
      onboarding: {
        businessDescription: onboarding?.businessDescription || '',
        revenueStreams: onboarding?.revenueStreams || '',
        challenges: onboarding?.selectedChallenges || [],
        customChallenges: onboarding?.customChallenges || '',
        tools: onboarding?.selectedTools || [],
        customTools: onboarding?.customTools || '',
        goals: onboarding?.selectedGoals || [],
        customGoals: onboarding?.customGoals || '',
        dataSources: onboarding?.availableData || [],
        customDataSources: onboarding?.customDataSources || '',
      },
      departments: departments.map((d) => ({
        name: d.name,
        headcount: d.headcount,
        avgSalary: d.avgSalary,
        workflows: d.workflows.map((w) => ({
          name: w.name,
          description: w.description,
          weeklyHours: w.weeklyHours,
          peopleInvolved: w.peopleInvolved,
          automationLevel: w.automationLevel,
          painPoints: w.painPoints,
          priority: w.priority,
        })),
      })),
      consultationAnswers: sessionQuestions.map((sq) => ({
        section: sq.section,
        question: sq.question.questionText,
        questionType: sq.question.questionType,
        answer: (sq.answer as any)?.value ?? sq.answer,
      })),
    };
  }
}
