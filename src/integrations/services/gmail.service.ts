import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { TokenManager, RefreshResult } from './token-manager';

@Injectable()
export class GmailService implements OnModuleInit {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private prisma: PrismaService,
    private tokenManager: TokenManager,
  ) {}

  onModuleInit() {
    this.tokenManager.registerStrategy('GMAIL', async (refreshToken) => {
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
        organizationId_provider: { organizationId, provider: 'GMAIL' },
      },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException(
        'Gmail is not connected — connect it in Settings > Integrations',
      );
    }

    return connection;
  }

  private buildRawMessage(opts: {
    to: string[];
    subject: string;
    body: string;
    cc?: string[];
    isHtml?: boolean;
  }): string {
    const lines = [
      `To: ${opts.to.join(', ')}`,
      opts.cc?.length ? `Cc: ${opts.cc.join(', ')}` : null,
      `Subject: ${opts.subject}`,
      `Content-Type: ${opts.isHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`,
      '',
      opts.body,
    ]
      .filter((l) => l !== null)
      .join('\r\n');

    return Buffer.from(lines)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async sendEmail(
    organizationId: string,
    opts: {
      to: string[];
      subject: string;
      body: string;
      cc?: string[];
      isHtml?: boolean;
    },
  ) {
    const connection = await this.getConnection(organizationId);
    const raw = this.buildRawMessage(opts);

    const result = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw }),
        }),
      (res) => res.status === 401,
    );

    if (!result.ok) {
      if (result.status === 401) {
        await this.tokenManager.markExpired(connection.id);
        throw new BadRequestException(
          'Gmail token expired — please reconnect in Settings',
        );
      }
      const errorText = await result.text();
      this.logger.error(`Gmail sendEmail failed: ${result.status} ${errorText}`);
      throw new BadRequestException('Failed to send email via Gmail');
    }

    const message = (await result.json()) as { id: string; threadId: string };

    this.logger.log(
      `Sent email "${opts.subject}" to ${opts.to.join(', ')} for org ${organizationId}`,
    );

    return {
      messageId: message.id,
      threadId: message.threadId,
    };
  }

  async createDraft(
    organizationId: string,
    opts: {
      to: string[];
      subject: string;
      body: string;
      cc?: string[];
      isHtml?: boolean;
    },
  ) {
    const connection = await this.getConnection(organizationId);
    const raw = this.buildRawMessage(opts);

    const result = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: { raw } }),
        }),
      (res) => res.status === 401,
    );

    if (!result.ok) {
      if (result.status === 401) {
        await this.tokenManager.markExpired(connection.id);
        throw new BadRequestException(
          'Gmail token expired — please reconnect in Settings',
        );
      }
      const errorText = await result.text();
      this.logger.error(`Gmail createDraft failed: ${result.status} ${errorText}`);
      throw new BadRequestException('Failed to create Gmail draft');
    }

    const draft = (await result.json()) as {
      id: string;
      message: { id: string; threadId: string };
    };

    this.logger.log(
      `Created draft "${opts.subject}" for org ${organizationId}`,
    );

    return {
      draftId: draft.id,
      messageId: draft.message.id,
    };
  }

  async listEmails(
    organizationId: string,
    opts: {
      query?: string;
      maxResults?: number;
      labelIds?: string[];
    } = {},
  ) {
    const connection = await this.getConnection(organizationId);
    const params = new URLSearchParams({
      maxResults: String(opts.maxResults ?? 10),
    });
    if (opts.query) params.set('q', opts.query);
    if (opts.labelIds?.length) params.set('labelIds', opts.labelIds.join(','));

    const listResult = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      (res) => res.status === 401,
    );

    if (!listResult.ok) {
      if (listResult.status === 401) {
        await this.tokenManager.markExpired(connection.id);
        throw new BadRequestException(
          'Gmail token expired — please reconnect in Settings',
        );
      }
      const errorText = await listResult.text();
      this.logger.error(`Gmail listEmails failed: ${listResult.status} ${errorText}`);
      throw new BadRequestException('Failed to list emails from Gmail');
    }

    const data = (await listResult.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
    };

    if (!data.messages?.length) return [];

    // Fetch snippet + headers for each message (parallel, capped at 10)
    const token = await this.tokenManager.getAccessToken(connection);
    const details = await Promise.all(
      data.messages.slice(0, 10).map((m) =>
        fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          { headers: { Authorization: `Bearer ${token}` } },
        ).then((r) => r.json() as Promise<{
          id: string;
          threadId: string;
          snippet: string;
          payload: {
            headers: Array<{ name: string; value: string }>;
          };
        }>),
      ),
    );

    return details.map((msg) => {
      const headers = msg.payload?.headers ?? [];
      const get = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
      return {
        messageId: msg.id,
        threadId: msg.threadId,
        subject: get('Subject'),
        from: get('From'),
        to: get('To'),
        date: get('Date'),
        snippet: msg.snippet,
      };
    });
  }
}
