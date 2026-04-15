import Anthropic from '@anthropic-ai/sdk';

export const SLACK_TOOLS: Anthropic.Tool[] = [
  {
    name: 'slack_list_channels',
    description:
      'List all public Slack channels in the connected workspace. Use to check what exists before creating new channels.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'slack_list_users',
    description:
      'List all active users in the connected Slack workspace. Use to find user IDs for inviting to channels.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'slack_create_channel',
    description:
      'Create a new public Slack channel. Set dryRun=true to preview and validate without creating. Channel names must be lowercase with hyphens/underscores only.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string' as const,
          description:
            'Channel name (lowercase, no spaces, max 80 chars). Spaces will be converted to hyphens.',
        },
        topic: {
          type: 'string' as const,
          description: 'Optional channel topic',
        },
        purpose: {
          type: 'string' as const,
          description: 'Optional channel purpose/description',
        },
        dryRun: {
          type: 'boolean' as const,
          description:
            'If true, validates the channel name and checks for duplicates without creating',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'slack_post_message',
    description:
      'Post a message to a Slack channel. Set dryRun=true to preview without posting.',
    input_schema: {
      type: 'object' as const,
      properties: {
        channelId: {
          type: 'string' as const,
          description: 'The Slack channel ID to post to (get from slack_list_channels)',
        },
        text: {
          type: 'string' as const,
          description: 'Message text (supports Slack mrkdwn formatting)',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates the channel and message without posting',
        },
      },
      required: ['channelId', 'text'],
    },
  },
  {
    name: 'slack_invite_to_channel',
    description:
      'Invite users to a Slack channel. Set dryRun=true to preview without inviting.',
    input_schema: {
      type: 'object' as const,
      properties: {
        channelId: {
          type: 'string' as const,
          description: 'The Slack channel ID',
        },
        userIds: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description:
            'Array of Slack user IDs to invite (get from slack_list_users)',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates without inviting',
        },
      },
      required: ['channelId', 'userIds'],
    },
  },
  {
    name: 'slack_create_webhook',
    description:
      'Get or configure an incoming webhook for the connected Slack workspace. Set dryRun=true to check status without changes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        channelId: {
          type: 'string' as const,
          description: 'The target channel ID for the webhook',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, checks webhook availability without changes',
        },
      },
      required: ['channelId'],
    },
  },
];
