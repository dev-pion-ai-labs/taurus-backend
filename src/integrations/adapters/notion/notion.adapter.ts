import { Injectable, Logger } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { DeploymentAdapter } from '../base.adapter';
import {
  DecryptedCredentials,
  ConnectionTestResult,
  Resource,
  DeploymentAction,
  DryRunResult,
  ExecutionResult,
  RollbackResult,
} from '../types';
import { NotionValidator } from './notion.validator';
import { NOTION_API_BASE, NOTION_API_VERSION, LIST_PAGE_SIZE } from './notion.constants';

@Injectable()
export class NotionAdapter implements DeploymentAdapter {
  readonly provider = IntegrationProvider.NOTION;
  private readonly logger = new Logger(NotionAdapter.name);

  private getHeaders(credentials: DecryptedCredentials): Record<string, string> {
    const token = credentials.apiKey || credentials.bearerToken;
    if (!token) {
      throw new Error('Notion API key not found in credentials');
    }
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_API_VERSION,
    };
  }

  private async notionRequest<T>(
    credentials: DecryptedCredentials,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers = this.getHeaders(credentials);
    const url = `${NOTION_API_BASE}${path}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`Notion API error (${response.status}): ${(errorBody as Record<string, string>).message || response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // ─── Connection ───────────────────────────────────────

  async testConnection(credentials: DecryptedCredentials): Promise<ConnectionTestResult> {
    try {
      const data = await this.notionRequest<{
        bot: { owner: { type: string; user?: { name: string; id: string } } };
        request_id: string;
      }>(credentials, 'GET', '/users/me');

      const ownerName = data.bot?.owner?.user?.name ?? 'Integration';

      return {
        success: true,
        message: `Connected to Notion as "${ownerName}"`,
        metadata: {
          ownerType: data.bot?.owner?.type,
          ownerName,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${(error as Error).message}`,
      };
    }
  }

  // ─── List Resources ───────────────────────────────────

  async listResources(credentials: DecryptedCredentials, type: string): Promise<Resource[]> {
    switch (type) {
      case 'databases':
        return this.listDatabases(credentials);
      case 'pages':
        return this.searchPages(credentials);
      default:
        throw new Error(`Unknown Notion resource type: ${type}`);
    }
  }

  private async listDatabases(credentials: DecryptedCredentials): Promise<Resource[]> {
    const data = await this.notionRequest<{
      results: { id: string; title: { plain_text: string }[]; object: string }[];
    }>(credentials, 'POST', '/search', {
      filter: { property: 'object', value: 'database' },
      page_size: LIST_PAGE_SIZE,
    });

    return data.results.map((db) => ({
      id: db.id,
      type: 'database',
      name: db.title?.map((t) => t.plain_text).join('') || 'Untitled',
    }));
  }

  private async searchPages(credentials: DecryptedCredentials, query?: string): Promise<Resource[]> {
    const body: Record<string, unknown> = {
      filter: { property: 'object', value: 'page' },
      page_size: LIST_PAGE_SIZE,
    };
    if (query) body.query = query;

    const data = await this.notionRequest<{
      results: {
        id: string;
        object: string;
        properties: Record<string, { title?: { plain_text: string }[] }>;
        url: string;
      }[];
    }>(credentials, 'POST', '/search', body);

    return data.results.map((page) => {
      // Extract title from first title property
      let title = 'Untitled';
      for (const prop of Object.values(page.properties)) {
        if (prop.title && prop.title.length > 0) {
          title = prop.title.map((t) => t.plain_text).join('');
          break;
        }
      }
      return {
        id: page.id,
        type: 'page',
        name: title,
        metadata: { url: page.url },
      };
    });
  }

  // ─── Get Resource ─────────────────────────────────────

  async getResource(credentials: DecryptedCredentials, type: string, id: string): Promise<Resource> {
    switch (type) {
      case 'database': {
        const db = await this.notionRequest<{
          id: string;
          title: { plain_text: string }[];
        }>(credentials, 'GET', `/databases/${id}`);
        return {
          id: db.id,
          type: 'database',
          name: db.title?.map((t) => t.plain_text).join('') || 'Untitled',
        };
      }
      case 'page': {
        const page = await this.notionRequest<{
          id: string;
          url: string;
          properties: Record<string, { title?: { plain_text: string }[] }>;
        }>(credentials, 'GET', `/pages/${id}`);
        let title = 'Untitled';
        for (const prop of Object.values(page.properties)) {
          if (prop.title && prop.title.length > 0) {
            title = prop.title.map((t) => t.plain_text).join('');
            break;
          }
        }
        return {
          id: page.id,
          type: 'page',
          name: title,
          metadata: { url: page.url },
        };
      }
      default:
        throw new Error(`Unknown Notion resource type: ${type}`);
    }
  }

  // ─── Dry Run ──────────────────────────────────────────

  async dryRun(credentials: DecryptedCredentials, action: DeploymentAction): Promise<DryRunResult> {
    switch (action.type) {
      case 'create_page':
        return this.dryRunCreatePage(action.params);
      case 'create_database':
        return this.dryRunCreateDatabase(action.params);
      case 'add_database_item':
        return this.dryRunAddDatabaseItem(credentials, action.params);
      default:
        return { valid: false, preview: '', warnings: [`Unknown action type: ${action.type}`] };
    }
  }

  private async dryRunCreatePage(params: Record<string, unknown>): Promise<DryRunResult> {
    const titleValidation = NotionValidator.validatePageTitle(params.title as string);
    if (!titleValidation.valid) {
      return { valid: false, preview: '', warnings: titleValidation.errors };
    }

    return {
      valid: true,
      preview: `Create Notion page "${titleValidation.sanitized}"${params.parentPageId ? ' as a sub-page' : ''}`,
      warnings: [],
    };
  }

  private async dryRunCreateDatabase(params: Record<string, unknown>): Promise<DryRunResult> {
    const titleValidation = NotionValidator.validatePageTitle(params.title as string);
    if (!titleValidation.valid) {
      return { valid: false, preview: '', warnings: titleValidation.errors };
    }

    if (!params.parentPageId) {
      return { valid: false, preview: '', warnings: ['Parent page ID is required to create a database'] };
    }

    const properties = params.properties as Record<string, unknown> | undefined;
    const propCount = properties ? Object.keys(properties).length : 0;

    return {
      valid: true,
      preview: `Create Notion database "${titleValidation.sanitized}" with ${propCount || 'default'} properties`,
      warnings: [],
    };
  }

  private async dryRunAddDatabaseItem(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const databaseId = params.databaseId as string;
    const dbValidation = NotionValidator.validateDatabaseId(databaseId);
    if (!dbValidation.valid) {
      return { valid: false, preview: '', warnings: dbValidation.errors };
    }

    try {
      const db = await this.getResource(credentials, 'database', databaseId);
      return {
        valid: true,
        preview: `Add item to database "${db.name}"`,
        warnings: [],
      };
    } catch {
      return { valid: false, preview: '', warnings: ['Database not found or not accessible'] };
    }
  }

  // ─── Execute ──────────────────────────────────────────

  async execute(credentials: DecryptedCredentials, action: DeploymentAction): Promise<ExecutionResult> {
    switch (action.type) {
      case 'create_page':
        return this.executeCreatePage(credentials, action.params);
      case 'create_database':
        return this.executeCreateDatabase(credentials, action.params);
      case 'add_database_item':
        return this.executeAddDatabaseItem(credentials, action.params);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async executeCreatePage(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const titleValidation = NotionValidator.validatePageTitle(params.title as string);
    if (!titleValidation.valid) throw new Error(titleValidation.errors.join(', '));

    const parent = params.parentPageId
      ? { page_id: params.parentPageId as string }
      : params.parentDatabaseId
        ? { database_id: params.parentDatabaseId as string }
        : null;

    if (!parent) {
      throw new Error('Either parentPageId or parentDatabaseId is required');
    }

    // Build content blocks from markdown-style content
    const children: unknown[] = [];
    const content = params.content as string | undefined;
    if (content) {
      // Split into paragraphs and create paragraph blocks
      const paragraphs = content.split('\n\n').filter((p) => p.trim());
      for (const para of paragraphs) {
        children.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: para.trim() } }],
          },
        });
      }
    }

    const body: Record<string, unknown> = {
      parent,
      properties: {
        title: {
          title: [{ type: 'text', text: { content: titleValidation.sanitized } }],
        },
      },
    };

    if (children.length > 0) {
      body.children = children;
    }

    const page = await this.notionRequest<{ id: string; url: string }>(
      credentials,
      'POST',
      '/pages',
      body,
    );

    this.logger.log(`Created Notion page "${titleValidation.sanitized}" (${page.id})`);

    return {
      success: true,
      resourceId: page.id,
      resourceUrl: page.url,
      rollbackData: { action: 'create_page', pageId: page.id },
    };
  }

  private async executeCreateDatabase(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const titleValidation = NotionValidator.validatePageTitle(params.title as string);
    if (!titleValidation.valid) throw new Error(titleValidation.errors.join(', '));

    const parentPageId = params.parentPageId as string;
    if (!parentPageId) throw new Error('Parent page ID is required');

    // Build properties schema — default to Name + Status if not provided
    const properties = (params.properties as Record<string, unknown>) ?? {
      Name: { title: {} },
      Status: {
        select: {
          options: [
            { name: 'Not Started', color: 'gray' },
            { name: 'In Progress', color: 'blue' },
            { name: 'Done', color: 'green' },
          ],
        },
      },
    };

    const db = await this.notionRequest<{ id: string; url: string }>(
      credentials,
      'POST',
      '/databases',
      {
        parent: { page_id: parentPageId },
        title: [{ type: 'text', text: { content: titleValidation.sanitized } }],
        properties,
      },
    );

    this.logger.log(`Created Notion database "${titleValidation.sanitized}" (${db.id})`);

    return {
      success: true,
      resourceId: db.id,
      resourceUrl: db.url,
      rollbackData: { action: 'create_database', databaseId: db.id },
    };
  }

  private async executeAddDatabaseItem(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const databaseId = params.databaseId as string;
    const dbValidation = NotionValidator.validateDatabaseId(databaseId);
    if (!dbValidation.valid) throw new Error(dbValidation.errors.join(', '));

    const properties = params.properties as Record<string, unknown>;
    if (!properties) throw new Error('Properties are required to create a database item');

    const page = await this.notionRequest<{ id: string; url: string }>(
      credentials,
      'POST',
      '/pages',
      {
        parent: { database_id: databaseId },
        properties,
      },
    );

    this.logger.log(`Added item to Notion database ${databaseId} (${page.id})`);

    return {
      success: true,
      resourceId: page.id,
      resourceUrl: page.url,
      rollbackData: { action: 'create_page', pageId: page.id },
    };
  }

  // ─── Rollback ─────────────────────────────────────────

  async rollback(
    credentials: DecryptedCredentials,
    _auditLogId: string,
    rollbackData: Record<string, unknown>,
  ): Promise<RollbackResult> {
    const action = rollbackData.action as string;

    switch (action) {
      case 'create_page': {
        const pageId = rollbackData.pageId as string;
        await this.notionRequest(credentials, 'PATCH', `/pages/${pageId}`, {
          archived: true,
        });
        this.logger.log(`Rolled back: archived Notion page ${pageId}`);
        return { success: true, message: `Archived page ${pageId}` };
      }

      case 'create_database': {
        const databaseId = rollbackData.databaseId as string;
        await this.notionRequest(credentials, 'PATCH', `/databases/${databaseId}`, {
          archived: true,
        });
        this.logger.log(`Rolled back: archived Notion database ${databaseId}`);
        return { success: true, message: `Archived database ${databaseId}` };
      }

      default:
        return { success: false, message: `Unknown rollback action: ${action}` };
    }
  }
}
