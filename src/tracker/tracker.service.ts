import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import {
  CreateActionDto,
  UpdateActionDto,
  MoveActionDto,
  CreateSprintDto,
  UpdateSprintDto,
  CreateCommentDto,
  BoardQueryDto,
} from './dto';
import { ActionStatus, Prisma } from '@prisma/client';
import { AiService } from '../ai';
import { SlackService } from '../integrations';

const NOTIFIABLE_STATUSES: ActionStatus[] = [
  'AWAITING_APPROVAL',
  'DEPLOYED',
  'VERIFIED',
];

@Injectable()
export class TrackerService {
  private readonly logger = new Logger(TrackerService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private slack: SlackService,
  ) {}

  // ── Board ───────────────────────────────────────────────

  async getBoardData(organizationId: string, query: BoardQueryDto) {
    const where: Prisma.TransformationActionWhereInput = {
      organizationId,
    };

    if (query.department) where.department = query.department;
    if (query.assigneeId) where.assigneeId = query.assigneeId;
    if (query.priority) where.priority = query.priority as any;
    if (query.sprintId) where.sprintId = query.sprintId;

    const actions = await this.prisma.transformationAction.findMany({
      where,
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        sprint: { select: { id: true, name: true } },
        _count: { select: { comments: true } },
      },
      orderBy: [{ orderIndex: 'asc' }, { createdAt: 'asc' }],
    });

    const columns: Record<string, typeof actions> = {
      BACKLOG: [],
      THIS_SPRINT: [],
      IN_PROGRESS: [],
      AWAITING_APPROVAL: [],
      DEPLOYED: [],
      VERIFIED: [],
    };

    for (const action of actions) {
      columns[action.status]?.push(action);
    }

    return { columns };
  }

  // ── Actions CRUD ────────────────────────────────────────

  async createAction(organizationId: string, dto: CreateActionDto) {
    return this.prisma.transformationAction.create({
      data: {
        organizationId,
        title: dto.title,
        description: dto.description,
        department: dto.department,
        category: dto.category,
        priority: (dto.priority as any) || 'MEDIUM',
        estimatedValue: dto.estimatedValue,
        estimatedEffort: dto.estimatedEffort as any,
        phase: dto.phase,
        assigneeId: dto.assigneeId,
        sprintId: dto.sprintId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  async getAction(actionId: string, organizationId: string) {
    const action = await this.prisma.transformationAction.findUnique({
      where: { id: actionId },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        sprint: { select: { id: true, name: true, status: true } },
        comments: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!action) throw new NotFoundException('Action not found');
    if (action.organizationId !== organizationId) {
      throw new ForbiddenException('Action does not belong to your organization');
    }

    return action;
  }

  async updateAction(
    actionId: string,
    organizationId: string,
    dto: UpdateActionDto,
  ) {
    const before = await this.findActionOrFail(actionId, organizationId);

    const updated = await this.prisma.transformationAction.update({
      where: { id: actionId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.status !== undefined && { status: dto.status as any }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.department !== undefined && { department: dto.department }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.priority !== undefined && { priority: dto.priority as any }),
        ...(dto.estimatedValue !== undefined && { estimatedValue: dto.estimatedValue }),
        ...(dto.actualValue !== undefined && { actualValue: dto.actualValue }),
        ...(dto.estimatedEffort !== undefined && { estimatedEffort: dto.estimatedEffort as any }),
        ...(dto.assigneeId !== undefined && { assigneeId: dto.assigneeId || null }),
        ...(dto.sprintId !== undefined && { sprintId: dto.sprintId || null }),
        ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
        ...(dto.blockerNote !== undefined && { blockerNote: dto.blockerNote || null }),
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (
      dto.status !== undefined &&
      before.status !== updated.status &&
      NOTIFIABLE_STATUSES.includes(updated.status)
    ) {
      this.slack
        .notifyActionStatusChange(organizationId, updated.title, before.status, updated.status)
        .catch(() => {});
    }

    return updated;
  }

  async moveAction(
    actionId: string,
    organizationId: string,
    dto: MoveActionDto,
  ) {
    const action = await this.findActionOrFail(actionId, organizationId);

    const now = new Date();
    const timestamps: Prisma.TransformationActionUpdateInput = {};

    // Set timestamps based on status transitions
    if (dto.status === 'IN_PROGRESS') timestamps.startedAt = now;
    if (dto.status === 'DEPLOYED') timestamps.deployedAt = now;
    if (dto.status === 'VERIFIED') timestamps.verifiedAt = now;

    const updated = await this.prisma.transformationAction.update({
      where: { id: actionId },
      data: {
        status: dto.status as ActionStatus,
        orderIndex: dto.orderIndex,
        ...timestamps,
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    const newStatus = dto.status as ActionStatus;
    if (
      action.status !== newStatus &&
      NOTIFIABLE_STATUSES.includes(newStatus)
    ) {
      this.slack
        .notifyActionStatusChange(organizationId, action.title, action.status, newStatus)
        .catch(() => {});
    }

    // Auto-advance sprint when all actions are DEPLOYED or VERIFIED
    if (dto.status === 'DEPLOYED' || dto.status === 'VERIFIED') {
      await this.maybeCompleteSprint(actionId, organizationId);
    }

    return updated;
  }

  /**
   * Marks the action's parent sprint as COMPLETED if every action in the
   * sprint is now DEPLOYED or VERIFIED. Idempotent: if the sprint isn't
   * eligible or is already completed, this is a no-op. Called from
   * moveAction (manual drag-drop) and from PlanExecutorService after a plan
   * auto-deploys its action, so both paths trigger sprint roll-up.
   */
  async maybeCompleteSprint(actionId: string, organizationId: string) {
    const action = await this.prisma.transformationAction.findUnique({
      where: { id: actionId },
      select: { sprintId: true },
    });

    if (!action?.sprintId) return;

    const sprintActions = await this.prisma.transformationAction.findMany({
      where: { sprintId: action.sprintId },
      select: { status: true },
    });

    const allDone = sprintActions.every(
      (a) => a.status === 'DEPLOYED' || a.status === 'VERIFIED',
    );

    if (!allDone) return;

    const sprint = await this.prisma.sprint.findUnique({
      where: { id: action.sprintId },
      select: { status: true },
    });
    if (!sprint || sprint.status === 'COMPLETED') return;

    const updated = await this.prisma.sprint.update({
      where: { id: action.sprintId },
      data: { status: 'COMPLETED' },
    });
    this.logger.log(
      `Sprint ${action.sprintId} auto-completed — all actions deployed/verified`,
    );

    this.slack
      .notifySprintCompleted(organizationId, updated.name, sprintActions.length)
      .catch(() => {});
  }

  async deleteAction(actionId: string, organizationId: string) {
    await this.findActionOrFail(actionId, organizationId);

    await this.prisma.transformationAction.delete({
      where: { id: actionId },
    });

    return { success: true };
  }

  // ── Import from Report ──────────────────────────────────

  async importFromReport(sessionId: string, organizationId: string) {
    const report = await this.prisma.transformationReport.findUnique({
      where: { sessionId },
    });

    if (!report) throw new NotFoundException('Report not found for this session');
    if (report.organizationId !== organizationId) {
      throw new ForbiddenException('Report does not belong to your organization');
    }
    if (report.status !== 'COMPLETED') {
      throw new ConflictException('Report is not completed yet');
    }

    // Check for existing imports from this session
    const existing = await this.prisma.transformationAction.findMany({
      where: { organizationId, sessionId },
      select: { sourceRecommendationId: true },
    });
    const existingIds = new Set(
      existing
        .map((e) => e.sourceRecommendationId)
        .filter((id): id is string => id !== null),
    );

    // Prefer the new decision-block shape; fall back to legacy recommendations
    // for reports generated before the briefing migration.
    const decisionBlocks = (report.decisionBlocks as any[]) || [];
    const toCreate =
      decisionBlocks.length > 0
        ? this.buildImportRowsFromDecisionBlocks(
            decisionBlocks,
            report.reportGoal,
            existingIds,
            organizationId,
            sessionId,
          )
        : this.buildImportRowsFromLegacyRecommendations(
            (report.recommendations as any[]) || [],
            (report.implementationPlan as any[]) || [],
            existingIds,
            organizationId,
            sessionId,
          );

    if (toCreate.length === 0) {
      return { imported: 0, skipped: existingIds.size };
    }

    await this.prisma.transformationAction.createMany({
      data: toCreate as any,
    });

    return { imported: toCreate.length, skipped: existing.length };
  }

  private buildImportRowsFromDecisionBlocks(
    decisionBlocks: any[],
    reportGoal: string | null,
    existingIds: Set<string>,
    organizationId: string,
    sessionId: string,
  ) {
    const category = this.categoryForGoal(reportGoal);
    const rows: any[] = [];
    let orderIndex = 0;

    for (const block of decisionBlocks) {
      const actions = block.ninetyDayPlan?.actions || [];
      const perActionValue =
        actions.length > 0
          ? Math.round((block.value?.high || 0) / actions.length)
          : 0;
      const priority = this.priorityFromValue(block.value?.high);

      for (const [idx, action] of actions.entries()) {
        const sourceId = `${block.id || 'block'}-${idx}`;
        if (existingIds.has(sourceId)) continue;

        rows.push({
          organizationId,
          sessionId,
          sourceRecommendationId: sourceId,
          title: action.title,
          description: `${block.decision}${action.successSignal ? ' — ' + action.successSignal : ''}`,
          department: action.ownerRole || block.ownership?.accountableRole || null,
          category,
          priority,
          estimatedValue: perActionValue,
          estimatedEffort: this.mapEffortFromWeek(action.week),
          phase: 1, // 90-day plan items are phase-1 by definition
          orderIndex: orderIndex++,
        });
      }
    }

    return rows;
  }

  private buildImportRowsFromLegacyRecommendations(
    recommendations: any[],
    implementationPlan: any[],
    existingIds: Set<string>,
    organizationId: string,
    sessionId: string,
  ) {
    const phaseLookup = new Map<string, number>();
    for (const phase of implementationPlan) {
      for (const action of phase.actions || []) {
        phaseLookup.set(action.title, phase.phase);
      }
    }

    return recommendations
      .filter((rec) => !existingIds.has(rec.id))
      .map((rec, index) => ({
        organizationId,
        sessionId,
        sourceRecommendationId: rec.id,
        title: rec.title,
        description: rec.description,
        department: rec.department,
        category: rec.category,
        priority: this.mapImpactToPriority(rec.impact),
        estimatedValue: rec.annualValue || 0,
        estimatedEffort: this.mapEffort(rec.effort),
        phase: phaseLookup.get(rec.title) || null,
        orderIndex: index,
      }));
  }

  private categoryForGoal(goal: string | null): string {
    switch (goal) {
      case 'Explore':
        return 'GROWTH';
      case 'Validate':
        return 'INTELLIGENCE';
      case 'Decide':
      case 'Align':
      default:
        return 'EFFICIENCY';
    }
  }

  private priorityFromValue(value: number | undefined): string {
    if (!value || value <= 0) return 'MEDIUM';
    if (value >= 5_000_000) return 'HIGH';
    if (value >= 1_000_000) return 'MEDIUM';
    return 'LOW';
  }

  private mapEffortFromWeek(week: string | undefined): string | null {
    if (!week) return 'WEEKS';
    const lowered = week.toLowerCase();
    if (lowered.includes('quarter') || lowered.includes('month')) return 'MONTHS';
    if (lowered.includes('week 1') || lowered.includes('1-2')) return 'DAYS';
    return 'WEEKS';
  }

  // ── Sprints ─────────────────────────────────────────────

  async listSprints(organizationId: string) {
    return this.prisma.sprint.findMany({
      where: { organizationId },
      include: {
        _count: { select: { actions: true } },
      },
      orderBy: { number: 'desc' },
    });
  }

  async createSprint(organizationId: string, dto: CreateSprintDto) {
    // Auto-increment sprint number
    const lastSprint = await this.prisma.sprint.findFirst({
      where: { organizationId },
      orderBy: { number: 'desc' },
    });

    return this.prisma.sprint.create({
      data: {
        organizationId,
        name: dto.name,
        number: (lastSprint?.number || 0) + 1,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        goal: dto.goal,
      },
    });
  }

  async updateSprint(
    sprintId: string,
    organizationId: string,
    dto: UpdateSprintDto,
  ) {
    await this.findSprintOrFail(sprintId, organizationId);

    return this.prisma.sprint.update({
      where: { id: sprintId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
        ...(dto.goal !== undefined && { goal: dto.goal }),
        ...(dto.status !== undefined && { status: dto.status as any }),
      },
      include: {
        _count: { select: { actions: true } },
      },
    });
  }

  // ── Comments ────────────────────────────────────────────

  async listComments(actionId: string, organizationId: string) {
    await this.findActionOrFail(actionId, organizationId);

    return this.prisma.actionComment.findMany({
      where: { actionId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addComment(
    actionId: string,
    userId: string,
    organizationId: string,
    dto: CreateCommentDto,
  ) {
    await this.findActionOrFail(actionId, organizationId);

    return this.prisma.actionComment.create({
      data: {
        actionId,
        userId,
        content: dto.content,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
  }

  // ── Stats ───────────────────────────────────────────────

  async getStats(organizationId: string) {
    const actions = await this.prisma.transformationAction.findMany({
      where: { organizationId },
      select: { status: true, estimatedValue: true, blockerNote: true },
    });

    const byStatus: Record<string, number> = {
      BACKLOG: 0,
      THIS_SPRINT: 0,
      IN_PROGRESS: 0,
      AWAITING_APPROVAL: 0,
      DEPLOYED: 0,
      VERIFIED: 0,
    };

    let valueIdentified = 0;
    let valueRealized = 0;
    let blockedCount = 0;

    for (const action of actions) {
      byStatus[action.status]++;
      valueIdentified += action.estimatedValue || 0;

      if (action.status === 'DEPLOYED' || action.status === 'VERIFIED') {
        valueRealized += action.estimatedValue || 0;
      }

      if (action.blockerNote) {
        blockedCount++;
      }
    }

    return {
      total: actions.length,
      byStatus,
      valueIdentified,
      valueRealized,
      blockedCount,
      activeActions: byStatus.IN_PROGRESS,
      completedActions: byStatus.DEPLOYED + byStatus.VERIFIED,
    };
  }

  // ── Stalled Actions ─────────────────────────────────────

  async getStalledActions(organizationId: string) {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    return this.prisma.transformationAction.findMany({
      where: {
        organizationId,
        status: { in: ['IN_PROGRESS', 'AWAITING_APPROVAL'] },
        updatedAt: { lt: fiveDaysAgo },
      },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
        sprint: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  // ── AI Next-Action Suggestion ──────────────────────────

  async suggestNextAction(organizationId: string) {
    const [candidates, inProgressCount, awaitingApprovalCount, org] =
      await Promise.all([
        this.prisma.transformationAction.findMany({
          where: {
            organizationId,
            status: { in: ['BACKLOG', 'THIS_SPRINT'] },
          },
          select: {
            id: true,
            title: true,
            description: true,
            department: true,
            priority: true,
            estimatedValue: true,
            estimatedEffort: true,
            phase: true,
            status: true,
          },
          orderBy: [{ phase: 'asc' }, { orderIndex: 'asc' }],
        }),
        this.prisma.transformationAction.count({
          where: { organizationId, status: 'IN_PROGRESS' },
        }),
        this.prisma.transformationAction.count({
          where: { organizationId, status: 'AWAITING_APPROVAL' },
        }),
        this.prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          include: { industry: true },
        }),
      ]);

    if (candidates.length === 0) {
      return {
        suggestion: null as null,
        message:
          'No actions available to start. Import from a report or create actions first.',
      };
    }

    const ai = await this.aiService.suggestNextAction({
      candidates: candidates.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        department: c.department,
        priority: c.priority,
        estimatedValue: c.estimatedValue,
        estimatedEffort: c.estimatedEffort,
        phase: c.phase,
        status: c.status,
      })),
      inProgressCount,
      awaitingApprovalCount,
      orgName: org.name,
      industry: org.industry.name,
    });

    const action = candidates.find((c) => c.id === ai.actionId);
    if (!action) {
      throw new NotFoundException(
        'AI suggested an action that no longer exists',
      );
    }

    return {
      suggestion: {
        action,
        reason: ai.reason,
      },
    };
  }

  // ── AI Sprint Suggestion ───────────────────────────────

  async suggestSprint(organizationId: string) {
    const [backlogActions, completedSprints, org] = await Promise.all([
      this.prisma.transformationAction.findMany({
        where: { organizationId, status: 'BACKLOG' },
        select: {
          id: true,
          title: true,
          department: true,
          priority: true,
          estimatedValue: true,
          estimatedEffort: true,
          phase: true,
        },
      }),
      this.prisma.sprint.findMany({
        where: { organizationId, status: 'COMPLETED' },
        include: {
          actions: { select: { status: true } },
        },
      }),
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        include: { industry: true },
      }),
    ]);

    if (backlogActions.length === 0) {
      return { message: 'No backlog actions available for sprint planning' };
    }

    const totalSprints = completedSprints.length;
    const avgVelocity =
      totalSprints > 0
        ? completedSprints.reduce(
            (sum, s) =>
              sum +
              s.actions.filter(
                (a) => a.status === 'DEPLOYED' || a.status === 'VERIFIED',
              ).length,
            0,
          ) / totalSprints
        : 6;

    return this.aiService.suggestSprint({
      backlogActions: backlogActions.map((a) => ({
        id: a.id,
        title: a.title,
        department: a.department,
        priority: a.priority,
        estimatedValue: a.estimatedValue,
        estimatedEffort: a.estimatedEffort,
        phase: a.phase,
      })),
      currentSprintCount: await this.prisma.sprint.count({
        where: { organizationId },
      }),
      averageVelocity: Math.round(avgVelocity * 10) / 10,
      orgName: org.name,
      industry: org.industry.name,
    });
  }

  // ── Helpers ─────────────────────────────────────────────

  private async findActionOrFail(actionId: string, organizationId: string) {
    const action = await this.prisma.transformationAction.findUnique({
      where: { id: actionId },
    });

    if (!action) throw new NotFoundException('Action not found');
    if (action.organizationId !== organizationId) {
      throw new ForbiddenException('Action does not belong to your organization');
    }

    return action;
  }

  private async findSprintOrFail(sprintId: string, organizationId: string) {
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
    });

    if (!sprint) throw new NotFoundException('Sprint not found');
    if (sprint.organizationId !== organizationId) {
      throw new ForbiddenException('Sprint does not belong to your organization');
    }

    return sprint;
  }

  private mapImpactToPriority(impact: string): string {
    switch (impact?.toUpperCase()) {
      case 'HIGH':
        return 'HIGH';
      case 'MEDIUM':
        return 'MEDIUM';
      case 'LOW':
        return 'LOW';
      default:
        return 'MEDIUM';
    }
  }

  private mapEffort(effort: string): string | null {
    switch (effort?.toUpperCase()) {
      case 'LOW':
        return 'DAYS';
      case 'MEDIUM':
        return 'WEEKS';
      case 'HIGH':
        return 'MONTHS';
      default:
        return null;
    }
  }
}
