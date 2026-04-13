import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import { CreateToolDto } from './dto/create-tool.dto';
import { UpdateToolDto } from './dto/update-tool.dto';
import { CreateSpendDto } from './dto/create-spend.dto';
import { Prisma } from '@prisma/client';
import { AiService } from '../ai';

@Injectable()
export class StackService {
  private readonly logger = new Logger(StackService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
  ) {}

  async getInventory(
    organizationId: string,
    filters?: { category?: string; status?: string; source?: string },
  ) {
    const where: Prisma.ToolEntryWhereInput = { organizationId };

    if (filters?.category) {
      where.category = filters.category as any;
    }
    if (filters?.status) {
      where.status = filters.status as any;
    }
    if (filters?.source) {
      where.source = filters.source as any;
    }

    return this.prisma.toolEntry.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  }

  async addTool(organizationId: string, dto: CreateToolDto) {
    try {
      return await this.prisma.toolEntry.create({
        data: {
          organizationId,
          name: dto.name,
          category: (dto.category as any) || 'OTHER',
          source: 'MANUAL',
          status: (dto.status as any) || 'IDENTIFIED',
          departmentIds: dto.departmentIds || undefined,
          monthlyCost: dto.monthlyCost,
          userCount: dto.userCount,
          rating: dto.rating,
          notes: dto.notes,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Tool "${dto.name}" already exists in this organization`,
        );
      }
      throw error;
    }
  }

  async updateTool(id: string, organizationId: string, dto: UpdateToolDto) {
    const tool = await this.prisma.toolEntry.findFirst({
      where: { id, organizationId },
    });

    if (!tool) {
      throw new NotFoundException('Tool not found');
    }

    return this.prisma.toolEntry.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category as any }),
        ...(dto.status !== undefined && { status: dto.status as any }),
        ...(dto.departmentIds !== undefined && {
          departmentIds: dto.departmentIds,
        }),
        ...(dto.monthlyCost !== undefined && { monthlyCost: dto.monthlyCost }),
        ...(dto.userCount !== undefined && { userCount: dto.userCount }),
        ...(dto.rating !== undefined && { rating: dto.rating }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.utilizationPercent !== undefined && {
          utilizationPercent: dto.utilizationPercent,
        }),
        ...(dto.contractStartDate !== undefined && {
          contractStartDate: dto.contractStartDate
            ? new Date(dto.contractStartDate)
            : null,
        }),
        ...(dto.contractEndDate !== undefined && {
          contractEndDate: dto.contractEndDate
            ? new Date(dto.contractEndDate)
            : null,
        }),
        ...(dto.renewalAlertDays !== undefined && {
          renewalAlertDays: dto.renewalAlertDays,
        }),
      },
    });
  }

  async removeTool(id: string, organizationId: string) {
    const tool = await this.prisma.toolEntry.findFirst({
      where: { id, organizationId },
    });

    if (!tool) {
      throw new NotFoundException('Tool not found');
    }

    await this.prisma.toolEntry.delete({ where: { id } });
    return { message: 'Tool removed' };
  }

  async getStackSummary(organizationId: string) {
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

    const toolsWithUtilization = tools.filter(
      (t) => t.utilizationPercent != null,
    );
    const avgUtilization =
      toolsWithUtilization.length > 0
        ? Math.round(
            toolsWithUtilization.reduce(
              (sum, t) => sum + t.utilizationPercent!,
              0,
            ) / toolsWithUtilization.length,
          )
        : null;

    return {
      totalTools: tools.length,
      monthlySpend: totalSpend,
      annualSpend: totalSpend * 12,
      byCategory,
      byStatus,
      avgUtilization,
    };
  }

  async getRecommendations(organizationId: string) {
    // Get tools already in inventory
    const existingTools = await this.prisma.toolEntry.findMany({
      where: { organizationId },
      select: { name: true },
    });
    const existingNames = new Set(
      existingTools.map((t) => t.name.toLowerCase()),
    );

    // Get latest report's recommendations that mention tools
    const latestReport = await this.prisma.transformationReport.findFirst({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: { generatedAt: 'desc' },
    });

    if (!latestReport?.recommendations) {
      return [];
    }

    const recommendations = latestReport.recommendations as any[];

    // Filter to recommendations that aren't already in inventory
    return recommendations
      .filter((rec) => {
        const title = (rec.title || '').toLowerCase();
        return !existingNames.has(title);
      })
      .map((rec) => ({
        title: rec.title,
        description: rec.description,
        department: rec.department,
        annualValue: rec.annualValue,
        impact: rec.impact,
        effort: rec.effort,
      }));
  }

  /**
   * Sync tools from a completed transformation report into the tool inventory.
   * Extracts tool names from recommendations.
   */
  async syncFromReport(organizationId: string, reportId: string) {
    const report = await this.prisma.transformationReport.findUnique({
      where: { id: reportId },
    });

    if (!report?.recommendations) return { synced: 0 };

    const recommendations = report.recommendations as any[];
    let synced = 0;

    for (const rec of recommendations) {
      if (!rec.title) continue;

      try {
        await this.prisma.toolEntry.upsert({
          where: {
            organizationId_name: {
              organizationId,
              name: rec.title,
            },
          },
          create: {
            organizationId,
            name: rec.title,
            category: this.inferCategory(rec.category || rec.department),
            source: 'RECOMMENDATION',
            sourceId: reportId,
            status: 'IDENTIFIED',
          },
          update: {}, // Don't overwrite existing entries
        });
        synced++;
      } catch {
        // Skip duplicates or errors
      }
    }

    this.logger.log(
      `Synced ${synced} tools from report ${reportId} for org ${organizationId}`,
    );
    return { synced };
  }

  /**
   * Sync tools from a discovery scan into the tool inventory.
   */
  async syncFromDiscovery(organizationId: string, discoveryId: string) {
    const discovery = await this.prisma.discoveryReport.findUnique({
      where: { id: discoveryId },
    });

    if (!discovery?.techStack) return { synced: 0 };

    const techStack = discovery.techStack as any[];
    let synced = 0;

    for (const tool of techStack) {
      if (!tool.name) continue;

      try {
        await this.prisma.toolEntry.upsert({
          where: {
            organizationId_name: {
              organizationId,
              name: tool.name,
            },
          },
          create: {
            organizationId,
            name: tool.name,
            category: (tool.category as any) || 'OTHER',
            source: 'DISCOVERY',
            sourceId: discoveryId,
            status: 'IDENTIFIED',
          },
          update: {},
        });
        synced++;
      } catch {
        // Skip errors
      }
    }

    this.logger.log(
      `Synced ${synced} tools from discovery ${discoveryId} for org ${organizationId}`,
    );
    return { synced };
  }

  /**
   * Sync tools from onboarding data (selectedTools).
   */
  async syncFromOnboarding(organizationId: string) {
    const onboarding = await this.prisma.onboarding.findUnique({
      where: { organizationId },
      select: { selectedTools: true, customTools: true },
    });

    if (!onboarding) return { synced: 0 };

    const tools = [
      ...onboarding.selectedTools,
      ...(onboarding.customTools
        ? onboarding.customTools.split(',').map((t) => t.trim())
        : []),
    ].filter(Boolean);

    let synced = 0;

    for (const toolName of tools) {
      try {
        await this.prisma.toolEntry.upsert({
          where: {
            organizationId_name: {
              organizationId,
              name: toolName,
            },
          },
          create: {
            organizationId,
            name: toolName,
            category: this.inferCategory(toolName),
            source: 'ONBOARDING',
            status: 'ACTIVE',
          },
          update: {},
        });
        synced++;
      } catch {
        // Skip errors
      }
    }

    this.logger.log(
      `Synced ${synced} tools from onboarding for org ${organizationId}`,
    );
    return { synced };
  }

  /**
   * Full sync from all sources.
   */
  async syncAll(organizationId: string) {
    const onboardingResult = await this.syncFromOnboarding(organizationId);

    // Sync from latest report
    const latestReport = await this.prisma.transformationReport.findFirst({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: { generatedAt: 'desc' },
    });
    const reportResult = latestReport
      ? await this.syncFromReport(organizationId, latestReport.id)
      : { synced: 0 };

    // Sync from latest discovery
    const latestDiscovery = await this.prisma.discoveryReport.findFirst({
      where: { organizationId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
    });
    const discoveryResult = latestDiscovery
      ? await this.syncFromDiscovery(organizationId, latestDiscovery.id)
      : { synced: 0 };

    return {
      onboarding: onboardingResult.synced,
      report: reportResult.synced,
      discovery: discoveryResult.synced,
      total:
        onboardingResult.synced +
        reportResult.synced +
        discoveryResult.synced,
    };
  }

  // ── Spend Tracking ──────────────────────────────────────

  async addSpendRecord(organizationId: string, dto: CreateSpendDto) {
    // Verify tool belongs to org
    const tool = await this.prisma.toolEntry.findFirst({
      where: { id: dto.toolEntryId, organizationId },
    });
    if (!tool) throw new NotFoundException('Tool not found');

    return this.prisma.toolSpendRecord.upsert({
      where: {
        toolEntryId_month: {
          toolEntryId: dto.toolEntryId,
          month: new Date(dto.month),
        },
      },
      create: {
        toolEntryId: dto.toolEntryId,
        organizationId,
        month: new Date(dto.month),
        amount: dto.amount,
        notes: dto.notes,
      },
      update: {
        amount: dto.amount,
        notes: dto.notes,
      },
    });
  }

  async getSpendTrends(organizationId: string, months: number = 12) {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    const records = await this.prisma.toolSpendRecord.findMany({
      where: {
        organizationId,
        month: { gte: since },
      },
      include: {
        toolEntry: { select: { name: true, category: true } },
      },
      orderBy: { month: 'asc' },
    });

    // Group by month
    const monthlyMap = new Map<
      string,
      { total: number; byTool: { name: string; amount: number }[] }
    >();

    for (const record of records) {
      const monthKey = record.month.toISOString().slice(0, 7); // YYYY-MM
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { total: 0, byTool: [] });
      }
      const entry = monthlyMap.get(monthKey)!;
      entry.total += record.amount;
      entry.byTool.push({ name: record.toolEntry.name, amount: record.amount });
    }

    const monthly = Array.from(monthlyMap.entries()).map(([month, data]) => ({
      month,
      total: data.total,
      byTool: data.byTool,
    }));

    // Determine trend
    let trend: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
    if (monthly.length >= 2) {
      const recent = monthly[monthly.length - 1].total;
      const previous = monthly[monthly.length - 2].total;
      if (recent > previous * 1.05) trend = 'UP';
      else if (recent < previous * 0.95) trend = 'DOWN';
    }

    return { monthly, trend };
  }

  // ── ROI Calculator ─────────────────────────────────────

  async getToolROI(organizationId: string) {
    const tools = await this.prisma.toolEntry.findMany({
      where: { organizationId, status: 'ACTIVE' },
    });

    const actions = await this.prisma.transformationAction.findMany({
      where: {
        organizationId,
        status: { in: ['DEPLOYED', 'VERIFIED'] },
      },
      select: { title: true, description: true, estimatedValue: true },
    });

    const toolResults = tools.map((tool) => {
      const monthlyCost = tool.monthlyCost || 0;
      const annualCost = monthlyCost * 12;

      // Cross-reference with deployed actions that mention the tool
      const relatedActions = actions.filter((a) => {
        const searchText = `${a.title} ${a.description || ''}`.toLowerCase();
        return searchText.includes(tool.name.toLowerCase());
      });

      const estimatedValue = relatedActions.reduce(
        (sum, a) => sum + (a.estimatedValue || 0),
        0,
      );

      const roi =
        monthlyCost > 0
          ? Math.round(((estimatedValue - annualCost) / annualCost) * 100)
          : null;

      let roiStatus: 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN' = 'UNKNOWN';
      if (roi !== null) {
        roiStatus = roi >= 0 ? 'POSITIVE' : 'NEGATIVE';
      }

      return {
        name: tool.name,
        monthlyCost,
        annualCost,
        estimatedValue,
        roi,
        roiStatus,
      };
    });

    return {
      tools: toolResults,
      totalAnnualCost: toolResults.reduce((sum, t) => sum + t.annualCost, 0),
      totalEstimatedValue: toolResults.reduce(
        (sum, t) => sum + t.estimatedValue,
        0,
      ),
    };
  }

  // ── Overlap Detection ──────────────────────────────────

  async detectOverlaps(organizationId: string) {
    const [tools, org] = await Promise.all([
      this.prisma.toolEntry.findMany({
        where: { organizationId },
        select: {
          name: true,
          category: true,
          notes: true,
          monthlyCost: true,
        },
      }),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: { industry: true },
      }),
    ]);

    if (tools.length < 2) {
      return {
        overlaps: [],
        summary: 'Not enough tools in inventory to detect overlaps.',
      };
    }

    return this.aiService.detectOverlaps({
      tools: tools.map((t) => ({
        name: t.name,
        category: t.category,
        notes: t.notes,
        monthlyCost: t.monthlyCost,
      })),
      industry: org.industry.name,
    });
  }

  // ── Renewal Intelligence ───────────────────────────────

  async getUpcomingRenewals(organizationId: string) {
    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 90);

    return this.prisma.toolEntry.findMany({
      where: {
        organizationId,
        contractEndDate: {
          gte: now,
          lte: thirtyDaysFromNow,
        },
      },
      orderBy: { contractEndDate: 'asc' },
    });
  }

  private inferCategory(hint?: string): any {
    if (!hint) return 'OTHER';
    const lower = hint.toLowerCase();

    if (/ai|ml|machine learning|claude|gpt|openai|anthropic/i.test(lower))
      return 'AI_PLATFORM';
    if (/automat|zapier|make|n8n|rpa|workflow/i.test(lower))
      return 'AUTOMATION';
    if (/analytics|tableau|looker|power bi|reporting/i.test(lower))
      return 'ANALYTICS';
    if (/crm|salesforce|hubspot|pipedrive/i.test(lower)) return 'CRM';
    if (/slack|teams|communication|email/i.test(lower))
      return 'COMMUNICATION';
    if (/dev|github|gitlab|copilot|cursor|code/i.test(lower))
      return 'DEVELOPMENT';
    if (/secur|compliance|governance/i.test(lower)) return 'SECURITY';

    return 'OTHER';
  }
}
