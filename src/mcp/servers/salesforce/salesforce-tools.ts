import { z } from 'zod';
import { SalesforceService } from '../../../integrations/services/salesforce.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildSalesforceTools(
  salesforce: SalesforceService,
): ToolDefinition[] {
  return [
    defineTool({
      name: 'salesforce_create_record',
      description:
        'Create any Salesforce object (Account, Contact, Lead, Opportunity)',
      sensitivity: 'write',
      inputSchema: z.object({
        objectType: z
          .string()
          .describe('Salesforce object type: Account, Contact, Lead, Opportunity'),
        fields: z
          .record(z.string(), z.unknown())
          .describe('Field values as key-value pairs'),
      }),
      handler: async (input, ctx) =>
        salesforce.createRecord(
          ctx.orgId,
          input.objectType,
          input.fields as Record<string, unknown>,
        ),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create Salesforce ${input.objectType}`,
        params: input as Record<string, unknown>,
      }),
    }),

    defineTool({
      name: 'salesforce_query',
      description: 'Run a SOQL query against Salesforce',
      sensitivity: 'read',
      inputSchema: z.object({
        soql: z.string().describe('SOQL query string'),
      }),
      handler: async (input, ctx) => salesforce.query(ctx.orgId, input.soql),
    }),
  ];
}
