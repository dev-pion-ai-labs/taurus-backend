import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { TokenManager, RefreshResult } from './token-manager';

const ASANA_API = 'https://app.asana.com/api/1.0';

@Injectable()
export class AsanaService implements OnModuleInit {
  private readonly logger = new Logger(AsanaService.name);

  constructor(
    private prisma: PrismaService,
    private tokenManager: TokenManager,
  ) {}

  onModuleInit() {
    this.tokenManager.registerStrategy('ASANA', async (refreshToken) => {
      const response = await fetch('https://app.asana.com/-/oauth_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.ASANA_CLIENT_ID || '',
          client_secret: process.env.ASANA_CLIENT_SECRET || '',
          refresh_token: refreshToken,
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

  // ── Core Actions ───────────────────────────────────────

  async createTask(
    organizationId: string,
    opts: {
      workspaceId?: string;
      projectId?: string;
      name: string;
      notes?: string;
      assigneeId?: string;
      dueOn?: string;
    },
  ) {
    if (!opts.workspaceId && !opts.projectId) {
      throw new BadRequestException('Either workspaceId or projectId is required to create a task');
    }

    const body: Record<string, unknown> = { name: opts.name };
    if (opts.workspaceId) body.workspace = opts.workspaceId;
    if (opts.projectId) body.projects = [opts.projectId];
    if (opts.notes) body.notes = opts.notes;
    if (opts.assigneeId) body.assignee = opts.assigneeId;
    if (opts.dueOn) body.due_on = opts.dueOn;

    const response = await this.callAsana(organizationId, 'POST', '/tasks', { data: body });
    this.logger.log(`Created Asana task "${opts.name}" for org ${organizationId}`);
    return {
      id: response.data.gid,
      name: response.data.name,
      permalink: response.data.permalink_url,
    };
  }

  async updateTask(
    organizationId: string,
    taskId: string,
    opts: {
      name?: string;
      notes?: string;
      completed?: boolean;
      assigneeId?: string;
      dueOn?: string;
    },
  ) {
    const body: Record<string, unknown> = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.notes !== undefined) body.notes = opts.notes;
    if (opts.completed !== undefined) body.completed = opts.completed;
    if (opts.assigneeId !== undefined) body.assignee = opts.assigneeId;
    if (opts.dueOn !== undefined) body.due_on = opts.dueOn;

    const response = await this.callAsana(organizationId, 'PUT', `/tasks/${taskId}`, { data: body });
    return {
      id: response.data.gid,
      name: response.data.name,
      completed: response.data.completed,
      permalink: response.data.permalink_url,
    };
  }

  async listTasks(
    organizationId: string,
    opts: { projectId?: string; assigneeId?: string; workspaceId?: string; limit?: number } = {},
  ) {
    const params = new URLSearchParams({
      opt_fields: 'gid,name,completed,due_on,assignee.name,permalink_url',
      limit: String(opts.limit ?? 25),
    });

    let path: string;
    if (opts.projectId) {
      path = `/projects/${opts.projectId}/tasks?${params.toString()}`;
    } else if (opts.assigneeId && opts.workspaceId) {
      params.set('assignee', opts.assigneeId);
      params.set('workspace', opts.workspaceId);
      path = `/tasks?${params.toString()}`;
    } else {
      throw new BadRequestException('Provide projectId or both assigneeId and workspaceId');
    }

    const response = await this.callAsana(organizationId, 'GET', path);
    return (response.data ?? []).map(
      (t: { gid: string; name: string; completed: boolean; due_on: string | null; assignee: { name: string } | null; permalink_url: string }) => ({
        id: t.gid,
        name: t.name,
        completed: t.completed,
        dueOn: t.due_on,
        assignee: t.assignee?.name ?? null,
        permalink: t.permalink_url,
      }),
    );
  }

  async listProjects(organizationId: string, workspaceId?: string) {
    const params = new URLSearchParams({
      opt_fields: 'gid,name,color,archived',
      limit: '50',
    });
    if (workspaceId) params.set('workspace', workspaceId);

    const response = await this.callAsana(organizationId, 'GET', `/projects?${params.toString()}`);
    return (response.data ?? []).map(
      (p: { gid: string; name: string; color: string; archived: boolean }) => ({
        id: p.gid,
        name: p.name,
        color: p.color,
        archived: p.archived,
      }),
    );
  }

  async addComment(organizationId: string, taskId: string, text: string) {
    const response = await this.callAsana(
      organizationId,
      'POST',
      `/tasks/${taskId}/stories`,
      { data: { text } },
    );
    return { id: response.data.gid };
  }

  async listWorkspaces(organizationId: string) {
    const response = await this.callAsana(organizationId, 'GET', '/workspaces');
    return (response.data ?? []).map((w: { gid: string; name: string }) => ({
      id: w.gid,
      name: w.name,
    }));
  }

  // ── Connection + Request ───────────────────────────────

  private async callAsana(
    organizationId: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'ASANA' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('Asana is not connected');
    }

    const response = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch(`${ASANA_API}${path}`, {
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
      this.logger.error(`Asana API error (${method} ${path}): ${response.status} ${error}`);
      throw new BadRequestException(`Asana API error: ${response.status}`);
    }

    if (response.status === 204) return {};
    return response.json();
  }
}
