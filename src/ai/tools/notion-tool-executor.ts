import { Injectable, Logger } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { CredentialVaultService } from '../../integrations/credential-vault.service';
import { AuditLogService } from '../../integrations/audit-log.service';
import { NotionAdapter } from '../../integrations/adapters/notion';
import { MAX_PAGES_PER_DEPLOYMENT } from '../../integrations/adapters/notion/notion.constants';
import type {
  DecryptedCredentials,
  DeploymentAction,
} from '../../integrations/adapters/types';

@Injectable()
export class NotionToolExecutor {
  private readonly logger = new Logger(NotionToolExecutor.name);
  private pagesCreatedInSession = 0;

  constructor(
    private credentialVault: CredentialVaultService,
    private auditLog: AuditLogService,
    private notionAdapter: NotionAdapter,
  ) {}

  canHandle(toolName: string): boolean {
    return toolName.startsWith('notion_');
  }

  resetSession() {
    this.pagesCreatedInSession = 0;
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
        IntegrationProvider.NOTION,
      );
      integrationId = result.id;
      credentials = result.credentials;
    } catch {
      return {
        error:
          'Notion is not connected for this organization. Please connect Notion from the Integrations settings page.',
      };
    }

    switch (toolName) {
      case 'notion_list_databases':
        return this.notionAdapter.listResources(credentials, 'databases');

      case 'notion_search_pages':
        return this.notionAdapter.listResources(credentials, 'pages');

      case 'notion_create_page':
        return this.executeWithAudit(
          'create_page',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'notion_create_database':
        return this.executeWithAudit(
          'create_database',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      case 'notion_add_database_item':
        return this.executeWithAudit(
          'add_database_item',
          input,
          credentials,
          integrationId,
          organizationId,
        );

      default:
        return { error: `Unknown Notion tool: ${toolName}` };
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
      provider: IntegrationProvider.NOTION,
      params: input,
    };

    if (isDryRun) {
      return this.notionAdapter.dryRun(credentials, action);
    }

    if (actionType === 'create_page' || actionType === 'add_database_item') {
      if (this.pagesCreatedInSession >= MAX_PAGES_PER_DEPLOYMENT) {
        return {
          error: `Safety limit reached: maximum ${MAX_PAGES_PER_DEPLOYMENT} pages per deployment session`,
        };
      }
    }

    const auditEntry = await this.auditLog.logAction({
      organizationId,
      integrationId,
      action: actionType,
      provider: IntegrationProvider.NOTION,
      request: input,
      executedBy: 'ai-agent',
    });

    try {
      const result = await this.notionAdapter.execute(credentials, action);

      if (actionType === 'create_page' || actionType === 'add_database_item') {
        this.pagesCreatedInSession++;
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
