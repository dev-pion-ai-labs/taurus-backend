import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { TokenManager, RefreshResult } from './token-manager';

@Injectable()
export class ConfluenceService implements OnModuleInit {
  private readonly logger = new Logger(ConfluenceService.name);

  constructor(
    private prisma: PrismaService,
    private tokenManager: TokenManager,
  ) {}

  onModuleInit() {
    this.tokenManager.registerStrategy('CONFLUENCE', async (refreshToken) => {
      const response = await fetch('https://auth.atlassian.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          client_id: process.env.JIRA_CLIENT_ID || '',
          client_secret: process.env.JIRA_CLIENT_SECRET || '',
          refresh_token: refreshToken,
        }),
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

  // ── Core Actions ───────────────────────────────────────

  async getPage(organizationId: string, pageId: string) {
    const response = await this.callConfluence(
      organizationId,
      'GET',
      `/rest/api/content/${pageId}?expand=body.storage,version,space`,
    );
    return {
      id: response.id,
      title: response.title,
      spaceKey: response.space?.key,
      body: response.body?.storage?.value,
      version: response.version?.number,
      url: response._links?.webui,
    };
  }

  async searchPages(
    organizationId: string,
    opts: { query: string; spaceKey?: string; limit?: number },
  ) {
    let cql = `type=page AND text~"${opts.query}"`;
    if (opts.spaceKey) cql += ` AND space="${opts.spaceKey}"`;
    const params = new URLSearchParams({
      cql,
      limit: String(opts.limit ?? 10),
      expand: 'space',
    });
    const response = await this.callConfluence(
      organizationId,
      'GET',
      `/rest/api/content/search?${params.toString()}`,
    );
    return (response.results ?? []).map(
      (p: { id: string; title: string; space: { key: string }; _links: { webui: string } }) => ({
        id: p.id,
        title: p.title,
        spaceKey: p.space?.key,
        url: p._links?.webui,
      }),
    );
  }

  async createPage(
    organizationId: string,
    opts: {
      spaceKey: string;
      title: string;
      body: string;
      parentId?: string;
    },
  ) {
    const payload: Record<string, unknown> = {
      type: 'page',
      title: opts.title,
      space: { key: opts.spaceKey },
      body: {
        storage: {
          value: opts.body,
          representation: 'storage',
        },
      },
    };
    if (opts.parentId) {
      payload.ancestors = [{ id: opts.parentId }];
    }

    const response = await this.callConfluence(organizationId, 'POST', '/rest/api/content', payload);
    this.logger.log(`Created Confluence page "${opts.title}" for org ${organizationId}`);
    return {
      id: response.id,
      title: response.title,
      url: response._links?.webui,
    };
  }

  async updatePage(
    organizationId: string,
    pageId: string,
    opts: { title: string; body: string; version: number },
  ) {
    const payload = {
      type: 'page',
      title: opts.title,
      version: { number: opts.version },
      body: {
        storage: {
          value: opts.body,
          representation: 'storage',
        },
      },
    };

    const response = await this.callConfluence(
      organizationId,
      'PUT',
      `/rest/api/content/${pageId}`,
      payload,
    );
    this.logger.log(`Updated Confluence page ${pageId} for org ${organizationId}`);
    return {
      id: response.id,
      title: response.title,
      version: response.version?.number,
      url: response._links?.webui,
    };
  }

  async listSpaces(organizationId: string) {
    const response = await this.callConfluence(organizationId, 'GET', '/rest/api/space?limit=50');
    return (response.results ?? []).map((s: { key: string; name: string; type: string }) => ({
      key: s.key,
      name: s.name,
      type: s.type,
    }));
  }

  // ── Connection + Request ───────────────────────────────

  private async callConfluence(
    organizationId: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'CONFLUENCE' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('Confluence is not connected');
    }

    let cloudId = connection.externalTeamId;
    if (!cloudId) {
      const probeToken = await this.tokenManager.getAccessToken(connection);
      cloudId = await this.resolveCloudId(connection.id, probeToken);
    }

    const url = `https://api.atlassian.com/ex/confluence/${cloudId}${path}`;
    const response = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      (res) => res.status === 401,
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Confluence API error (${method} ${path}): ${response.status} ${error}`);
      throw new BadRequestException(`Confluence API error: ${response.status}`);
    }

    if (response.status === 204) return {};
    return response.json();
  }

  private async resolveCloudId(connectionId: string, token: string): Promise<string> {
    const resources = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = (await resources.json()) as unknown;
    if (!Array.isArray(raw)) {
      this.logger.error(
        `Confluence accessible-resources returned non-array (${resources.status}): ${JSON.stringify(raw).slice(0, 200)}`,
      );
      throw new BadRequestException(
        `Confluence connection is invalid — reconnect (HTTP ${resources.status})`,
      );
    }
    const sites = raw as { id: string; name: string }[];
    if (sites.length === 0) throw new BadRequestException('No Atlassian sites accessible');

    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: { externalTeamId: sites[0].id, externalTeamName: sites[0].name },
    });

    return sites[0].id;
  }
}
