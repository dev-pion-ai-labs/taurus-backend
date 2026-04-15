import { Injectable, Logger } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { CredentialVaultService } from '../../integrations/credential-vault.service';
import { AuditLogService } from '../../integrations/audit-log.service';
import { SlackAdapter } from '../../integrations/adapters/slack';
import { MAX_CHANNELS_PER_DEPLOYMENT } from '../../integrations/adapters/slack/slack.constants';
import type {
  DecryptedCredentials,
  DeploymentAction,
} from '../../integrations/adapters/types';

@Injectable()
export class SlackToolExecutor {
  private readonly logger = new Logger(SlackToolExecutor.name);
  private channelsCreatedInSession = 0;

  constructor(
    private credentialVault: CredentialVaultService,
    private auditLog: AuditLogService,
    private slackAdapter: SlackAdapter,
  ) {}

  /** Returns true if this executor handles the given tool name */
  canHandle(toolName: string): boolean {
    return toolName.startsWith('slack_');
  }

  /** Reset per-session safety counters. Call at the start of each deployment run. */
  resetSession() {
    this.channelsCreatedInSession = 0;
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    organizationId: string,
  ): Promise<unknown> {
    // Retrieve Slack credentials for this org
    let integrationId: string;
    let credentials: DecryptedCredentials;

    try {
      const result = await this.credentialVault.retrieve(
        organizationId,
        IntegrationProvider.SLACK,
      );
      integrationId = result.id;
      credentials = result.credentials;
    } catch {
      return {
        error:
          'Slack is not connected for this organization. Please connect Slack from the Integrations settings page.',
      };
    }

    switch (toolName) {
      case 'slack_list_channels':
        return this.slackAdapter.listResources(credentials, 'channels');

      case 'slack_list_users':
        return this.slackAdapter.listResources(credentials, 'users');

      case 'slack_create_channel':
        return this.executeWithAudit(
          'create_channel',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'slack_post_message':
        return this.executeWithAudit(
          'post_message',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'slack_invite_to_channel':
        return this.executeWithAudit(
          'invite_users',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'slack_create_webhook':
        return this.executeWithAudit(
          'create_webhook',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      default:
        return { error: `Unknown Slack tool: ${toolName}` };
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
      provider: IntegrationProvider.SLACK,
      params: input,
    };

    // Dry run — no audit log, no side effects
    if (isDryRun) {
      return this.slackAdapter.dryRun(credentials, action);
    }

    // Safety: enforce max channels per deployment session
    if (actionType === 'create_channel') {
      if (this.channelsCreatedInSession >= MAX_CHANNELS_PER_DEPLOYMENT) {
        return {
          error: `Safety limit reached: maximum ${MAX_CHANNELS_PER_DEPLOYMENT} channels per deployment session`,
        };
      }
    }

    // Create audit log entry (PENDING)
    const auditEntry = await this.auditLog.logAction({
      organizationId,
      integrationId,
      action: actionType,
      provider: IntegrationProvider.SLACK,
      request: input,
      executedBy: 'ai-agent',
    });

    try {
      const result = await this.slackAdapter.execute(credentials, action);

      if (actionType === 'create_channel') {
        this.channelsCreatedInSession++;
      }

      await this.auditLog.markSuccess(
        auditEntry.id,
        result as unknown as Record<string, unknown>,
        result.rollbackData,
      );

      // For webhook results, mask the URL — only return confirmation
      if (actionType === 'create_webhook') {
        return {
          success: true,
          webhookConfigured: true,
          channelId: result.resourceId,
        };
      }

      return result;
    } catch (error) {
      await this.auditLog.markFailed(auditEntry.id, {
        error: (error as Error).message,
      });
      return { error: (error as Error).message };
    }
  }
}
