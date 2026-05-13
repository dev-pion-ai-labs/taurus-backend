import { z } from 'zod';
import { GoogleDriveService } from '../../../integrations/services/google-drive.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildGDriveTools(gdrive: GoogleDriveService): ToolDefinition[] {
  return [
    defineTool({
      name: 'gdrive_create_document',
      description: 'Create a Google Doc in the connected Drive',
      sensitivity: 'write',
      inputSchema: z.object({
        title: z.string().describe('Document title'),
        content: z.string().describe('Document content in markdown'),
      }),
      handler: async (input, ctx) =>
        gdrive.exportDocument(ctx.orgId, input.title, input.content),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create Google Doc "${input.title}"`,
        params: input as Record<string, unknown>,
      }),
    }),
  ];
}
