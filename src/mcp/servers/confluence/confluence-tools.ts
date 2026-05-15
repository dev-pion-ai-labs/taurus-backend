import { z } from 'zod';
import { ConfluenceService } from '../../../integrations/services/confluence.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildConfluenceTools(confluence: ConfluenceService): ToolDefinition[] {
  return [
    defineTool({
      name: 'confluence_get_page',
      description: 'Get a Confluence page by ID, including its full body content',
      sensitivity: 'read',
      inputSchema: z.object({
        pageId: z.string().describe('Confluence page ID'),
      }),
      handler: async (input, ctx) => confluence.getPage(ctx.orgId, input.pageId),
    }),

    defineTool({
      name: 'confluence_search',
      description: 'Search Confluence pages by keyword',
      sensitivity: 'read',
      inputSchema: z.object({
        query: z.string().describe('Search keywords'),
        spaceKey: z.string().optional().describe('Limit search to a specific space key'),
        limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
      }),
      handler: async (input, ctx) =>
        confluence.searchPages(ctx.orgId, {
          query: input.query,
          spaceKey: input.spaceKey,
          limit: input.limit,
        }),
    }),

    defineTool({
      name: 'confluence_create_page',
      description: 'Create a new Confluence page',
      sensitivity: 'write',
      inputSchema: z.object({
        spaceKey: z.string().describe('Space key where the page will be created (e.g., TEAM)'),
        title: z.string().describe('Page title'),
        body: z.string().describe('Page body in Confluence storage format (HTML-like XHTML)'),
        parentId: z.string().optional().describe('Parent page ID to nest under'),
      }),
      handler: async (input, ctx) =>
        confluence.createPage(ctx.orgId, {
          spaceKey: input.spaceKey,
          title: input.title,
          body: input.body,
          parentId: input.parentId,
        }),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create Confluence page "${input.title}" in space ${input.spaceKey}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'confluence_update_page',
      description: 'Update an existing Confluence page (requires current version number)',
      sensitivity: 'write',
      inputSchema: z.object({
        pageId: z.string().describe('Confluence page ID'),
        title: z.string().describe('New page title'),
        body: z.string().describe('New page body in Confluence storage format'),
        version: z.number().int().describe('Current version number (increment by 1 from current)'),
      }),
      handler: async (input, ctx) =>
        confluence.updatePage(ctx.orgId, input.pageId, {
          title: input.title,
          body: input.body,
          version: input.version,
        }),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Update Confluence page ${input.pageId} to version ${input.version}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'confluence_list_spaces',
      description: 'List all accessible Confluence spaces',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => confluence.listSpaces(ctx.orgId),
    }),
  ];
}
