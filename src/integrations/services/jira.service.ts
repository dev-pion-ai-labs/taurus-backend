import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { TokenManager, RefreshResult } from './token-manager';

@Injectable()
export class JiraService implements OnModuleInit {
  private readonly logger = new Logger(JiraService.name);

  constructor(
    private prisma: PrismaService,
    private tokenManager: TokenManager,
  ) {}

  onModuleInit() {
    this.tokenManager.registerStrategy('JIRA', async (refreshToken) => {
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

  /** Create a Jira issue */
  async createIssue(
    organizationId: string,
    opts: {
      projectKey: string;
      summary: string;
      description?: string;
      issueType?: string;
      priority?: string;
      assigneeId?: string;
      labels?: string[];
    },
  ) {
    const body: Record<string, unknown> = {
      fields: {
        project: { key: opts.projectKey },
        summary: opts.summary,
        issuetype: { name: opts.issueType || 'Task' },
        ...(opts.description && {
          description: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: opts.description }],
              },
            ],
          },
        }),
        ...(opts.priority && { priority: { name: opts.priority } }),
        ...(opts.assigneeId && { assignee: { accountId: opts.assigneeId } }),
        ...(opts.labels?.length && { labels: opts.labels }),
      },
    };

    const response = await this.callJira(organizationId, 'POST', '/rest/api/3/issue', body);
    this.logger.log(`Created Jira issue ${response.key} for org ${organizationId}`);
    return { issueId: response.id, key: response.key, self: response.self };
  }

  /** Update issue status (transition) */
  async transitionIssue(
    organizationId: string,
    issueKey: string,
    targetStatus: string,
  ) {
    const transitions = await this.callJira(
      organizationId, 'GET', `/rest/api/3/issue/${issueKey}/transitions`,
    );

    const match = transitions.transitions?.find(
      (t: { name: string }) => t.name.toLowerCase() === targetStatus.toLowerCase(),
    );

    if (!match) {
      const available = transitions.transitions?.map((t: { name: string }) => t.name).join(', ');
      throw new BadRequestException(
        `Status "${targetStatus}" not available for ${issueKey}. Available: ${available}`,
      );
    }

    await this.callJira(organizationId, 'POST', `/rest/api/3/issue/${issueKey}/transitions`, {
      transition: { id: match.id },
    });

    this.logger.log(`Transitioned ${issueKey} to "${targetStatus}"`);
    return { issueKey, status: targetStatus };
  }

  /** Assign an issue */
  async assignIssue(organizationId: string, issueKey: string, accountId: string) {
    await this.callJira(organizationId, 'PUT', `/rest/api/3/issue/${issueKey}/assignee`, {
      accountId,
    });
    return { issueKey, assignee: accountId };
  }

  /** Add a comment to an issue */
  async addComment(organizationId: string, issueKey: string, text: string) {
    const response = await this.callJira(
      organizationId, 'POST', `/rest/api/3/issue/${issueKey}/comment`,
      {
        body: {
          type: 'doc',
          version: 1,
          content: [
            { type: 'paragraph', content: [{ type: 'text', text }] },
          ],
        },
      },
    );

    return { commentId: response.id, issueKey };
  }

  /** List projects (for discovering project keys) */
  async listProjects(organizationId: string) {
    const response = await this.callJira(organizationId, 'GET', '/rest/api/3/project');
    return (response as { key: string; name: string; id: string }[]).map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
    }));
  }

  /** Search users (for assigning) */
  async searchUsers(organizationId: string, query: string) {
    const response = await this.callJira(
      organizationId, 'GET', `/rest/api/3/user/search?query=${encodeURIComponent(query)}`,
    );

    return (response as { accountId: string; displayName: string; emailAddress?: string }[]).map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      email: u.emailAddress,
    }));
  }

  // ── Connection + Request ───────────────────────────────

  private async callJira(
    organizationId: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'JIRA' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('Jira is not connected');
    }

    // Resolve cloudId (cached on connection.externalTeamId after first call).
    let cloudId = connection.externalTeamId;
    if (!cloudId) {
      const probeToken = await this.tokenManager.getAccessToken(connection);
      cloudId = await this.resolveCloudId(connection.id, probeToken);
    }

    const url = `https://api.atlassian.com/ex/jira/${cloudId}${path}`;
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
      this.logger.error(`Jira API error (${method} ${path}): ${response.status} ${error}`);
      throw new BadRequestException(`Jira API error: ${response.status}`);
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
        `Jira accessible-resources returned non-array (${resources.status}): ${JSON.stringify(raw).slice(0, 200)}`,
      );
      throw new BadRequestException(
        `Jira connection is invalid — reconnect (HTTP ${resources.status})`,
      );
    }
    const sites = raw as { id: string; name: string }[];
    if (sites.length === 0) throw new BadRequestException('No Jira sites accessible');

    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: { externalTeamId: sites[0].id, externalTeamName: sites[0].name },
    });

    return sites[0].id;
  }
}
