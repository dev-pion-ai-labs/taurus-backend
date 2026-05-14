import { z } from 'zod';
import { HubSpotService } from '../../../integrations/services/hubspot.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildHubSpotTools(hubspot: HubSpotService): ToolDefinition[] {
  return [
    defineTool({
      name: 'hubspot_create_contact',
      description: 'Create a new contact in HubSpot',
      sensitivity: 'write',
      inputSchema: z.object({
        email: z.string().describe('Contact email'),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        company: z.string().optional(),
        jobTitle: z.string().optional(),
      }),
      handler: async (input, ctx) =>
        hubspot.createContact(ctx.orgId, {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          company: input.company,
          jobTitle: input.jobTitle,
        }),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create HubSpot contact ${input.email}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'hubspot_create_deal',
      description: 'Create a new deal in HubSpot',
      sensitivity: 'write',
      inputSchema: z.object({
        name: z.string().describe('Deal name'),
        stage: z.string().optional().describe('Deal stage ID'),
        amount: z.number().optional(),
        pipeline: z.string().optional().describe('Pipeline ID'),
      }),
      handler: async (input, ctx) =>
        hubspot.createDeal(ctx.orgId, {
          name: input.name,
          stage: input.stage,
          amount: input.amount,
          pipeline: input.pipeline,
        }),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create HubSpot deal "${input.name}"`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'hubspot_list_pipelines',
      description: 'List all HubSpot deal pipelines and stages',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: async (_input, ctx) => hubspot.listPipelines(ctx.orgId),
    }),
  ];
}
