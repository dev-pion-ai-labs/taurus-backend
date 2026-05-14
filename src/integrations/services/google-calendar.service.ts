import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { TokenManager, RefreshResult } from './token-manager';

@Injectable()
export class GoogleCalendarService implements OnModuleInit {
  private readonly logger = new Logger(GoogleCalendarService.name);

  constructor(
    private prisma: PrismaService,
    private tokenManager: TokenManager,
  ) {}

  onModuleInit() {
    this.tokenManager.registerStrategy('GOOGLE_CALENDAR', async (refreshToken) => {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
      };

      const result: RefreshResult = {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      };
      if (data.refresh_token) result.refreshToken = data.refresh_token;
      return result;
    });
  }

  private async getConnection(organizationId: string) {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: 'GOOGLE_CALENDAR' },
      },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException(
        'Google Calendar is not connected — connect it in Settings > Integrations',
      );
    }

    return connection;
  }

  async createEvent(
    organizationId: string,
    opts: {
      summary: string;
      description?: string;
      startDateTime: string;
      endDateTime: string;
      attendees?: string[];
      calendarId?: string;
    },
  ) {
    const connection = await this.getConnection(organizationId);
    const calendarId = opts.calendarId || 'primary';

    const eventBody: Record<string, unknown> = {
      summary: opts.summary,
      start: { dateTime: opts.startDateTime },
      end: { dateTime: opts.endDateTime },
    };

    if (opts.description) eventBody.description = opts.description;
    if (opts.attendees?.length) {
      eventBody.attendees = opts.attendees.map((email) => ({ email }));
    }

    const result = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(eventBody),
          },
        ),
      (res) => res.status === 401,
    );

    if (!result.ok) {
      if (result.status === 401) {
        await this.tokenManager.markExpired(connection.id);
        throw new BadRequestException(
          'Google Calendar token expired — please reconnect in Settings',
        );
      }
      const errorText = await result.text();
      this.logger.error(`Google Calendar createEvent failed: ${result.status} ${errorText}`);
      throw new BadRequestException('Failed to create Google Calendar event');
    }

    const event = (await result.json()) as {
      id: string;
      summary: string;
      htmlLink: string;
      start: { dateTime: string };
      end: { dateTime: string };
    };

    this.logger.log(
      `Created calendar event "${event.summary}" for org ${organizationId}`,
    );

    return {
      eventId: event.id,
      summary: event.summary,
      htmlLink: event.htmlLink,
      start: event.start.dateTime,
      end: event.end.dateTime,
    };
  }

  async listEvents(
    organizationId: string,
    opts: {
      maxResults?: number;
      timeMin?: string;
      calendarId?: string;
    } = {},
  ) {
    const connection = await this.getConnection(organizationId);
    const calendarId = opts.calendarId || 'primary';
    const params = new URLSearchParams({
      maxResults: String(opts.maxResults ?? 10),
      orderBy: 'startTime',
      singleEvents: 'true',
      timeMin: opts.timeMin ?? new Date().toISOString(),
    });

    const result = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        ),
      (res) => res.status === 401,
    );

    if (!result.ok) {
      if (result.status === 401) {
        await this.tokenManager.markExpired(connection.id);
        throw new BadRequestException(
          'Google Calendar token expired — please reconnect in Settings',
        );
      }
      const errorText = await result.text();
      this.logger.error(`Google Calendar listEvents failed: ${result.status} ${errorText}`);
      throw new BadRequestException('Failed to list Google Calendar events');
    }

    const data = (await result.json()) as {
      items: Array<{
        id: string;
        summary: string;
        description?: string;
        htmlLink: string;
        start: { dateTime?: string; date?: string };
        end: { dateTime?: string; date?: string };
        attendees?: Array<{ email: string; responseStatus: string }>;
      }>;
    };

    return data.items.map((e) => ({
      eventId: e.id,
      summary: e.summary,
      description: e.description,
      htmlLink: e.htmlLink,
      start: e.start.dateTime ?? e.start.date,
      end: e.end.dateTime ?? e.end.date,
      attendees: e.attendees?.map((a) => a.email),
    }));
  }
}
