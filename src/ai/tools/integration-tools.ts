import Anthropic from '@anthropic-ai/sdk';

export const INTEGRATION_TOOLS: Anthropic.Tool[] = [
  // ── Slack ──────────────────────────────────────────────
  {
    name: 'slack_create_channel',
    description: 'Create a new Slack channel in the connected workspace',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Channel name (lowercase, no spaces)' },
        isPrivate: { type: 'boolean' as const, description: 'Whether the channel is private' },
      },
      required: ['name'],
    },
  },
  {
    name: 'slack_send_message',
    description: 'Send a message to a Slack channel',
    input_schema: {
      type: 'object' as const,
      properties: {
        channel: { type: 'string' as const, description: 'Channel name or ID' },
        text: { type: 'string' as const, description: 'Message text (supports Slack markdown)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'slack_set_channel_topic',
    description: 'Set the topic of a Slack channel',
    input_schema: {
      type: 'object' as const,
      properties: {
        channelId: { type: 'string' as const, description: 'Channel ID' },
        topic: { type: 'string' as const, description: 'Channel topic text' },
      },
      required: ['channelId', 'topic'],
    },
  },
  {
    name: 'slack_list_channels',
    description: 'List all Slack channels in the workspace',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'slack_list_users',
    description: 'List all users in the Slack workspace',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },

  // ── Google Drive ───────────────────────────────────────
  {
    name: 'gdrive_create_document',
    description: 'Create a Google Doc in the connected Drive',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Document title' },
        content: { type: 'string' as const, description: 'Document content in markdown' },
      },
      required: ['title', 'content'],
    },
  },

  // ── Jira ───────────────────────────────────────────────
  {
    name: 'jira_create_issue',
    description: 'Create a Jira issue/ticket',
    input_schema: {
      type: 'object' as const,
      properties: {
        projectKey: { type: 'string' as const, description: 'Jira project key (e.g., PROJ)' },
        summary: { type: 'string' as const, description: 'Issue title/summary' },
        description: { type: 'string' as const, description: 'Issue description' },
        issueType: { type: 'string' as const, description: 'Issue type: Task, Story, Bug, Epic' },
        priority: { type: 'string' as const, description: 'Priority: Highest, High, Medium, Low, Lowest' },
        labels: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Labels to add',
        },
      },
      required: ['projectKey', 'summary'],
    },
  },
  {
    name: 'jira_transition_issue',
    description: 'Move a Jira issue to a new status',
    input_schema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string' as const, description: 'Issue key (e.g., PROJ-123)' },
        targetStatus: { type: 'string' as const, description: 'Target status name (e.g., In Progress, Done)' },
      },
      required: ['issueKey', 'targetStatus'],
    },
  },
  {
    name: 'jira_add_comment',
    description: 'Add a comment to a Jira issue',
    input_schema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string' as const, description: 'Issue key (e.g., PROJ-123)' },
        text: { type: 'string' as const, description: 'Comment text' },
      },
      required: ['issueKey', 'text'],
    },
  },
  {
    name: 'jira_list_projects',
    description: 'List all Jira projects',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },

  // ── Notion ─────────────────────────────────────────────
  {
    name: 'notion_create_page',
    description: 'Create a new Notion page with content',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Page title' },
        content: { type: 'string' as const, description: 'Page content in markdown' },
        parentPageId: { type: 'string' as const, description: 'Optional parent page ID' },
      },
      required: ['title'],
    },
  },
  {
    name: 'notion_create_database',
    description: 'Create a Notion database (table) with columns',
    input_schema: {
      type: 'object' as const,
      properties: {
        parentPageId: { type: 'string' as const, description: 'Parent page ID' },
        title: { type: 'string' as const, description: 'Database title' },
        columns: {
          type: 'object' as const,
          description: 'Column definitions: { "Column Name": { "type": "select|checkbox|date|number|rich_text", "options": ["opt1"] } }',
        },
      },
      required: ['parentPageId', 'title', 'columns'],
    },
  },
  {
    name: 'notion_search',
    description: 'Search for pages and databases in Notion',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query' },
      },
      required: ['query'],
    },
  },

  // ── HubSpot ────────────────────────────────────────────
  {
    name: 'hubspot_create_contact',
    description: 'Create a new contact in HubSpot',
    input_schema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string' as const, description: 'Contact email' },
        firstName: { type: 'string' as const, description: 'First name' },
        lastName: { type: 'string' as const, description: 'Last name' },
        company: { type: 'string' as const, description: 'Company name' },
        jobTitle: { type: 'string' as const, description: 'Job title' },
      },
      required: ['email'],
    },
  },
  {
    name: 'hubspot_create_deal',
    description: 'Create a new deal in HubSpot',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Deal name' },
        stage: { type: 'string' as const, description: 'Deal stage ID' },
        amount: { type: 'number' as const, description: 'Deal amount' },
        pipeline: { type: 'string' as const, description: 'Pipeline ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'hubspot_list_pipelines',
    description: 'List all HubSpot deal pipelines and stages',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },

  // ── Salesforce ─────────────────────────────────────────
  {
    name: 'salesforce_create_record',
    description: 'Create any Salesforce object (Account, Contact, Lead, Opportunity)',
    input_schema: {
      type: 'object' as const,
      properties: {
        objectType: { type: 'string' as const, description: 'Salesforce object type: Account, Contact, Lead, Opportunity' },
        fields: { type: 'object' as const, description: 'Field values as key-value pairs' },
      },
      required: ['objectType', 'fields'],
    },
  },
  {
    name: 'salesforce_query',
    description: 'Run a SOQL query against Salesforce',
    input_schema: {
      type: 'object' as const,
      properties: {
        soql: { type: 'string' as const, description: 'SOQL query string' },
      },
      required: ['soql'],
    },
  },

  // ── Meta ───────────────────────────────────────────────
  {
    name: 'get_connected_integrations',
    description: 'Check which integrations are connected for this organization. Call this first to know what tools you can use.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
];
