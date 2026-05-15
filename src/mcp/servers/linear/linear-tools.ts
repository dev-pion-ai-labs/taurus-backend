import { z } from 'zod';
import { LinearService } from '../../../integrations/services/linear.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildLinearTools(linear: LinearService): ToolDefinition[] {
  return [
    defineTool({
      name: 'linear_create_issue',
      description: 'Create a Linear issue',
      sensitivity: 'write',
      inputSchema: z.object({
        teamId: z.string().describe('Linear team ID (use linear_list_teams to discover)'),
        title: z.string().describe('Issue title'),
        description: z.string().optional().describe('Issue description (markdown supported)'),
        priority: z
          .number()
          .int()
          .min(0)
          .max(4)
          .optional()
          .describe('Priority: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low'),
        assigneeId: z.string().optional().describe('Assignee user ID'),
        stateId: z.string().optional().describe('Workflow state ID'),
        labelIds: z.array(z.string()).optional().describe('Label IDs to attach'),
      }),
      handler: async (input, ctx) => linear.createIssue(ctx.orgId, input),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create Linear issue "${input.title}" in team ${input.teamId}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'linear_update_issue',
      description: 'Update an existing Linear issue (title, status, assignee, or priority)',
      sensitivity: 'write',
      inputSchema: z.object({
        issueId: z.string().describe('Linear issue ID'),
        title: z.string().optional(),
        description: z.string().optional(),
        stateId: z.string().optional().describe('New workflow state ID'),
        assigneeId: z.string().optional().describe('New assignee user ID'),
        priority: z
          .number()
          .int()
          .min(0)
          .max(4)
          .optional()
          .describe('Priority: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low'),
      }),
      handler: async (input, ctx) => {
        const { issueId, ...opts } = input;
        return linear.updateIssue(ctx.orgId, issueId, opts);
      },
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Update Linear issue ${input.issueId}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'linear_list_issues',
      description: 'List Linear issues, optionally filtered by team or state',
      sensitivity: 'read',
      inputSchema: z.object({
        teamId: z.string().optional().describe('Filter by team ID'),
        limit: z.number().int().min(1).max(100).optional().describe('Max results (default 25)'),
        states: z
          .array(z.string())
          .optional()
          .describe('Filter by state names (e.g. ["In Progress", "Todo"])'),
      }),
      handler: async (input, ctx) => linear.listIssues(ctx.orgId, input),
    }),

    defineTool({
      name: 'linear_list_teams',
      description: 'List all Linear teams in the workspace',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => linear.listTeams(ctx.orgId),
    }),

    defineTool({
      name: 'linear_add_comment',
      description: 'Add a comment to a Linear issue',
      sensitivity: 'write',
      inputSchema: z.object({
        issueId: z.string().describe('Linear issue ID'),
        body: z.string().describe('Comment body (markdown supported)'),
      }),
      handler: async (input, ctx) => linear.addComment(ctx.orgId, input.issueId, input.body),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Add comment to Linear issue ${input.issueId}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'linear_list_workflow_states',
      description: 'List workflow states for a Linear team (useful for resolving state IDs)',
      sensitivity: 'read',
      inputSchema: z.object({
        teamId: z.string().describe('Linear team ID'),
      }),
      handler: async (input, ctx) => linear.listWorkflowStates(ctx.orgId, input.teamId),
    }),
  ];
}
