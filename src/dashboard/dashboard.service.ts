import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma';

@Injectable()
export class DashboardService {
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
}
