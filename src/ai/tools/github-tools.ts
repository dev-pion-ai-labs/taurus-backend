import Anthropic from '@anthropic-ai/sdk';

export const GITHUB_TOOLS: Anthropic.Tool[] = [
  {
    name: 'github_list_repos',
    description:
      "List the organization's accessible GitHub repositories, sorted by most recently updated.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'github_list_workflows',
    description:
      'List existing GitHub Actions workflows in a repository.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string' as const,
          description: 'Repository full name in "owner/repo" format',
        },
      },
      required: ['repo'],
    },
  },
  {
    name: 'github_create_workflow',
    description:
      'Create a GitHub Actions workflow YAML file in a repository. Set dryRun=true to validate without committing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string' as const,
          description: 'Repository full name in "owner/repo" format',
        },
        filename: {
          type: 'string' as const,
          description: 'Workflow filename (e.g. "deploy.yml"). Will be placed in .github/workflows/',
        },
        content: {
          type: 'string' as const,
          description: 'Full YAML content of the GitHub Actions workflow',
        },
        commitMessage: {
          type: 'string' as const,
          description: 'Optional commit message (defaults to a standard message)',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates the workflow without creating it',
        },
      },
      required: ['repo', 'filename', 'content'],
    },
  },
  {
    name: 'github_create_webhook',
    description:
      'Create a webhook on a GitHub repository. Set dryRun=true to validate without creating.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string' as const,
          description: 'Repository full name in "owner/repo" format',
        },
        url: {
          type: 'string' as const,
          description: 'The webhook payload URL',
        },
        events: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Events to trigger the webhook (e.g. ["push", "pull_request"]). Defaults to ["push"].',
        },
        secret: {
          type: 'string' as const,
          description: 'Optional webhook secret for payload verification',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates without creating the webhook',
        },
      },
      required: ['repo', 'url'],
    },
  },
  {
    name: 'github_trigger_workflow',
    description:
      'Manually trigger a GitHub Actions workflow dispatch. Set dryRun=true to validate without triggering.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string' as const,
          description: 'Repository full name in "owner/repo" format',
        },
        workflowId: {
          type: 'string' as const,
          description: 'Workflow ID or filename (e.g. "deploy.yml" or numeric ID)',
        },
        ref: {
          type: 'string' as const,
          description: 'Git ref to run the workflow on (default: "main")',
        },
        inputs: {
          type: 'object' as const,
          description: 'Optional workflow_dispatch inputs as key-value pairs',
        },
        dryRun: {
          type: 'boolean' as const,
          description: 'If true, validates without triggering',
        },
      },
      required: ['repo', 'workflowId'],
    },
  },
  {
    name: 'github_list_secrets',
    description:
      'List the names of Actions secrets in a repository (values are never exposed).',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: {
          type: 'string' as const,
          description: 'Repository full name in "owner/repo" format',
        },
      },
      required: ['repo'],
    },
  },
];
