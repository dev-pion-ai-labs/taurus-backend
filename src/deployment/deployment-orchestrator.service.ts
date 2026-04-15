import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import {
  DeploymentSessionStatus,
  DeploymentStepStatus,
  IntegrationProvider,
  Prisma,
} from '@prisma/client';
import { CredentialVaultService } from '../integrations/credential-vault.service';
import { AuditLogService } from '../integrations/audit-log.service';
import { DeploymentAdapter } from '../integrations/adapters/base.adapter';
import { DEPLOYMENT_ADAPTERS } from '../integrations/adapters/base.adapter';
import type { DeploymentAction } from '../integrations/adapters/types';

export interface CreateSessionInput {
  planId: string;
  organizationId: string;
  steps: {
    provider: IntegrationProvider;
    action: string;
    params: Record<string, unknown>;
    dependsOn?: string[]; // references to other steps by a temp key
  }[];
}

@Injectable()
export class DeploymentOrchestratorService {
  private readonly logger = new Logger(DeploymentOrchestratorService.name);

  constructor(
    private prisma: PrismaService,
    private credentialVault: CredentialVaultService,
    private auditLog: AuditLogService,
    @Inject(DEPLOYMENT_ADAPTERS)
    private adapters: Map<IntegrationProvider, DeploymentAdapter>,
  ) {}

  // ─── Create Session ───────────────────────────────────

  async createSession(input: CreateSessionInput) {
    // Validate all required integrations are connected
    const requiredProviders = [...new Set(input.steps.map((s) => s.provider))];
    for (const provider of requiredProviders) {
      if (!this.adapters.has(provider)) {
        throw new BadRequestException(`No adapter registered for provider: ${provider}`);
      }
      try {
        await this.credentialVault.retrieve(input.organizationId, provider);
      } catch {
        throw new BadRequestException(
          `${provider} is not connected. Please connect it from Settings > Integrations.`,
        );
      }
    }

    const session = await this.prisma.deploymentSession.create({
      data: {
        organizationId: input.organizationId,
        planId: input.planId,
        status: DeploymentSessionStatus.PREPARING,
        steps: {
          create: input.steps.map((step, index) => ({
            provider: step.provider,
            action: step.action,
            params: step.params as unknown as Prisma.InputJsonValue,
            dependsOn: step.dependsOn ?? [],
            orderIndex: index,
            status: DeploymentStepStatus.PENDING,
          })),
        },
      },
      include: { steps: { orderBy: { orderIndex: 'asc' } } },
    });

    return session;
  }

  // ─── Dry Run All Steps ────────────────────────────────

  async dryRunSession(sessionId: string) {
    const session = await this.getSession(sessionId);

    if (session.status !== DeploymentSessionStatus.PREPARING) {
      throw new BadRequestException(`Session is in ${session.status} state, expected PREPARING`);
    }

    await this.prisma.deploymentSession.update({
      where: { id: sessionId },
      data: { status: DeploymentSessionStatus.DRY_RUN },
    });

    const results: { stepId: string; dryRunResult: unknown }[] = [];

    for (const step of session.steps) {
      const adapter = this.adapters.get(step.provider);
      if (!adapter) {
        await this.updateStepStatus(step.id, DeploymentStepStatus.FAILED, {
          error: `No adapter for ${step.provider}`,
        });
        continue;
      }

      try {
        const { credentials } = await this.credentialVault.retrieve(
          session.organizationId,
          step.provider,
        );

        const action: DeploymentAction = {
          type: step.action,
          provider: step.provider,
          params: this.resolveParams(step.params as Record<string, unknown>, results),
        };

        const dryRunResult = await adapter.dryRun(credentials, action);

        await this.prisma.deploymentStep.update({
          where: { id: step.id },
          data: {
            status: DeploymentStepStatus.DRY_RUN,
            dryRunResult: dryRunResult as unknown as Prisma.InputJsonValue,
          },
        });

        results.push({ stepId: step.id, dryRunResult });
      } catch (error) {
        await this.updateStepStatus(step.id, DeploymentStepStatus.FAILED, {
          error: (error as Error).message,
        });
      }
    }

    const updatedSession = await this.getSession(sessionId);
    return updatedSession;
  }

  // ─── Execute Session ──────────────────────────────────

  async executeSession(sessionId: string, executedBy: string) {
    const session = await this.getSession(sessionId);

    if (
      session.status !== DeploymentSessionStatus.DRY_RUN &&
      session.status !== DeploymentSessionStatus.APPROVED
    ) {
      throw new BadRequestException(
        `Session is in ${session.status} state, expected DRY_RUN or APPROVED`,
      );
    }

    await this.prisma.deploymentSession.update({
      where: { id: sessionId },
      data: {
        status: DeploymentSessionStatus.EXECUTING,
        startedAt: new Date(),
      },
    });

    const completedSteps: {
      stepId: string;
      result: Record<string, unknown>;
    }[] = [];

    for (const step of session.steps) {
      // Check dependencies
      const depsComplete = (step.dependsOn as string[]).every((depId) =>
        completedSteps.some((cs) => cs.stepId === depId),
      );

      if (!depsComplete) {
        await this.updateStepStatus(step.id, DeploymentStepStatus.SKIPPED, {
          error: 'Skipped: dependency not met',
        });
        continue;
      }

      const adapter = this.adapters.get(step.provider);
      if (!adapter) {
        await this.failSession(sessionId, completedSteps, `No adapter for ${step.provider}`);
        return this.getSession(sessionId);
      }

      try {
        const { id: integrationId, credentials } =
          await this.credentialVault.retrieve(session.organizationId, step.provider);

        await this.prisma.deploymentStep.update({
          where: { id: step.id },
          data: { status: DeploymentStepStatus.EXECUTING, startedAt: new Date() },
        });

        const action: DeploymentAction = {
          type: step.action,
          provider: step.provider,
          params: this.resolveParams(step.params as Record<string, unknown>, completedSteps),
        };

        // Create audit log
        const auditEntry = await this.auditLog.logAction({
          organizationId: session.organizationId,
          planId: session.planId,
          integrationId,
          action: step.action,
          provider: step.provider,
          request: action.params,
          executedBy,
        });

        const result = await adapter.execute(credentials, action);

        await this.auditLog.markSuccess(
          auditEntry.id,
          result as unknown as Record<string, unknown>,
          result.rollbackData,
        );

        await this.prisma.deploymentStep.update({
          where: { id: step.id },
          data: {
            status: DeploymentStepStatus.COMPLETED,
            result: result as unknown as Prisma.InputJsonValue,
            auditLogId: auditEntry.id,
            completedAt: new Date(),
          },
        });

        completedSteps.push({
          stepId: step.id,
          result: result as unknown as Record<string, unknown>,
        });

        this.logger.log(
          `Step ${step.orderIndex + 1} completed: ${step.provider}.${step.action}`,
        );
      } catch (error) {
        const errorMessage = (error as Error).message;
        this.logger.error(`Step ${step.orderIndex + 1} failed: ${errorMessage}`);

        await this.updateStepStatus(step.id, DeploymentStepStatus.FAILED, {
          error: errorMessage,
        });

        // Cascading rollback
        await this.failSession(sessionId, completedSteps, errorMessage);
        return this.getSession(sessionId);
      }
    }

    // All steps completed
    await this.prisma.deploymentSession.update({
      where: { id: sessionId },
      data: {
        status: DeploymentSessionStatus.COMPLETED,
        completedAt: new Date(),
      },
    });

    this.logger.log(`Deployment session ${sessionId} completed successfully`);
    return this.getSession(sessionId);
  }

  // ─── Rollback Session ─────────────────────────────────

  async rollbackSession(sessionId: string) {
    const session = await this.getSession(sessionId);

    const completedSteps = session.steps
      .filter((s) => s.status === 'COMPLETED' && s.auditLogId)
      .reverse(); // rollback in reverse order

    for (const step of completedSteps) {
      await this.rollbackStep(session.organizationId, step);
    }

    await this.prisma.deploymentSession.update({
      where: { id: sessionId },
      data: { status: DeploymentSessionStatus.ROLLED_BACK },
    });

    return this.getSession(sessionId);
  }

  // ─── Approve Session ───────────────────────────────────

  async approveSession(sessionId: string) {
    const session = await this.getSession(sessionId);

    if (session.status !== DeploymentSessionStatus.DRY_RUN) {
      throw new BadRequestException(
        `Session is in ${session.status} state, expected DRY_RUN`,
      );
    }

    await this.prisma.deploymentSession.update({
      where: { id: sessionId },
      data: { status: DeploymentSessionStatus.APPROVED },
    });

    return this.getSession(sessionId);
  }

  // ─── Helpers ──────────────────────────────────────────

  async getSession(sessionId: string) {
    const session = await this.prisma.deploymentSession.findUnique({
      where: { id: sessionId },
      include: { steps: { orderBy: { orderIndex: 'asc' } } },
    });

    if (!session) {
      throw new BadRequestException('Deployment session not found');
    }

    return session;
  }

  async listSessions(organizationId: string, planId?: string) {
    return this.prisma.deploymentSession.findMany({
      where: { organizationId, ...(planId ? { planId } : {}) },
      include: { steps: { orderBy: { orderIndex: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async failSession(
    sessionId: string,
    completedSteps: { stepId: string; result: Record<string, unknown> }[],
    error: string,
  ) {
    // Attempt cascading rollback of completed steps in reverse
    const session = await this.getSession(sessionId);
    const stepsToRollback = session.steps
      .filter((s) => completedSteps.some((cs) => cs.stepId === s.id))
      .reverse();

    for (const step of stepsToRollback) {
      await this.rollbackStep(session.organizationId, step);
    }

    await this.prisma.deploymentSession.update({
      where: { id: sessionId },
      data: {
        status: DeploymentSessionStatus.FAILED,
        error,
        completedAt: new Date(),
      },
    });
  }

  private async rollbackStep(
    organizationId: string,
    step: { id: string; provider: IntegrationProvider; auditLogId: string | null; result: unknown },
  ) {
    if (!step.auditLogId) return;

    const adapter = this.adapters.get(step.provider);
    if (!adapter) {
      this.logger.warn(`Cannot rollback step ${step.id}: no adapter for ${step.provider}`);
      return;
    }

    try {
      const { credentials } = await this.credentialVault.retrieve(
        organizationId,
        step.provider,
      );

      const rollbackData = (step.result as Record<string, unknown>)?.rollbackData as
        | Record<string, unknown>
        | undefined;

      if (!rollbackData) {
        this.logger.warn(`No rollback data for step ${step.id}`);
        return;
      }

      const result = await adapter.rollback(credentials, step.auditLogId, rollbackData);
      if (result.success) {
        await this.auditLog.markRolledBack(step.auditLogId);
        this.logger.log(`Rolled back step ${step.id}: ${result.message}`);
      } else {
        this.logger.warn(`Rollback failed for step ${step.id}: ${result.message}`);
      }
    } catch (error) {
      this.logger.error(`Rollback error for step ${step.id}: ${(error as Error).message}`);
    }
  }

  /**
   * Resolve step params by replacing {{stepId.field}} references
   * with actual values from completed steps.
   */
  private resolveParams(
    params: Record<string, unknown>,
    completedSteps: { stepId: string; result?: unknown; dryRunResult?: unknown }[],
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        const ref = value.slice(2, -2); // e.g., "step-id.resourceId"
        const [stepId, field] = ref.split('.');

        const completedStep = completedSteps.find((s) => s.stepId === stepId);
        if (completedStep) {
          const stepResult = (completedStep.result ?? completedStep.dryRunResult) as
            | Record<string, unknown>
            | undefined;
          resolved[key] = stepResult?.[field] ?? value;
        } else {
          resolved[key] = value;
        }
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private async updateStepStatus(
    stepId: string,
    status: DeploymentStepStatus,
    data?: { error?: string },
  ) {
    await this.prisma.deploymentStep.update({
      where: { id: stepId },
      data: { status, error: data?.error },
    });
  }
}
