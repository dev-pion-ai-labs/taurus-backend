import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class NotionService {
  private readonly logger = new Logger(NotionService.name);
  private readonly NOTION_API = 'https://api.notion.com/v1';
  private readonly NOTION_VERSION = '2022-06-28';

  constructor(private prisma: PrismaService) {}

  // ── Core Actions ───────────────────────────────────────

  /** Create a new Notion page */
  async createPage(
    organizationId: string,
    opts: {
      parentPageId?: string;
      title: string;
      content?: string;
    },
  ) {
    const token = await this.getToken(organizationId);

    // If no parent, search for a workspace-level page to use
    let parent: Record<string, unknown>;
    if (opts.parentPageId) {
      parent = { page_id: opts.parentPageId };
    } else {
      // Use first available page as parent
      const pages = await this.search(organizationId, 'Taurus');
      if (pages.length > 0) {
        parent = { page_id: pages[0].id };
      } else {
        // Create in workspace root — requires database parent or page parent
        // For now, use a page_id from search
        const allPages = await this.search(organizationId, '');
        if (allPages.length > 0) {
          parent = { page_id: allPages[0].id };
        } else {
          throw new BadRequestException(
            'No Notion pages found — create at least one page in your workspace first',
          );
        }
      }
    }

    const children = opts.content
      ? this.markdownToBlocks(opts.content)
      : [];

    const response = await this.request(token, 'POST', '/pages', {
      parent,
      properties: {
        title: {
          title: [{ text: { content: opts.title } }],
        },
      },
      children: children.slice(0, 100), // Notion limit: 100 blocks per request
    });

    this.logger.log(`Created Notion page "${opts.title}" for org ${organizationId}`);
    return { pageId: response.id, url: response.url };
  }

  /** Create a Notion database (table) */
  async createDatabase(
    organizationId: string,
    opts: {
      parentPageId: string;
      title: string;
      properties: Record<string, { type: string; options?: string[] }>;
    },
  ) {
    const token = await this.getToken(organizationId);

    const properties: Record<string, unknown> = {
      Name: { title: {} },
    };

    for (const [name, config] of Object.entries(opts.properties)) {
      switch (config.type) {
        case 'select':
          properties[name] = {
            select: {
              options: (config.options || []).map((o) => ({ name: o })),
            },
          };
          break;
        case 'multi_select':
          properties[name] = {
            multi_select: {
              options: (config.options || []).map((o) => ({ name: o })),
            },
          };
          break;
        case 'checkbox':
          properties[name] = { checkbox: {} };
          break;
        case 'date':
          properties[name] = { date: {} };
          break;
        case 'number':
          properties[name] = { number: {} };
          break;
        case 'rich_text':
          properties[name] = { rich_text: {} };
          break;
        case 'url':
          properties[name] = { url: {} };
          break;
        default:
          properties[name] = { rich_text: {} };
      }
    }

    const response = await this.request(token, 'POST', '/databases', {
      parent: { page_id: opts.parentPageId },
      title: [{ text: { content: opts.title } }],
      properties,
    });

    this.logger.log(`Created Notion database "${opts.title}" for org ${organizationId}`);
    return { databaseId: response.id, url: response.url };
  }

  /** Add a row to a Notion database */
  async addDatabaseRow(
    organizationId: string,
    databaseId: string,
    properties: Record<string, unknown>,
  ) {
    const token = await this.getToken(organizationId);

    const response = await this.request(token, 'POST', '/pages', {
      parent: { database_id: databaseId },
      properties,
    });

    return { pageId: response.id, url: response.url };
  }

  /** Search for pages/databases */
  async search(organizationId: string, query: string) {
    const token = await this.getToken(organizationId);

    const response = await this.request(token, 'POST', '/search', {
      query,
      page_size: 10,
    });

    return (response.results as { id: string; url: string; properties?: Record<string, unknown> }[]).map((r) => ({
      id: r.id,
      url: r.url,
    }));
  }

  // ── Helpers ────────────────────────────────────────────

  private async getToken(organizationId: string): Promise<string> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'NOTION' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('Notion is not connected');
    }

    return connection.accessToken;
  }

  private async request(token: string, method: string, path: string, body?: unknown) {
    const response = await fetch(`${this.NOTION_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': this.NOTION_VERSION,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Notion API error (${method} ${path}): ${response.status} ${error}`);
      throw new BadRequestException(`Notion API error: ${response.status}`);
    }

    return response.json();
  }

  /** Convert simple markdown to Notion blocks */
  private markdownToBlocks(markdown: string): Record<string, unknown>[] {
    const blocks: Record<string, unknown>[] = [];

    for (const line of markdown.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('### ')) {
        blocks.push({
          type: 'heading_3',
          heading_3: { rich_text: [{ text: { content: trimmed.slice(4) } }] },
        });
      } else if (trimmed.startsWith('## ')) {
        blocks.push({
          type: 'heading_2',
          heading_2: { rich_text: [{ text: { content: trimmed.slice(3) } }] },
        });
      } else if (trimmed.startsWith('# ')) {
        blocks.push({
          type: 'heading_1',
          heading_1: { rich_text: [{ text: { content: trimmed.slice(2) } }] },
        });
      } else if (/^- \[[ x]\]/.test(trimmed)) {
        const checked = trimmed.startsWith('- [x]');
        const text = trimmed.replace(/^- \[[ x]\]\s*/, '');
        blocks.push({
          type: 'to_do',
          to_do: {
            rich_text: [{ text: { content: text } }],
            checked,
          },
        });
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ text: { content: trimmed.slice(2) } }],
          },
        });
      } else if (/^\d+\.\s/.test(trimmed)) {
        blocks.push({
          type: 'numbered_list_item',
          numbered_list_item: {
            rich_text: [{ text: { content: trimmed.replace(/^\d+\.\s/, '') } }],
          },
        });
      } else {
        blocks.push({
          type: 'paragraph',
          paragraph: {
            rich_text: [{ text: { content: trimmed } }],
          },
        });
      }
    }

    return blocks;
  }
}
