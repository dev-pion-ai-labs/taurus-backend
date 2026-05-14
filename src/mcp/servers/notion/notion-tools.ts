import { z } from 'zod';
import { NotionService } from '../../../integrations/services/notion.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

const ColumnSpec = z.object({
  type: z.string().describe('select | checkbox | date | number | rich_text'),
  options: z.array(z.string()).optional(),
});

export function buildNotionTools(notion: NotionService): ToolDefinition[] {
  return [
    defineTool({
      name: 'notion_create_page',
      description: 'Create a new Notion page with content',
      sensitivity: 'write',
      inputSchema: z.object({
        title: z.string().describe('Page title'),
        content: z.string().optional().describe('Page content in markdown'),
        parentPageId: z.string().optional(),
      }),
      handler: async (input, ctx) =>
        notion.createPage(ctx.orgId, {
          title: input.title,
          content: input.content,
          parentPageId: input.parentPageId,
        }),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create Notion page "${input.title}"`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'notion_create_database',
      description: 'Create a Notion database (table) with columns',
      sensitivity: 'write',
      inputSchema: z.object({
        parentPageId: z.string().describe('Parent page ID'),
        title: z.string().describe('Database title'),
        columns: z
          .record(z.string(), ColumnSpec)
          .describe(
            'Column definitions: { "Column Name": { type, options? } }',
          ),
      }),
      handler: async (input, ctx) =>
        notion.createDatabase(ctx.orgId, {
          parentPageId: input.parentPageId,
          title: input.title,
          properties: input.columns,
        }),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create Notion database "${input.title}" under ${input.parentPageId}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'notion_search',
      description: 'Search for pages and databases in Notion',
      sensitivity: 'read',
      inputSchema: z.object({
        query: z.string(),
      }),
      handler: async (input, ctx) => notion.search(ctx.orgId, input.query),
    }),
  ];
}
