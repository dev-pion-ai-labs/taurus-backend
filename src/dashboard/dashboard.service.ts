import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { boardReportTemplate } from './templates/board-report.template';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private prisma: PrismaService) {}

  async getExecutiveDashboard(organizationId: string) {
    // Get all completed reports, ordered newest first
    const reports = await this.prisma.transformationReport.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
      },
      orderBy: { generatedAt: 'desc' },
    });

    const latest = reports[0] || null;
    const previous = reports[1] || null;

    // Session count
    const sessionsCompleted = await this.prisma.consultationSession.count({
      where: { organizationId, status: 'COMPLETED' },
    });

    // Score history
    const scoreHistory = reports
      .filter((r) => r.overallScore != null && r.generatedAt != null)
      .map((r) => ({
        date: r.generatedAt!.toISOString(),
        score: r.overallScore!,
      }))
      .reverse(); // chronological order

    // Department scores with trends
    const latestDeptScores = (latest?.departmentScores as any[]) || [];
    const previousDeptScores = (previous?.departmentScores as any[]) || [];

    const avgScore =
      latestDeptScores.length > 0
        ? latestDeptScores.reduce((sum, d) => sum + (d.score || 0), 0) /
          latestDeptScores.length
        : 0;

    const departmentScores = latestDeptScores.map((dept) => {
      const prevDept = previousDeptScores.find(
        (p) => p.department === dept.department,
      );

      let trend: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
      if (prevDept) {
        const diff = dept.score - prevDept.score;
        if (diff > 3) trend = 'UP';
        else if (diff < -3) trend = 'DOWN';
      }

      let status: 'LEADING' | 'ON_TRACK' | 'LAGGING' = 'ON_TRACK';
      if (dept.score >= avgScore + 10) status = 'LEADING';
      else if (dept.score <= avgScore - 10) status = 'LAGGING';

      return {
        department: dept.department,
        score: dept.score,
        trend,
        status,
      };
    });

    // Top recommendations from latest report
    const recommendations = (latest?.recommendations as any[]) || [];
    const topRecommendations = recommendations
      .sort((a, b) => (b.annualValue || 0) - (a.annualValue || 0))
      .slice(0, 5)
      .map((r) => ({
        title: r.title,
        department: r.department,
        annualValue: r.annualValue,
        impact: r.impact,
        effort: r.effort,
      }));

    // Tracker stats
    const trackerActions = await this.prisma.transformationAction.findMany({
      where: { organizationId },
      select: { status: true, estimatedValue: true, blockerNote: true },
    });

    let trackerValueRealized = 0;
    let trackerValueIdentified = 0;
    let activeActions = 0;
    let completedActions = 0;
    let blockedActions = 0;

    for (const action of trackerActions) {
      trackerValueIdentified += action.estimatedValue || 0;
      if (action.status === 'DEPLOYED' || action.status === 'VERIFIED') {
        trackerValueRealized += action.estimatedValue || 0;
        completedActions++;
      }
      if (action.status === 'IN_PROGRESS') activeActions++;
      if (action.blockerNote) blockedActions++;
    }

    return {
      // Maturity
      currentScore: latest?.overallScore ?? null,
      previousScore: previous?.overallScore ?? null,
      maturityLevel: latest?.maturityLevel ?? null,
      scoreHistory,

      // Financial
      totalValueIdentified: latest?.totalAiValue ?? null,
      efficiencyValue: latest?.totalEfficiencyValue ?? null,
      growthValue: latest?.totalGrowthValue ?? null,

      // Activity
      sessionsCompleted,
      totalRecommendations: recommendations.length,

      // Departments
      departmentScores,

      // Top recs
      topRecommendations,

      // Tracker
      tracker: {
        valueRealized: trackerValueRealized,
        valueIdentified: trackerValueIdentified,
        activeActions,
        completedActions,
        blockedActions,
        totalActions: trackerActions.length,
      },
    };
  }

  async getMaturityTrend(organizationId: string) {
    const reports = await this.prisma.transformationReport.findMany({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: { generatedAt: 'asc' },
      select: {
        id: true,
        overallScore: true,
        maturityLevel: true,
        generatedAt: true,
      },
    });

    return reports.map((r, i) => ({
      date: r.generatedAt?.toISOString(),
      score: r.overallScore,
      maturityLevel: r.maturityLevel,
      change: i > 0 ? (r.overallScore ?? 0) - (reports[i - 1].overallScore ?? 0) : 0,
    }));
  }

  async getDepartmentHeatmap(organizationId: string) {
    const latestReport = await this.prisma.transformationReport.findFirst({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: { generatedAt: 'desc' },
    });

    if (!latestReport?.departmentScores) return [];

    const scores = latestReport.departmentScores as any[];
    const avgScore =
      scores.reduce((sum, d) => sum + (d.score || 0), 0) / (scores.length || 1);

    return scores.map((dept) => ({
      department: dept.department,
      score: dept.score,
      maturityLevel: dept.maturityLevel,
      efficiencyValue: dept.efficiencyValue || 0,
      growthValue: dept.growthValue || 0,
      status:
        dept.score >= avgScore + 10
          ? 'LEADING'
          : dept.score <= avgScore - 10
            ? 'LAGGING'
            : 'ON_TRACK',
    }));
  }

  async getRoadmapProgress(organizationId: string) {
    const actions = await this.prisma.transformationAction.findMany({
      where: { organizationId },
      select: {
        status: true,
        estimatedValue: true,
        actualValue: true,
        priority: true,
        department: true,
      },
    });

    const byStatus: Record<string, { count: number; value: number }> = {};
    const byDepartment: Record<string, { total: number; completed: number }> = {};

    for (const action of actions) {
      // By status
      if (!byStatus[action.status]) {
        byStatus[action.status] = { count: 0, value: 0 };
      }
      byStatus[action.status].count++;
      byStatus[action.status].value += action.estimatedValue || 0;

      // By department
      const dept = action.department || 'General';
      if (!byDepartment[dept]) {
        byDepartment[dept] = { total: 0, completed: 0 };
      }
      byDepartment[dept].total++;
      if (action.status === 'DEPLOYED' || action.status === 'VERIFIED') {
        byDepartment[dept].completed++;
      }
    }

    const totalActions = actions.length;
    const completedActions = actions.filter(
      (a) => a.status === 'DEPLOYED' || a.status === 'VERIFIED',
    ).length;

    return {
      totalActions,
      completedActions,
      completionRate: totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0,
      byStatus,
      byDepartment,
    };
  }

  async getValueRealization(organizationId: string) {
    const actions = await this.prisma.transformationAction.findMany({
      where: { organizationId },
      select: {
        status: true,
        estimatedValue: true,
        actualValue: true,
        department: true,
        deployedAt: true,
      },
    });

    let totalEstimated = 0;
    let totalRealized = 0;
    const timeline: { date: string; cumulative: number }[] = [];

    const deployed = actions
      .filter((a) => a.deployedAt && (a.status === 'DEPLOYED' || a.status === 'VERIFIED'))
      .sort((a, b) => a.deployedAt!.getTime() - b.deployedAt!.getTime());

    let cumulative = 0;
    for (const action of deployed) {
      const value = action.actualValue || action.estimatedValue || 0;
      cumulative += value;
      timeline.push({
        date: action.deployedAt!.toISOString(),
        cumulative,
      });
    }

    for (const action of actions) {
      totalEstimated += action.estimatedValue || 0;
      if (action.status === 'DEPLOYED' || action.status === 'VERIFIED') {
        totalRealized += action.actualValue || action.estimatedValue || 0;
      }
    }

    return {
      totalEstimated,
      totalRealized,
      realizationRate:
        totalEstimated > 0
          ? Math.round((totalRealized / totalEstimated) * 100)
          : 0,
      timeline,
    };
  }

  async getSprintVelocity(organizationId: string) {
    const sprints = await this.prisma.sprint.findMany({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: { endDate: 'asc' },
      include: {
        actions: {
          select: { status: true, estimatedValue: true },
        },
      },
    });

    const velocity = sprints.map((sprint) => {
      const completed = sprint.actions.filter(
        (a) => a.status === 'DEPLOYED' || a.status === 'VERIFIED',
      );
      return {
        sprint: sprint.name,
        number: sprint.number,
        startDate: sprint.startDate.toISOString(),
        endDate: sprint.endDate.toISOString(),
        totalActions: sprint.actions.length,
        completedActions: completed.length,
        valueDelivered: completed.reduce(
          (sum, a) => sum + (a.estimatedValue || 0),
          0,
        ),
      };
    });

    const avgVelocity =
      velocity.length > 0
        ? velocity.reduce((sum, v) => sum + v.completedActions, 0) /
          velocity.length
        : 0;

    return {
      sprints: velocity,
      averageVelocity: Math.round(avgVelocity * 10) / 10,
      trend:
        velocity.length >= 2
          ? velocity[velocity.length - 1].completedActions >
            velocity[velocity.length - 2].completedActions
            ? 'IMPROVING'
            : velocity[velocity.length - 1].completedActions <
                velocity[velocity.length - 2].completedActions
              ? 'DECLINING'
              : 'STABLE'
          : 'INSUFFICIENT_DATA',
    };
  }

  async getStackOverview(organizationId: string) {
    const tools = await this.prisma.toolEntry.findMany({
      where: { organizationId },
    });

    const totalSpend = tools.reduce((sum, t) => sum + (t.monthlyCost || 0), 0);

    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const tool of tools) {
      byCategory[tool.category] = (byCategory[tool.category] || 0) + 1;
      byStatus[tool.status] = (byStatus[tool.status] || 0) + 1;
    }

    return {
      totalTools: tools.length,
      monthlySpend: totalSpend,
      annualSpend: totalSpend * 12,
      byCategory,
      byStatus,
      activeTools: byStatus['ACTIVE'] || 0,
    };
  }

  // ── Team Readiness ─────────────────────────────────────

  async getTeamReadiness(organizationId: string) {
    const latestReport = await this.prisma.transformationReport.findFirst({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: { generatedAt: 'desc' },
    });

    const memberCount = await this.prisma.user.count({
      where: { organizationId },
    });

    const departmentScores = (latestReport?.departmentScores as any[]) || [];

    const departments = departmentScores.map((dept) => {
      let readinessStatus: 'READY' | 'DEVELOPING' | 'NOT_READY' = 'NOT_READY';
      if (dept.score >= 60) readinessStatus = 'READY';
      else if (dept.score >= 40) readinessStatus = 'DEVELOPING';

      return {
        name: dept.department,
        score: dept.score,
        maturityLevel: dept.maturityLevel,
        readinessStatus,
      };
    });

    const overallReadiness =
      departments.length > 0
        ? Math.round(
            departments.reduce((sum, d) => sum + d.score, 0) /
              departments.length,
          )
        : 0;

    return {
      departments,
      overallReadiness,
      memberCount,
    };
  }

  // ── Risk Overview ──────────────────────────────────────

  async getRiskOverview(organizationId: string) {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const [blockedActions, stalledActions, untrackedSpendTools, upcomingRenewals] =
      await Promise.all([
        this.prisma.transformationAction.count({
          where: {
            organizationId,
            blockerNote: { not: null },
          },
        }),
        this.prisma.transformationAction.count({
          where: {
            organizationId,
            status: 'IN_PROGRESS',
            updatedAt: { lt: fiveDaysAgo },
          },
        }),
        this.prisma.toolEntry.count({
          where: {
            organizationId,
            status: 'ACTIVE',
            monthlyCost: null,
          },
        }),
        this.prisma.toolEntry.count({
          where: {
            organizationId,
            contractEndDate: {
              gte: new Date(),
              lte: thirtyDaysFromNow,
            },
          },
        }),
      ]);

    // Weighted risk score (0-100)
    const riskScore = Math.min(
      100,
      blockedActions * 15 +
        stalledActions * 10 +
        untrackedSpendTools * 5 +
        upcomingRenewals * 8,
    );

    return {
      blockedActions,
      stalledActions,
      untrackedSpendTools,
      upcomingRenewals,
      riskScore,
    };
  }

  // ── Board Report PDF ───────────────────────────────────

  async generateBoardReport(organizationId: string): Promise<Buffer> {
    const [executive, velocity, stackOverview, org] = await Promise.all([
      this.getExecutiveDashboard(organizationId),
      this.getSprintVelocity(organizationId),
      this.getStackOverview(organizationId),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
      }),
    ]);

    const html = boardReportTemplate({
      companyName: org.name,
      date: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      currentScore: executive.currentScore,
      previousScore: executive.previousScore,
      maturityLevel: executive.maturityLevel,
      valueRealized: executive.tracker.valueRealized,
      valueIdentified: executive.tracker.valueIdentified,
      departmentScores: executive.departmentScores.map((d) => ({
        department: d.department,
        score: d.score,
        maturityLevel: d.status,
      })),
      topRecommendations: executive.topRecommendations.map((r) => ({
        title: r.title,
        department: r.department,
        annualValue: r.annualValue,
      })),
      sprintVelocity: velocity,
      stackOverview,
    });

    // Use puppeteer to generate PDF
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
}
