import { z } from 'zod';
import { GmailService } from '../../../integrations/services/gmail.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildGmailTools(gmail: GmailService): ToolDefinition[] {
  return [
    defineTool({
      name: 'gmail_send_email',
      description: 'Send an email via Gmail',
      sensitivity: 'write',
      inputSchema: z.object({
        to: z.array(z.string().email()).min(1).describe('Recipient email addresses'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text or HTML)'),
        cc: z.array(z.string().email()).optional().describe('CC email addresses'),
        isHtml: z.boolean().optional().describe('Set true if body is HTML (default: plain text)'),
      }),
      handler: async (input, ctx) =>
        gmail.sendEmail(ctx.orgId, input),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Send email "${input.subject}" to ${input.to.join(', ')}`,
        params: input as Record<string, unknown>,
      }),
    }),
    defineTool({
      name: 'gmail_create_draft',
      description: 'Create a Gmail draft (does not send)',
      sensitivity: 'write',
      inputSchema: z.object({
        to: z.array(z.string().email()).min(1).describe('Recipient email addresses'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body (plain text or HTML)'),
        cc: z.array(z.string().email()).optional().describe('CC email addresses'),
        isHtml: z.boolean().optional().describe('Set true if body is HTML'),
      }),
      handler: async (input, ctx) =>
        gmail.createDraft(ctx.orgId, input),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create draft "${input.subject}" to ${input.to.join(', ')}`,
        params: input as Record<string, unknown>,
      }),
    }),
    defineTool({
      name: 'gmail_list_emails',
      description: 'List emails from Gmail inbox',
      sensitivity: 'read',
      inputSchema: z.object({
        query: z.string().optional().describe('Gmail search query (e.g. "from:someone@example.com" or "subject:invoice")'),
        maxResults: z.number().int().min(1).max(50).optional().describe('Maximum number of emails to return (default 10)'),
        labelIds: z.array(z.string()).optional().describe('Filter by label IDs (e.g. ["INBOX", "UNREAD"])'),
      }),
      handler: async (input, ctx) =>
        gmail.listEmails(ctx.orgId, input),
    }),
  ];
}
