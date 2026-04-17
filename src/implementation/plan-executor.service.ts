import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { IntegrationToolExecutor } from '../ai/tools/integration-tool-executor';
import { SlackService } from '../integrations/services/slack.service';
import type { DeploymentStepPlan } from '../ai/implementation-ai.service';

export interface PlanExecutionSummary {
  planId: string;
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}

@Injectable()
export class PlanExecutorService {
  private readonly logger = new Logger(PlanExecutorService.name);

  constructor(
    private prisma: PrismaService,
    private toolExecutor: IntegrationToolExecutor,
    private slack: SlackService,
  ) {}

  /**
   * Execute the deploymentSteps on a plan. Each step is dispatched to
   * IntegrationToolExecutor; results are persisted back onto the plan's
   * deploymentSteps JSON field. On completion the parent tracker action is
   * marked DEPLOYED regardless of partial failures — callers can inspect
   * the per-step status to surface errors in the UI.
   */
  async execute(
    planId: string,
    organizationId: string,
    userId: string,
  ): Promise<PlanExecutionSummary> {
    const plan = await this.prisma.deploymentPlan.findFirstOrThrow({
      where: { id: planId, organizationId },
    });

    const steps = this.readSteps(plan.deploymentSteps);
    const summary: PlanExecutionSummary = {
      planId,
      total: steps.length,
      completed: 0,
      failed: 0,
      skipped: 0,
    };

    if (steps.length === 0) {
      this.logger.log(
        `[${planId}] No deployment steps to execute — marking action deployed`,
      );
      await this.markActionDeployed(plan.actionId, organizationId, userId);
      return summary;
    }

    this.logger.log(`[${planId}] Executing ${steps.length} deployment step(s)`);

    const executed: DeploymentStepPlan[] = steps.map((s) => ({
      ...s,
      status: s.status ?? 'pending',
    }));

    for (let i = 0; i < executed.length; i++) {
      const step = executed[i];

      // If the user has already run this step (replay / retry scenario), skip it.
      if (step.status === 'completed') {
        summary.completed += 1;
        continue;
      }

      executed[i] = {
        ...step,
        status: 'executing',
        startedAt: new Date().toISOString(),
        error: undefined,
      };
      await this.persistSteps(planId, executed);

      try {
        const raw = await this.toolExecutor.executeTool(
          step.tool,
          step.params,
          organizationId,
        );

        if (this.isErrorResult(raw)) {
          executed[i] = {
            ...executed[i],
            status: 'failed',
            error: (raw as { error: string }).error,
            completedAt: new Date().toISOString(),
          };
          summary.failed += 1;
          this.logger.warn(
            `[${planId}] step ${i} (${step.tool}) failed: ${(raw as { error: string }).error}`,
          );
        } else {
          executed[i] = {
            ...executed[i],
            status: 'completed',
            result: raw,
            completedAt: new Date().toISOString(),
          };
          summary.completed += 1;
        }
      } catch (err) {
        // IntegrationToolExecutor catches provider errors internally, so reaching
        // this branch indicates an unexpected system error (DB, Prisma, etc.)
        const message = (err as Error).message;
        executed[i] = {
          ...executed[i],
          status: 'failed',
          error: message,
          completedAt: new Date().toISOString(),
        };
        summary.failed += 1;
        this.logger.error(
          `[${planId}] step ${i} (${step.tool}) threw: ${message}`,
        );
      }

      await this.persistSteps(planId, executed);
    }

    await this.markActionDeployed(plan.actionId, organizationId, userId);

    this.logger.log(
      `[${planId}] Execution done — ${summary.completed}/${summary.total} completed, ${summary.failed} failed`,
    );

    return summary;
  }

  // ── Helpers ──────────────────────────────────────────────

  private readSteps(raw: unknown): DeploymentStepPlan[] {
    if (!Array.isArray(raw)) return [];
    return raw as DeploymentStepPlan[];
  }

  private isErrorResult(raw: unknown): boolean {
    return (
      !!raw &&
      typeof raw === 'object' &&
      'error' in (raw as Record<string, unknown>) &&
      typeof (raw as Record<string, unknown>).error === 'string'
    );
  }

  private async persistSteps(
    planId: string,
    steps: DeploymentStepPlan[],
  ): Promise<void> {
    await this.prisma.deploymentPlan.update({
      where: { id: planId },
      data: { deploymentSteps: steps as unknown as object[] },
    });
  }

  private async markActionDeployed(
    actionId: string,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    const action = await this.prisma.transformationAction.update({
      where: { id: actionId },
      data: { status: 'DEPLOYED', deployedAt: new Date() },
    });

    const deployer = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });
    const deployerName =
      [deployer?.firstName, deployer?.lastName].filter(Boolean).join(' ') ||
      deployer?.email ||
      'Unknown';

    this.slack
      .notifyDeployed(organizationId, action.title, deployerName)
      .catch(() => {});
  }
}
