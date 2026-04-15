import { Injectable, Logger } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { CredentialVaultService } from '../../integrations/credential-vault.service';
import { AuditLogService } from '../../integrations/audit-log.service';
import { MakeAdapter } from '../../integrations/adapters/make';
import { MAX_SCENARIOS_PER_DEPLOYMENT } from '../../integrations/adapters/make/make.constants';
import type {
  DecryptedCredentials,
  DeploymentAction,
} from '../../integrations/adapters/types';

@Injectable()
export class MakeToolExecutor {
  private readonly logger = new Logger(MakeToolExecutor.name);
  private scenariosCreatedInSession = 0;

  constructor(
    private credentialVault: CredentialVaultService,
    private auditLog: AuditLogService,
    private makeAdapter: MakeAdapter,
  ) {}

  canHandle(toolName: string): boolean {
    return toolName.startsWith('make_');
  }

  resetSession() {
    this.scenariosCreatedInSession = 0;
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
        IntegrationProvider.MAKE,
      );
      integrationId = result.id;
      credentials = result.credentials;
    } catch {
      return {
        error:
          'Make.com is not connected for this organization. Please connect Make from the Integrations settings page.',
      };
    }

    switch (toolName) {
      case 'make_list_scenarios':
        return this.makeAdapter.listResources(credentials, 'scenarios');

      case 'make_list_connections':
        return this.makeAdapter.listResources(credentials, 'connections');

      case 'make_create_scenario':
        return this.executeWithAudit(
          'create_scenario',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'make_activate_scenario':
        return this.executeWithAudit(
          'activate_scenario',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'make_test_scenario':
        return this.executeWithAudit(
          'test_scenario',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      default:
        return { error: `Unknown Make tool: ${toolName}` };
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
      provider: IntegrationProvider.MAKE,
      params: input,
    };

    if (isDryRun) {
      return this.makeAdapter.dryRun(credentials, action);
    }

    if (actionType === 'create_scenario') {
      if (this.scenariosCreatedInSession >= MAX_SCENARIOS_PER_DEPLOYMENT) {
        return {
          error: `Safety limit reached: maximum ${MAX_SCENARIOS_PER_DEPLOYMENT} scenarios per deployment session`,
        };
      }
    }

    const auditEntry = await this.auditLog.logAction({
      organizationId,
      integrationId,
      action: actionType,
      provider: IntegrationProvider.MAKE,
      request: input,
      executedBy: 'ai-agent',
    });

    try {
      const result = await this.makeAdapter.execute(credentials, action);

      if (actionType === 'create_scenario') {
        this.scenariosCreatedInSession++;
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
