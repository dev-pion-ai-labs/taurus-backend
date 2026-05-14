import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma';

/**
 * Single source of truth for the org-context read queries that the AI planner
 * uses to ground its plans. Both the new TaurusMcpServer and the legacy
 * ImplementationToolExecutor / IntegrationToolExecutor delegate here so the
 * two paths can't drift during the migration window.
 *
 * All methods are read-only.
 */
@Injectable()
export class TaurusContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrganizationContext(organizationId: string) {
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

  async getDepartmentDetails(organizationId: string, departmentName?: string) {
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

  async getTechStack(organizationId: string, category?: string) {
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

  async getRelatedActions(
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

  async getReportContext(organizationId: string) {
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
      executiveSummary: report.executiveSummary,
      departmentScores: report.departmentScores,
      recommendations: report.recommendations,
      implementationPlan: report.implementationPlan,
    };
  }

  async getConnectedIntegrations(organizationId: string) {
    const connections = await this.prisma.integrationConnection.findMany({
      where: { organizationId, status: 'CONNECTED' },
      select: { provider: true, externalTeamName: true },
    });

    const siteUrl = (c: {
      provider: string;
      externalTeamName: string | null;
    }): string | null => {
      if (!c.externalTeamName) return null;
      switch (c.provider) {
        case 'JIRA':
          return `https://${c.externalTeamName}.atlassian.net`;
        case 'SLACK':
          return `https://${c.externalTeamName}.slack.com`;
        default:
          return null;
      }
    };

    return {
      connected: connections.map((c) => ({
        provider: c.provider,
        teamName: c.externalTeamName,
        siteUrl: siteUrl(c),
      })),
      availableTools: connections.flatMap((c) => {
        switch (c.provider) {
          case 'SLACK':
            return [
              'slack_create_channel',
              'slack_send_message',
              'slack_set_channel_topic',
              'slack_list_channels',
              'slack_list_users',
            ];
          case 'GOOGLE_DRIVE':
            return ['gdrive_create_document'];
          case 'JIRA':
            return [
              'jira_create_issue',
              'jira_transition_issue',
              'jira_add_comment',
              'jira_list_projects',
            ];
          case 'NOTION':
            return ['notion_create_page', 'notion_create_database', 'notion_search'];
          case 'HUBSPOT':
            return [
              'hubspot_create_contact',
              'hubspot_create_deal',
              'hubspot_list_pipelines',
            ];
          case 'SALESFORCE':
            return ['salesforce_create_record', 'salesforce_query'];
          default:
            return [];
        }
      }),
    };
  }
}
