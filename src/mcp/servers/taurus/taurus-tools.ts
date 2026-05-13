import { z } from 'zod';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';
import { TaurusContextService } from './taurus-context.service';

/**
 * Internal Taurus context tools. All read-only. Tool names match the legacy
 * IMPLEMENTATION_TOOLS + `get_connected_integrations` byte-for-byte so the
 * planner's prompt and plan history remain compatible.
 *
 * The plan doc recommends a `taurus_` prefix for the eventual external MCP
 * surface — that rename, if it happens, lives in a separate PR after Phase 1e
 * cutover so prompt/history compatibility breaks land independently.
 */
export function buildTaurusTools(
  ctxService: TaurusContextService,
): ToolDefinition[] {
  return [
    defineTool({
      name: 'get_organization_context',
      description:
        'Get org details: industry, size, business description, onboarding data',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => ctxService.getOrganizationContext(ctx.orgId),
    }),

    defineTool({
      name: 'get_department_details',
      description: 'Get department info: headcount, workflows, automation levels',
      sensitivity: 'read',
      inputSchema: z.object({
        departmentName: z
          .string()
          .optional()
          .describe('Optional department name to filter by'),
      }),
      handler: async (input, ctx) =>
        ctxService.getDepartmentDetails(ctx.orgId, input.departmentName),
    }),

    defineTool({
      name: 'get_tech_stack',
      description:
        'Get current tool/tech stack with categories, costs, utilization',
      sensitivity: 'read',
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe('Optional tool category to filter by'),
      }),
      handler: async (input, ctx) =>
        ctxService.getTechStack(ctx.orgId, input.category),
    }),

    defineTool({
      name: 'get_related_actions',
      description:
        'Get other transformation actions (potential dependencies/prerequisites)',
      sensitivity: 'read',
      inputSchema: z.object({
        department: z.string().optional(),
        status: z.string().optional(),
      }),
      handler: async (input, ctx) =>
        ctxService.getRelatedActions(ctx.orgId, input.department, input.status),
    }),

    defineTool({
      name: 'get_report_context',
      description:
        'Get the source transformation report recommendations and implementation plan',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => ctxService.getReportContext(ctx.orgId),
    }),

    defineTool({
      name: 'get_connected_integrations',
      description:
        'Check which integrations are connected for this organization. Call this first to know what tools you can use.',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) =>
        ctxService.getConnectedIntegrations(ctx.orgId),
    }),
  ];
}
