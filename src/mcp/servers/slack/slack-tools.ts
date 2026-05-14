import { z } from 'zod';
import { SlackService } from '../../../integrations/services/slack.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

/**
 * Slack tool registry. Tool names are byte-identical to the legacy
 * INTEGRATION_TOOLS entries so plan history and prompts remain compatible.
 *
 * Sensitivity annotations are declared but planning-mode gating is not yet
 * active in Phase 1b — the planner loop passes `approved-execution` to
 * preserve parity with the legacy IntegrationToolExecutor. Flipping on
 * planning-time dry-runs is a deliberate follow-up step.
 */
export function buildSlackTools(slack: SlackService): ToolDefinition[] {
  return [
    defineTool({
      name: 'slack_create_channel',
      description: 'Create a new Slack channel in the connected workspace',
      sensitivity: 'write',
      inputSchema: z.object({
        name: z.string().describe('Channel name (lowercase, no spaces)'),
        isPrivate: z.boolean().optional(),
      }),
      handler: async (input, ctx) =>
        slack.createChannel(ctx.orgId, input.name, input.isPrivate ?? false),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create ${input.isPrivate ? 'private' : 'public'} channel #${input.name}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'slack_send_message',
      description: 'Send a message to a Slack channel',
      sensitivity: 'write',
      inputSchema: z.object({
        channel: z.string().optional().describe('Channel name or ID'),
        text: z.string().describe('Message text (supports Slack markdown)'),
      }),
      handler: async (input, ctx) =>
        slack.sendMessage(ctx.orgId, { channel: input.channel, text: input.text }),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Send message to ${input.channel ?? 'default channel'}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'slack_set_channel_topic',
      description: 'Set the topic of a Slack channel',
      sensitivity: 'write',
      inputSchema: z.object({
        channelId: z.string().describe('Channel ID'),
        topic: z.string().describe('Channel topic text'),
      }),
      handler: async (input, ctx) =>
        slack.setChannelTopic(ctx.orgId, input.channelId, input.topic),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Set topic of ${input.channelId}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'slack_list_channels',
      description: 'List all Slack channels in the workspace',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => slack.listChannels(ctx.orgId),
    }),

    defineTool({
      name: 'slack_list_users',
      description: 'List all users in the Slack workspace',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => slack.listUsers(ctx.orgId),
    }),
  ];
}
