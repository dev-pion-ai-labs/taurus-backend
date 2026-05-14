import { z } from 'zod';
import { GoogleCalendarService } from '../../../integrations/services/google-calendar.service';
import { defineTool, ToolDefinition } from '../../core/mcp-tool';

export function buildGCalTools(gcal: GoogleCalendarService): ToolDefinition[] {
  return [
    defineTool({
      name: 'gcal_create_event',
      description: 'Create a Google Calendar event',
      sensitivity: 'write',
      inputSchema: z.object({
        summary: z.string().describe('Event title'),
        startDateTime: z.string().describe('Start datetime in ISO 8601 format (e.g. 2026-06-01T10:00:00+01:00)'),
        endDateTime: z.string().describe('End datetime in ISO 8601 format'),
        description: z.string().optional().describe('Event description or agenda'),
        attendees: z.array(z.string().email()).optional().describe('List of attendee email addresses'),
        calendarId: z.string().optional().describe('Calendar ID to add event to (defaults to primary)'),
      }),
      handler: async (input, ctx) =>
        gcal.createEvent(ctx.orgId, input),
      dryRun: (input) => ({
        wouldExecute: true,
        summary: `Create calendar event "${input.summary}" from ${input.startDateTime} to ${input.endDateTime}`,
        params: input as Record<string, unknown>,
      }),
    }),
    defineTool({
      name: 'gcal_list_events',
      description: 'List upcoming Google Calendar events',
      sensitivity: 'read',
      inputSchema: z.object({
        maxResults: z.number().int().min(1).max(50).optional().describe('Maximum number of events to return (default 10)'),
        timeMin: z.string().optional().describe('Lower bound for event start time in ISO 8601 format (defaults to now)'),
        calendarId: z.string().optional().describe('Calendar ID to query (defaults to primary)'),
      }),
      handler: async (input, ctx) =>
        gcal.listEvents(ctx.orgId, input),
    }),
  ];
}
