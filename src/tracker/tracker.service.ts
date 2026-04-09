import {
  Injectable,
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

@Injectable()
export class TrackerService {
  constructor(private prisma: PrismaService) {}

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
    await this.findActionOrFail(actionId, organizationId);

    return this.prisma.transformationAction.update({
      where: { id: actionId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
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
  }

  async moveAction(
    actionId: string,
    organizationId: string,
    dto: MoveActionDto,
  ) {
    await this.findActionOrFail(actionId, organizationId);

    const now = new Date();
    const timestamps: Prisma.TransformationActionUpdateInput = {};

    // Set timestamps based on status transitions
    if (dto.status === 'IN_PROGRESS') timestamps.startedAt = now;
    if (dto.status === 'DEPLOYED') timestamps.deployedAt = now;
    if (dto.status === 'VERIFIED') timestamps.verifiedAt = now;

    return this.prisma.transformationAction.update({
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

    const recommendations = (report.recommendations as any[]) || [];
    const implementationPlan = (report.implementationPlan as any[]) || [];

    // Build phase lookup from implementation plan
    const phaseLookup = new Map<string, number>();
    for (const phase of implementationPlan) {
      for (const action of phase.actions || []) {
        phaseLookup.set(action.title, phase.phase);
      }
    }

    // Check for existing imports from this session
    const existing = await this.prisma.transformationAction.findMany({
      where: { organizationId, sessionId },
      select: { sourceRecommendationId: true },
    });
    const existingIds = new Set(existing.map((e) => e.sourceRecommendationId));

    const toCreate = recommendations
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

    if (toCreate.length === 0) {
      return { imported: 0, skipped: existingIds.size };
    }

    await this.prisma.transformationAction.createMany({
      data: toCreate as any,
    });

    return { imported: toCreate.length, skipped: existing.length };
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
