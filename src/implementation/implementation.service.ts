import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma';
import { CreatePlanDto, PlanQueryDto, RefinePlanDto, RejectPlanDto } from './dto';

@Injectable()
export class ImplementationService {
  private readonly logger = new Logger(ImplementationService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('implementation') private implementationQueue: Queue,
  ) {}

  // ── Create Plan ────────────────────────────────────────

  async createPlan(
    organizationId: string,
    userId: string,
    dto: CreatePlanDto,
  ) {
    // Verify the action belongs to this org
    const action = await this.prisma.transformationAction.findFirst({
      where: { id: dto.actionId, organizationId },
    });

    if (!action) {
      throw new NotFoundException('Action not found in this organization');
    }

    // Create the plan record
    const plan = await this.prisma.deploymentPlan.create({
      data: {
        organizationId,
        actionId: dto.actionId,
        userId,
        title: `Deployment Plan: ${action.title}`,
        status: 'DRAFT',
      },
    });

    // Queue the AI planning job
    await this.implementationQueue.add(
      'generate-plan',
      { planId: plan.id, actionId: dto.actionId, orgId: organizationId },
      { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
    );

    this.logger.log(
      `Plan ${plan.id} created for action ${dto.actionId}, generation queued`,
    );

    return { id: plan.id, status: plan.status };
  }

  // ── List Plans ─────────────────────────────────────────

  async listPlans(organizationId: string, query: PlanQueryDto) {
    const where: Record<string, unknown> = { organizationId };
    if (query.status) where.status = query.status;
    if (query.actionId) where.actionId = query.actionId;

    return this.prisma.deploymentPlan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        action: { select: { id: true, title: true, status: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { artifacts: true } },
      },
    });
  }

  // ── Get Plan ───────────────────────────────────────────

  async getPlan(id: string, organizationId: string) {
    const plan = await this.prisma.deploymentPlan.findFirst({
      where: { id, organizationId },
      include: {
        action: { select: { id: true, title: true, status: true, department: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        artifacts: { orderBy: { orderIndex: 'asc' } },
      },
    });

    if (!plan) {
      throw new NotFoundException('Deployment plan not found');
    }

    // Strip conversation history from response (it's large)
    const { conversationHistory: _, ...planData } = plan;
    return planData;
  }

  // ── Refine Plan ────────────────────────────────────────

  async refinePlan(
    id: string,
    organizationId: string,
    dto: RefinePlanDto,
  ) {
    const plan = await this.prisma.deploymentPlan.findFirst({
      where: { id, organizationId },
    });

    if (!plan) {
      throw new NotFoundException('Deployment plan not found');
    }

    if (plan.status !== 'PLAN_READY' && plan.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot refine plan in ${plan.status} status`,
      );
    }

    await this.implementationQueue.add(
      'refine-plan',
      { planId: id, orgId: organizationId, userMessage: dto.message },
      { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
    );

    this.logger.log(`Plan ${id} refinement queued`);

    return { id, status: 'PLANNING' };
  }

  // ── Approve Plan ───────────────────────────────────────

  async approvePlan(id: string, organizationId: string, userId: string) {
    const plan = await this.prisma.deploymentPlan.findFirst({
      where: { id, organizationId },
    });

    if (!plan) {
      throw new NotFoundException('Deployment plan not found');
    }

    if (plan.status !== 'PLAN_READY') {
      throw new BadRequestException(
        `Cannot approve plan in ${plan.status} status — must be PLAN_READY`,
      );
    }

    // Update plan status
    await this.prisma.deploymentPlan.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: userId },
    });

    // Auto-advance action to AWAITING_APPROVAL
    await this.prisma.transformationAction.update({
      where: { id: plan.actionId },
      data: { status: 'AWAITING_APPROVAL' },
    });

    // Queue artifact generation
    await this.implementationQueue.add(
      'generate-artifacts',
      { planId: id, orgId: organizationId },
      { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
    );

    this.logger.log(
      `Plan ${id} approved by ${userId}, artifact generation queued`,
    );

    return { id, status: 'APPROVED' };
  }

  // ── Reject Plan ────────────────────────────────────────

  async rejectPlan(
    id: string,
    organizationId: string,
    dto: RejectPlanDto,
  ) {
    const plan = await this.prisma.deploymentPlan.findFirst({
      where: { id, organizationId },
    });

    if (!plan) {
      throw new NotFoundException('Deployment plan not found');
    }

    if (plan.status !== 'PLAN_READY') {
      throw new BadRequestException(
        `Cannot reject plan in ${plan.status} status — must be PLAN_READY`,
      );
    }

    await this.prisma.deploymentPlan.update({
      where: { id },
      data: { status: 'DRAFT', rejectionNote: dto.note || null },
    });

    this.logger.log(`Plan ${id} rejected`);

    return { id, status: 'DRAFT' };
  }

  // ── Execute (manual artifact generation) ───────────────

  async executePlan(id: string, organizationId: string) {
    const plan = await this.prisma.deploymentPlan.findFirst({
      where: { id, organizationId },
    });

    if (!plan) {
      throw new NotFoundException('Deployment plan not found');
    }

    if (plan.status !== 'APPROVED' && plan.status !== 'FAILED') {
      throw new BadRequestException(
        `Cannot execute plan in ${plan.status} status — must be APPROVED or FAILED`,
      );
    }

    await this.implementationQueue.add(
      'generate-artifacts',
      { planId: id, orgId: organizationId },
      { attempts: 2, backoff: { type: 'exponential', delay: 10000 } },
    );

    this.logger.log(`Plan ${id} execution queued`);

    return { id, status: 'EXECUTING' };
  }

  // ── Artifacts ──────────────────────────────────────────

  async listArtifacts(planId: string, organizationId: string) {
    // Verify plan belongs to org
    const plan = await this.prisma.deploymentPlan.findFirst({
      where: { id: planId, organizationId },
    });

    if (!plan) {
      throw new NotFoundException('Deployment plan not found');
    }

    return this.prisma.deploymentArtifact.findMany({
      where: { planId },
      orderBy: { orderIndex: 'asc' },
    });
  }

  async getArtifact(artifactId: string, organizationId: string) {
    const artifact = await this.prisma.deploymentArtifact.findUnique({
      where: { id: artifactId },
      include: { plan: { select: { organizationId: true } } },
    });

    if (!artifact || artifact.plan.organizationId !== organizationId) {
      throw new NotFoundException('Artifact not found');
    }

    const { plan: _, ...data } = artifact;
    return data;
  }

  // ── Delete Plan ────────────────────────────────────────

  async deletePlan(id: string, organizationId: string) {
    const plan = await this.prisma.deploymentPlan.findFirst({
      where: { id, organizationId },
    });

    if (!plan) {
      throw new NotFoundException('Deployment plan not found');
    }

    if (plan.status !== 'DRAFT' && plan.status !== 'FAILED') {
      throw new ForbiddenException(
        `Cannot delete plan in ${plan.status} status — only DRAFT or FAILED plans can be deleted`,
      );
    }

    await this.prisma.deploymentPlan.delete({ where: { id } });

    this.logger.log(`Plan ${id} deleted`);

    return { deleted: true };
  }
}
