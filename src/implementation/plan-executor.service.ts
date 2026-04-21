import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { IntegrationToolExecutor } from '../ai/tools/integration-tool-executor';
import { SlackService } from '../integrations/services/slack.service';
import { TrackerService } from '../tracker/tracker.service';
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
    private tracker: TrackerService,
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
      await this.markActionDeployed(plan.actionId, organizationId, userId, summary);
      return summary;
    }

    this.logger.log(`[${planId}] Executing ${steps.length} deployment step(s)`);

    // Flip action to IN_PROGRESS while the executor runs. Final transition to
    // DEPLOYED happens in markActionDeployed after the loop finishes. Mirrors
    // the timestamp behaviour of TrackerService.moveAction for consistency.
    await this.prisma.transformationAction.updateMany({
      where: {
        id: plan.actionId,
        status: { in: ['AWAITING_APPROVAL', 'THIS_SPRINT', 'BACKLOG'] },
      },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    const executed: DeploymentStepPlan[] = steps.map((s) => ({
      ...s,
      status: s.status ?? 'pending',
    }));

    const failedIndices = new Set<number>();

    for (let i = 0; i < executed.length; i++) {
      const step = executed[i];

      // If the user has already run this step (replay / retry scenario), skip it.
      if (step.status === 'completed') {
        summary.completed += 1;
        continue;
      }

      // Skip if a declared dependency has already failed or was skipped.
      const blocker = step.dependsOn?.find((idx) => failedIndices.has(idx));
      if (blocker !== undefined) {
        executed[i] = {
          ...step,
          status: 'skipped',
          error: `dependency failed: step ${blocker}`,
          completedAt: new Date().toISOString(),
        };
        failedIndices.add(i);
        summary.skipped += 1;
        await this.persistSteps(planId, executed);
        this.logger.warn(
          `[${planId}] step ${i} (${step.tool}) skipped — dependency step ${blocker} failed`,
        );
        continue;
      }

      // Substitute any {{steps[N].result.path}} references in params.
      const substitution = this.substituteParams(step.params, executed);
      if (!substitution.ok) {
        executed[i] = {
          ...step,
          status: 'failed',
          error: substitution.error,
          completedAt: new Date().toISOString(),
        };
        failedIndices.add(i);
        summary.failed += 1;
        await this.persistSteps(planId, executed);
        this.logger.warn(
          `[${planId}] step ${i} (${step.tool}) failed: ${substitution.error}`,
        );
        continue;
      }

      executed[i] = {
        ...step,
        status: 'executing',
        startedAt: new Date().toISOString(),
        error: undefined,
        params: substitution.params,
      };
      await this.persistSteps(planId, executed);

      try {
        const raw = await this.toolExecutor.executeTool(
          step.tool,
          substitution.params,
          organizationId,
        );

        if (this.isErrorResult(raw)) {
          executed[i] = {
            ...executed[i],
            status: 'failed',
            error: (raw as { error: string }).error,
            completedAt: new Date().toISOString(),
          };
          failedIndices.add(i);
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
        failedIndices.add(i);
        summary.failed += 1;
        this.logger.error(
          `[${planId}] step ${i} (${step.tool}) threw: ${message}`,
        );
      }

      await this.persistSteps(planId, executed);
    }

    await this.markActionDeployed(plan.actionId, organizationId, userId, summary);

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

  /**
   * Resolve `{{steps[N].result.path.to.field}}` references in a params object
   * against previously-completed steps. Returns { ok: true, params } with the
   * substituted params, or { ok: false, error } if any reference is unresolved.
   *
   * Used so the AI can express chained steps like:
   *   step 0: slack_create_channel → result.channelId
   *   step 1: slack_send_message with { channel: "{{steps[0].result.channelId}}" }
   */
  private substituteParams(
    params: Record<string, unknown>,
    completedSteps: DeploymentStepPlan[],
  ):
    | { ok: true; params: Record<string, unknown> }
    | { ok: false; error: string } {
    const pattern = /^\{\{steps\[(\d+)\]\.result(?:\.([a-zA-Z0-9_.[\]]+))?\}\}$/;
    let error: string | null = null;

    const walk = (value: unknown): unknown => {
      if (error) return value;
      if (typeof value === 'string') {
        const match = value.match(pattern);
        if (!match) return value;

        const stepIdx = Number(match[1]);
        const path = match[2];
        const ref = completedSteps[stepIdx];

        if (!ref || ref.status !== 'completed' || ref.result === undefined) {
          error = `unresolved reference ${value} — step ${stepIdx} not completed`;
          return value;
        }

        const resolved = path
          ? this.getByPath(ref.result, path)
          : ref.result;
        if (resolved === undefined) {
          error = `unresolved reference ${value} — path missing on step ${stepIdx} result`;
          return value;
        }
        return resolved;
      }
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = walk(v);
        return out;
      }
      return value;
    };

    const substituted = walk(params) as Record<string, unknown>;
    if (error) return { ok: false, error };
    return { ok: true, params: substituted };
  }

  private getByPath(obj: unknown, path: string): unknown {
    return path
      .replace(/\[(\d+)\]/g, '.$1')
      .split('.')
      .filter(Boolean)
      .reduce<unknown>((acc, key) => {
        if (acc && typeof acc === 'object') {
          return (acc as Record<string, unknown>)[key];
        }
        return undefined;
      }, obj);
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
    summary: PlanExecutionSummary,
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
      .notifyDeployed(organizationId, action.title, deployerName, summary)
      .catch(() => {});

    // Mirror the sprint auto-complete that fires on manual Kanban drag.
    await this.tracker
      .maybeCompleteSprint(actionId, organizationId)
      .catch((err) =>
        this.logger.warn(
          `[${actionId}] Sprint auto-complete check failed: ${(err as Error).message}`,
        ),
      );
  }
}
