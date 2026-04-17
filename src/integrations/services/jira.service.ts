import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class JiraService {
  private readonly logger = new Logger(JiraService.name);

  constructor(private prisma: PrismaService) {}

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
    const { token, cloudId } = await this.getConnection(organizationId);

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

    const response = await this.request(token, cloudId, 'POST', '/rest/api/3/issue', body);
    this.logger.log(`Created Jira issue ${response.key} for org ${organizationId}`);
    return { issueId: response.id, key: response.key, self: response.self };
  }

  /** Update issue status (transition) */
  async transitionIssue(
    organizationId: string,
    issueKey: string,
    targetStatus: string,
  ) {
    const { token, cloudId } = await this.getConnection(organizationId);

    // Get available transitions
    const transitions = await this.request(
      token, cloudId, 'GET', `/rest/api/3/issue/${issueKey}/transitions`,
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

    await this.request(token, cloudId, 'POST', `/rest/api/3/issue/${issueKey}/transitions`, {
      transition: { id: match.id },
    });

    this.logger.log(`Transitioned ${issueKey} to "${targetStatus}"`);
    return { issueKey, status: targetStatus };
  }

  /** Assign an issue */
  async assignIssue(organizationId: string, issueKey: string, accountId: string) {
    const { token, cloudId } = await this.getConnection(organizationId);

    await this.request(token, cloudId, 'PUT', `/rest/api/3/issue/${issueKey}/assignee`, {
      accountId,
    });

    return { issueKey, assignee: accountId };
  }

  /** Add a comment to an issue */
  async addComment(organizationId: string, issueKey: string, text: string) {
    const { token, cloudId } = await this.getConnection(organizationId);

    const response = await this.request(
      token, cloudId, 'POST', `/rest/api/3/issue/${issueKey}/comment`,
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
    const { token, cloudId } = await this.getConnection(organizationId);

    const response = await this.request(token, cloudId, 'GET', '/rest/api/3/project');
    return (response as { key: string; name: string; id: string }[]).map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
    }));
  }

  /** Search users (for assigning) */
  async searchUsers(organizationId: string, query: string) {
    const { token, cloudId } = await this.getConnection(organizationId);

    const response = await this.request(
      token, cloudId, 'GET', `/rest/api/3/user/search?query=${encodeURIComponent(query)}`,
    );

    return (response as { accountId: string; displayName: string; emailAddress?: string }[]).map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      email: u.emailAddress,
    }));
  }

  // ── Connection + Request ───────────────────────────────

  private async getConnection(organizationId: string) {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'JIRA' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('Jira is not connected');
    }

    // Jira Cloud needs cloudId from accessible-resources
    let cloudId = connection.externalTeamId;
    if (!cloudId) {
      const resources = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      });
      const sites = (await resources.json()) as { id: string; name: string }[];
      if (sites.length === 0) throw new BadRequestException('No Jira sites accessible');
      cloudId = sites[0].id;

      // Cache the cloudId
      await this.prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { externalTeamId: cloudId, externalTeamName: sites[0].name },
      });
    }

    return { token: connection.accessToken, cloudId };
  }

  private async request(
    token: string,
    cloudId: string,
    method: string,
    path: string,
    body?: unknown,
  ) {
    const url = `https://api.atlassian.com/ex/jira/${cloudId}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Jira API error (${method} ${path}): ${response.status} ${error}`);
      throw new BadRequestException(`Jira API error: ${response.status}`);
    }

    if (response.status === 204) return {};
    return response.json();
  }
}
