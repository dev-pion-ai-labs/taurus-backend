import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class ImplementationToolExecutor {
  private readonly logger = new Logger(ImplementationToolExecutor.name);

  constructor(private prisma: PrismaService) {}

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    organizationId: string,
  ): Promise<unknown> {
    this.logger.debug(`Executing tool: ${toolName} for org ${organizationId}`);

    switch (toolName) {
      case 'get_organization_context':
        return this.getOrganizationContext(organizationId);
      case 'get_department_details':
        return this.getDepartmentDetails(
          organizationId,
          input.departmentName as string | undefined,
        );
      case 'get_tech_stack':
        return this.getTechStack(
          organizationId,
          input.category as string | undefined,
        );
      case 'get_related_actions':
        return this.getRelatedActions(
          organizationId,
          input.department as string | undefined,
          input.status as string | undefined,
        );
      case 'get_report_context':
        return this.getReportContext(organizationId);
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  private async getOrganizationContext(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { industry: true },
    });

    const onboarding = await this.prisma.onboarding.findUnique({
      where: { organizationId },
    });

    return {
      name: org?.name,
      industry: org?.industry?.name,
      size: org?.size,
      businessDescription: onboarding?.businessDescription,
      revenueStreams: onboarding?.revenueStreams,
      challenges: onboarding?.selectedChallenges,
      goals: onboarding?.selectedGoals,
      tools: onboarding?.selectedTools,
      availableData: onboarding?.availableData,
    };
  }

  private async getDepartmentDetails(
    organizationId: string,
    departmentName?: string,
  ) {
    const where: Record<string, unknown> = { organizationId };
    if (departmentName) {
      where.name = { contains: departmentName, mode: 'insensitive' };
    }

    const departments = await this.prisma.department.findMany({
      where,
      include: { workflows: true },
    });

    return departments.map((d) => ({
      name: d.name,
      headcount: d.headcount,
      avgSalary: d.avgSalary,
      notes: d.notes,
      workflows: d.workflows.map((w) => ({
        name: w.name,
        description: w.description,
        weeklyHours: w.weeklyHours,
        peopleInvolved: w.peopleInvolved,
        automationLevel: w.automationLevel,
        painPoints: w.painPoints,
        priority: w.priority,
      })),
    }));
  }

  private async getTechStack(organizationId: string, category?: string) {
    const where: Record<string, unknown> = { organizationId };
    if (category) {
      where.category = category;
    }

    const tools = await this.prisma.toolEntry.findMany({ where });

    return tools.map((t) => ({
      name: t.name,
      category: t.category,
      status: t.status,
      monthlyCost: t.monthlyCost,
      userCount: t.userCount,
      utilizationPercent: t.utilizationPercent,
      source: t.source,
    }));
  }

  private async getRelatedActions(
    organizationId: string,
    department?: string,
    status?: string,
  ) {
    const where: Record<string, unknown> = { organizationId };
    if (department) {
      where.department = { contains: department, mode: 'insensitive' };
    }
    if (status) {
      where.status = status;
    }

    const actions = await this.prisma.transformationAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return actions.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      department: a.department,
      category: a.category,
      status: a.status,
      priority: a.priority,
      estimatedValue: a.estimatedValue,
      estimatedEffort: a.estimatedEffort,
      phase: a.phase,
    }));
  }

  private async getReportContext(organizationId: string) {
    const report = await this.prisma.transformationReport.findFirst({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: { generatedAt: 'desc' },
    });

    if (!report) {
      return { message: 'No completed transformation report found' };
    }

    return {
      overallScore: report.overallScore,
      maturityLevel: report.maturityLevel,
      totalEfficiencyValue: report.totalEfficiencyValue,
      totalGrowthValue: report.totalGrowthValue,
      totalAiValue: report.totalAiValue,
      fteRedeployable: report.fteRedeployable,
      executiveSummary: report.executiveSummary,
      departmentScores: report.departmentScores,
      recommendations: report.recommendations,
      implementationPlan: report.implementationPlan,
    };
  }
}
