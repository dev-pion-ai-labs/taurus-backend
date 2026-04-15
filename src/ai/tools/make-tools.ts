import Anthropic from '@anthropic-ai/sdk';

export const MAKE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'make_list_scenarios',
    description:
      'List existing Make.com automation scenarios.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'make_list_connections',
    description:
      'List configured connections (integrations) in the Make.com account.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'make_create_scenario',
    description:
      'Create a new Make.com automation scenario. Set dryRun=true to validate without creating.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string' as const,
          description: 'Scenario name',
        },
        blueprint: {
          type: 'object' as const,
          description: 'Optional Make.com scenario blueprint (JSON definition with modules and connections)',
        },
        teamId: {
          type: 'number' as const,
          description: 'Optional team ID to create the scenario in',
        },
        folderId: {
          type: 'number' as const,
          description: 'Optional folder ID to organize the scenario',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates without creating',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'make_activate_scenario',
    description:
      'Activate (turn on) a Make.com scenario so it runs on schedule. Set dryRun=true to check status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scenarioId: {
          type: 'string' as const,
          description: 'The scenario ID to activate',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, checks status without activating',
        },
      },
      required: ['scenarioId'],
    },
  },
  {
    name: 'make_test_scenario',
    description:
      'Run a Make.com scenario once for testing. Set dryRun=true to preview without running.',
    input_schema: {
      type: 'object' as const,
      properties: {
        scenarioId: {
          type: 'string' as const,
          description: 'The scenario ID to test',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates without running',
        },
      },
      required: ['scenarioId'],
    },
  },
];
