import { z } from 'zod';
import { JiraService } from '../../../integrations/services/jira.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildJiraTools(jira: JiraService): ToolDefinition[] {
  return [
    defineTool({
      name: 'jira_create_issue',
      description: 'Create a Jira issue/ticket',
      sensitivity: 'write',
      inputSchema: z.object({
        projectKey: z.string().describe('Jira project key (e.g., PROJ)'),
        summary: z.string().describe('Issue title/summary'),
        description: z.string().optional(),
        issueType: z.string().optional().describe('Task, Story, Bug, Epic'),
        priority: z
          .string()
          .optional()
          .describe('Highest, High, Medium, Low, Lowest'),
        labels: z.array(z.string()).optional(),
      }),
      handler: async (input, ctx) =>
        jira.createIssue(ctx.orgId, {
          projectKey: input.projectKey,
          summary: input.summary,
          description: input.description,
          issueType: input.issueType,
          priority: input.priority,
          labels: input.labels,
        }),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create ${input.issueType ?? 'Task'} "${input.summary}" in ${input.projectKey}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'jira_transition_issue',
      description: 'Move a Jira issue to a new status',
      sensitivity: 'write',
      inputSchema: z.object({
        issueKey: z.string().describe('Issue key (e.g., PROJ-123)'),
        targetStatus: z.string().describe('Target status name (e.g., In Progress, Done)'),
      }),
      handler: async (input, ctx) =>
        jira.transitionIssue(ctx.orgId, input.issueKey, input.targetStatus),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Transition ${input.issueKey} → ${input.targetStatus}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'jira_add_comment',
      description: 'Add a comment to a Jira issue',
      sensitivity: 'write',
      inputSchema: z.object({
        issueKey: z.string().describe('Issue key (e.g., PROJ-123)'),
        text: z.string().describe('Comment text'),
      }),
      handler: async (input, ctx) =>
        jira.addComment(ctx.orgId, input.issueKey, input.text),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Comment on ${input.issueKey}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'jira_list_projects',
      description: 'List all Jira projects',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => jira.listProjects(ctx.orgId),
    }),
  ];
}
