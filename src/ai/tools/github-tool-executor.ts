import { Injectable, Logger } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { CredentialVaultService } from '../../integrations/credential-vault.service';
import { AuditLogService } from '../../integrations/audit-log.service';
import { GitHubAdapter } from '../../integrations/adapters/github';
import { MAX_WORKFLOWS_PER_DEPLOYMENT } from '../../integrations/adapters/github/github.constants';
import type {
  DecryptedCredentials,
  DeploymentAction,
} from '../../integrations/adapters/types';

@Injectable()
export class GitHubToolExecutor {
  private readonly logger = new Logger(GitHubToolExecutor.name);
  private workflowsCreatedInSession = 0;

  constructor(
    private credentialVault: CredentialVaultService,
    private auditLog: AuditLogService,
    private githubAdapter: GitHubAdapter,
  ) {}

  canHandle(toolName: string): boolean {
    return toolName.startsWith('github_');
  }

  resetSession() {
    this.workflowsCreatedInSession = 0;
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    organizationId: string,
  ): Promise<unknown> {
    let integrationId: string;
    let credentials: DecryptedCredentials;

    try {
      const result = await this.credentialVault.retrieve(
        organizationId,
        IntegrationProvider.GITHUB,
      );
      integrationId = result.id;
      credentials = result.credentials;
    } catch {
      return {
        error:
          'GitHub is not connected for this organization. Please connect GitHub from the Integrations settings page.',
      };
    }

    switch (toolName) {
      case 'github_list_repos':
        return this.githubAdapter.listResources(credentials, 'repos');

      case 'github_list_workflows':
        return this.githubAdapter.listWorkflows(
          credentials,
          input.repo as string,
        );

      case 'github_list_secrets':
        return this.githubAdapter.listSecrets(
          credentials,
          input.repo as string,
        );

      case 'github_create_workflow':
        return this.executeWithAudit(
          'create_workflow',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'github_create_webhook':
        return this.executeWithAudit(
          'create_webhook',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'github_trigger_workflow':
        return this.executeWithAudit(
          'trigger_workflow',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      default:
        return { error: `Unknown GitHub tool: ${toolName}` };
    }
  }

  private async executeWithAudit(
    actionType: string,
    input: Record<string, unknown>,
    credentials: DecryptedCredentials,
    integrationId: string,
    organizationId: string,
  ): Promise<unknown> {
    const isDryRun = input.dryRun === true;
    const action: DeploymentAction = {
      type: actionType,
      provider: IntegrationProvider.GITHUB,
      params: input,
    };

    if (isDryRun) {
      return this.githubAdapter.dryRun(credentials, action);
    }

    // Safety: enforce max workflows per deployment session
    if (actionType === 'create_workflow') {
      if (this.workflowsCreatedInSession >= MAX_WORKFLOWS_PER_DEPLOYMENT) {
        return {
          error: `Safety limit reached: maximum ${MAX_WORKFLOWS_PER_DEPLOYMENT} workflows per deployment session`,
        };
      }
    }

    const auditEntry = await this.auditLog.logAction({
      organizationId,
      integrationId,
      action: actionType,
      provider: IntegrationProvider.GITHUB,
      request: input,
      executedBy: 'ai-agent',
    });

    try {
      const result = await this.githubAdapter.execute(credentials, action);

      if (actionType === 'create_workflow') {
        this.workflowsCreatedInSession++;
      }

      await this.auditLog.markSuccess(
        auditEntry.id,
        result as unknown as Record<string, unknown>,
        result.rollbackData,
      );

      return result;
    } catch (error) {
      await this.auditLog.markFailed(auditEntry.id, {
        error: (error as Error).message,
      });
      return { error: (error as Error).message };
    }
  }
}
