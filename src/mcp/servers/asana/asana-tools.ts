import { z } from 'zod';
import { AsanaService } from '../../../integrations/services/asana.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildAsanaTools(asana: AsanaService): ToolDefinition[] {
  return [
    defineTool({
      name: 'asana_create_task',
      description: 'Create a new Asana task',
      sensitivity: 'write',
      inputSchema: z.object({
        name: z.string().describe('Task name'),
        projectId: z.string().optional().describe('Project GID to add the task to'),
        workspaceId: z.string().optional().describe('Workspace GID (required if no projectId)'),
        notes: z.string().optional().describe('Task description'),
        assigneeId: z.string().optional().describe('Assignee user GID'),
        dueOn: z
          .string()
          .optional()
          .describe('Due date in YYYY-MM-DD format'),
      }),
      handler: async (input, ctx) => asana.createTask(ctx.orgId, input),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create Asana task "${input.name}"`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'asana_update_task',
      description: 'Update an Asana task (name, notes, completion status, assignee, due date)',
      sensitivity: 'write',
      inputSchema: z.object({
        taskId: z.string().describe('Task GID'),
        name: z.string().optional(),
        notes: z.string().optional(),
        completed: z.boolean().optional().describe('Mark task complete or incomplete'),
        assigneeId: z.string().optional().describe('New assignee user GID'),
        dueOn: z.string().optional().describe('Due date in YYYY-MM-DD format'),
      }),
      handler: async (input, ctx) => {
        const { taskId, ...opts } = input;
        return asana.updateTask(ctx.orgId, taskId, opts);
      },
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Update Asana task ${input.taskId}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'asana_list_tasks',
      description: 'List Asana tasks in a project or assigned to a user',
      sensitivity: 'read',
      inputSchema: z.object({
        projectId: z.string().optional().describe('Filter by project GID'),
        assigneeId: z
          .string()
          .optional()
          .describe('Filter by assignee GID (requires workspaceId)'),
        workspaceId: z
          .string()
          .optional()
          .describe('Workspace GID (required when filtering by assignee)'),
        limit: z.number().int().min(1).max(100).optional().describe('Max results (default 25)'),
      }),
      handler: async (input, ctx) => asana.listTasks(ctx.orgId, input),
    }),

    defineTool({
      name: 'asana_list_projects',
      description: 'List Asana projects in a workspace',
      sensitivity: 'read',
      inputSchema: z.object({
        workspaceId: z.string().optional().describe('Filter by workspace GID'),
      }),
      handler: async (input, ctx) => asana.listProjects(ctx.orgId, input.workspaceId),
    }),

    defineTool({
      name: 'asana_add_comment',
      description: 'Add a comment to an Asana task',
      sensitivity: 'write',
      inputSchema: z.object({
        taskId: z.string().describe('Task GID'),
        text: z.string().describe('Comment text'),
      }),
      handler: async (input, ctx) => asana.addComment(ctx.orgId, input.taskId, input.text),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Add comment to Asana task ${input.taskId}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'asana_list_workspaces',
      description: 'List all Asana workspaces accessible by the connected account',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => asana.listWorkspaces(ctx.orgId),
    }),
  ];
}
