import Anthropic from '@anthropic-ai/sdk';

export const IMPLEMENTATION_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_organization_context',
    description:
      'Get org details: industry, size, business description, onboarding data',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_department_details',
    description:
      'Get department info: headcount, workflows, automation levels',
    input_schema: {
      type: 'object' as const,
      properties: {
        departmentName: {
          type: 'string' as const,
          description: 'Optional department name to filter by',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_tech_stack',
    description:
      'Get current tool/tech stack with categories, costs, utilization',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string' as const,
          description: 'Optional tool category to filter by',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_related_actions',
    description:
      'Get other transformation actions (potential dependencies/prerequisites)',
    input_schema: {
      type: 'object' as const,
      properties: {
        department: {
          type: 'string' as const,
          description: 'Optional department to filter by',
        },
        status: {
          type: 'string' as const,
          description: 'Optional action status to filter by',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_report_context',
    description:
      'Get the source transformation report recommendations and implementation plan',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
];
