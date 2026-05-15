import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { TokenManager } from './token-manager';

@Injectable()
export class LinearService implements OnModuleInit {
  private readonly logger = new Logger(LinearService.name);

  constructor(
    private prisma: PrismaService,
    private tokenManager: TokenManager,
  ) {}

  onModuleInit() {
    // Linear access tokens are long-lived (no expiry). If a 401 occurs the
    // user must reconnect — there is no refresh token flow.
    this.tokenManager.registerStrategy('LINEAR', async () => {
      throw new Error('Linear access tokens do not expire — please reconnect Linear in Settings');
    });
  }

  // ── Core Actions ───────────────────────────────────────

  async createIssue(
    organizationId: string,
    opts: {
      teamId: string;
      title: string;
      description?: string;
      priority?: number;
      assigneeId?: string;
      stateId?: string;
      labelIds?: string[];
    },
  ) {
    const result = await this.gql<{
      issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } };
    }>(organizationId, `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url title }
        }
      }
    `, {
      input: {
        teamId: opts.teamId,
        title: opts.title,
        ...(opts.description !== undefined && { description: opts.description }),
        ...(opts.priority !== undefined && { priority: opts.priority }),
        ...(opts.assigneeId && { assigneeId: opts.assigneeId }),
        ...(opts.stateId && { stateId: opts.stateId }),
        ...(opts.labelIds?.length && { labelIds: opts.labelIds }),
      },
    });

    this.logger.log(`Created Linear issue ${result.issueCreate.issue.identifier} for org ${organizationId}`);
    return result.issueCreate.issue;
  }

  async updateIssue(
    organizationId: string,
    issueId: string,
    opts: {
      title?: string;
      description?: string;
      stateId?: string;
      assigneeId?: string;
      priority?: number;
    },
  ) {
    const result = await this.gql<{
      issueUpdate: { success: boolean; issue: { id: string; identifier: string; url: string } };
    }>(organizationId, `
      mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier url title }
        }
      }
    `, {
      id: issueId,
      input: {
        ...(opts.title !== undefined && { title: opts.title }),
        ...(opts.description !== undefined && { description: opts.description }),
        ...(opts.stateId && { stateId: opts.stateId }),
        ...(opts.assigneeId !== undefined && { assigneeId: opts.assigneeId }),
        ...(opts.priority !== undefined && { priority: opts.priority }),
      },
    });

    return result.issueUpdate.issue;
  }

  async listIssues(
    organizationId: string,
    opts: { teamId?: string; limit?: number; states?: string[] } = {},
  ) {
    const filter: Record<string, unknown> = {};
    if (opts.teamId) filter.team = { id: { eq: opts.teamId } };
    if (opts.states?.length) filter.state = { name: { in: opts.states } };

    const result = await this.gql<{
      issues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          priority: number;
          url: string;
          state: { name: string };
          assignee: { name: string } | null;
        }>;
      };
    }>(organizationId, `
      query Issues($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first, orderBy: updatedAt) {
          nodes {
            id identifier title priority url
            state { name }
            assignee { name }
          }
        }
      }
    `, {
      filter: Object.keys(filter).length ? filter : undefined,
      first: opts.limit ?? 25,
    });

    return result.issues.nodes.map((i) => ({
      id: i.id,
      identifier: i.identifier,
      title: i.title,
      priority: i.priority,
      state: i.state?.name,
      assignee: i.assignee?.name ?? null,
      url: i.url,
    }));
  }

  async listTeams(organizationId: string) {
    const result = await this.gql<{
      teams: { nodes: Array<{ id: string; name: string; key: string }> };
    }>(organizationId, `
      query Teams {
        teams { nodes { id name key } }
      }
    `, {});

    return result.teams.nodes;
  }

  async addComment(organizationId: string, issueId: string, body: string) {
    const result = await this.gql<{
      commentCreate: { success: boolean; comment: { id: string } };
    }>(organizationId, `
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }
    `, {
      input: { issueId, body },
    });

    return result.commentCreate.comment;
  }

  async listWorkflowStates(organizationId: string, teamId: string) {
    const result = await this.gql<{
      workflowStates: { nodes: Array<{ id: string; name: string; type: string }> };
    }>(organizationId, `
      query WorkflowStates($filter: WorkflowStateFilter) {
        workflowStates(filter: $filter) {
          nodes { id name type }
        }
      }
    `, {
      filter: { team: { id: { eq: teamId } } },
    });

    return result.workflowStates.nodes;
  }

  // ── GraphQL Request ────────────────────────────────────

  private async gql<T>(
    organizationId: string,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'LINEAR' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('Linear is not connected');
    }

    const response = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch('https://api.linear.app/graphql', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, variables }),
        }),
      (res) => res.status === 401,
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Linear API error: ${response.status} ${error}`);
      throw new BadRequestException(`Linear API error: ${response.status}`);
    }

    const json = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

    if (json.errors?.length) {
      const msg = json.errors[0].message;
      this.logger.error(`Linear GraphQL error: ${msg}`);
      throw new BadRequestException(`Linear error: ${msg}`);
    }

    return json.data as T;
  }
}
