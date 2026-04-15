import Anthropic from '@anthropic-ai/sdk';

export const NOTION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'notion_list_databases',
    description:
      'List all Notion databases accessible to the integration.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'notion_search_pages',
    description:
      'Search for Notion pages. Returns pages the integration has access to.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string' as const,
          description: 'Optional search query to filter pages by title',
        },
      },
      required: [],
    },
  },
  {
    name: 'notion_create_page',
    description:
      'Create a new Notion page with content. Set dryRun=true to validate without creating.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string' as const,
          description: 'Page title',
        },
        parentPageId: {
          type: 'string' as const,
          description: 'Parent page ID to create this page under',
        },
        content: {
          type: 'string' as const,
          description: 'Page content as plain text (paragraphs separated by double newlines)',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates without creating',
        },
      },
      required: ['title', 'parentPageId'],
    },
  },
  {
    name: 'notion_create_database',
    description:
      'Create a new Notion database (table) under a parent page. Set dryRun=true to validate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string' as const,
          description: 'Database title',
        },
        parentPageId: {
          type: 'string' as const,
          description: 'Parent page ID to create this database under',
        },
        properties: {
          type: 'object' as const,
          description: 'Database property schema (Notion property definitions). Defaults to Name + Status if omitted.',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates without creating',
        },
      },
      required: ['title', 'parentPageId'],
    },
  },
  {
    name: 'notion_add_database_item',
    description:
      'Add a new item (row) to an existing Notion database. Set dryRun=true to validate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        databaseId: {
          type: 'string' as const,
          description: 'The Notion database ID to add the item to',
        },
        properties: {
          type: 'object' as const,
          description: 'Properties for the new item matching the database schema',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates without creating',
        },
      },
      required: ['databaseId', 'properties'],
    },
  },
];
