import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { IntegrationProvider } from '@prisma/client';
import { DeploymentAdapter } from '../base.adapter';
import {
  DecryptedCredentials,
  ConnectionTestResult,
  Resource,
  DeploymentAction,
  DryRunResult,
  ExecutionResult,
  RollbackResult,
} from '../types';
import { GitHubValidator } from './github.validator';
import { LIST_PER_PAGE } from './github.constants';

@Injectable()
export class GitHubAdapter implements DeploymentAdapter {
  readonly provider = IntegrationProvider.GITHUB;
  private readonly logger = new Logger(GitHubAdapter.name);

  constructor(private configService: ConfigService) {}

  private getClient(credentials: DecryptedCredentials): Octokit {
    if (!credentials.accessToken) {
      throw new Error('GitHub access token not found in credentials');
    }
    return new Octokit({ auth: credentials.accessToken });
  }

  // ─── Connection ───────────────────────────────────────

  async testConnection(credentials: DecryptedCredentials): Promise<ConnectionTestResult> {
    try {
      const octokit = this.getClient(credentials);
      const { data: user } = await octokit.users.getAuthenticated();

      return {
        success: true,
        message: `Connected as ${user.login}`,
        metadata: {
          login: user.login,
          name: user.name,
          avatarUrl: user.avatar_url,
          type: user.type,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${(error as Error).message}`,
      };
    }
  }

  // ─── List Resources ───────────────────────────────────

  async listResources(credentials: DecryptedCredentials, type: string): Promise<Resource[]> {
    const octokit = this.getClient(credentials);

    switch (type) {
      case 'repos':
        return this.listRepos(octokit);
      case 'workflows':
        throw new Error('Use getResource("workflows", "owner/repo") to list workflows for a specific repo');
      default:
        throw new Error(`Unknown GitHub resource type: ${type}`);
    }
  }

  private async listRepos(octokit: Octokit): Promise<Resource[]> {
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      per_page: LIST_PER_PAGE,
      sort: 'updated',
      direction: 'desc',
    });

    return repos.map((repo) => ({
      id: repo.full_name,
      type: 'repo',
      name: repo.full_name,
      metadata: {
        description: repo.description,
        private: repo.private,
        defaultBranch: repo.default_branch,
        language: repo.language,
        updatedAt: repo.updated_at,
      },
    }));
  }

  // ─── Get Resource ─────────────────────────────────────

  async getResource(credentials: DecryptedCredentials, type: string, id: string): Promise<Resource> {
    const octokit = this.getClient(credentials);

    switch (type) {
      case 'repo': {
        const parsed = GitHubValidator.validateRepoFullName(id);
        if (!parsed.valid) throw new Error(parsed.errors.join(', '));

        const { data: repo } = await octokit.repos.get({
          owner: parsed.owner,
          repo: parsed.repo,
        });
        return {
          id: repo.full_name,
          type: 'repo',
          name: repo.full_name,
          metadata: {
            description: repo.description,
            private: repo.private,
            defaultBranch: repo.default_branch,
          },
        };
      }
      case 'workflows': {
        // id = "owner/repo" — list all workflows in that repo
        const parsed = GitHubValidator.validateRepoFullName(id);
        if (!parsed.valid) throw new Error(parsed.errors.join(', '));

        const { data } = await octokit.actions.listRepoWorkflows({
          owner: parsed.owner,
          repo: parsed.repo,
          per_page: LIST_PER_PAGE,
        });

        // Return the first as a single resource (for interface compat), or use listWorkflows
        const workflows = data.workflows;
        if (workflows.length === 0) {
          throw new Error(`No workflows found in ${id}`);
        }
        return {
          id: String(workflows[0].id),
          type: 'workflow',
          name: workflows[0].name,
          metadata: { path: workflows[0].path, state: workflows[0].state },
        };
      }
      default:
        throw new Error(`Unknown GitHub resource type: ${type}`);
    }
  }

  /** List all workflows in a repo (convenience method used by tools) */
  async listWorkflows(credentials: DecryptedCredentials, repoFullName: string): Promise<Resource[]> {
    const octokit = this.getClient(credentials);
    const parsed = GitHubValidator.validateRepoFullName(repoFullName);
    if (!parsed.valid) throw new Error(parsed.errors.join(', '));

    const { data } = await octokit.actions.listRepoWorkflows({
      owner: parsed.owner,
      repo: parsed.repo,
      per_page: LIST_PER_PAGE,
    });

    return data.workflows.map((wf) => ({
      id: String(wf.id),
      type: 'workflow',
      name: wf.name,
      metadata: { path: wf.path, state: wf.state },
    }));
  }

  /** List secret names in a repo (convenience method used by tools) */
  async listSecrets(credentials: DecryptedCredentials, repoFullName: string): Promise<Resource[]> {
    const octokit = this.getClient(credentials);
    const parsed = GitHubValidator.validateRepoFullName(repoFullName);
    if (!parsed.valid) throw new Error(parsed.errors.join(', '));

    const { data } = await octokit.actions.listRepoSecrets({
      owner: parsed.owner,
      repo: parsed.repo,
      per_page: LIST_PER_PAGE,
    });

    return data.secrets.map((s) => ({
      id: s.name,
      type: 'secret',
      name: s.name,
      metadata: { createdAt: s.created_at, updatedAt: s.updated_at },
    }));
  }

  // ─── Dry Run ──────────────────────────────────────────

  async dryRun(credentials: DecryptedCredentials, action: DeploymentAction): Promise<DryRunResult> {
    switch (action.type) {
      case 'create_workflow':
        return this.dryRunCreateWorkflow(credentials, action.params);
      case 'create_webhook':
        return this.dryRunCreateWebhook(credentials, action.params);
      case 'trigger_workflow':
        return this.dryRunTriggerWorkflow(credentials, action.params);
      default:
        return { valid: false, preview: '', warnings: [`Unknown action type: ${action.type}`] };
    }
  }

  private async dryRunCreateWorkflow(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const repoFullName = params.repo as string;
    const filename = params.filename as string;
    const content = params.content as string;

    const repoParsed = GitHubValidator.validateRepoFullName(repoFullName);
    if (!repoParsed.valid) {
      return { valid: false, preview: '', warnings: repoParsed.errors };
    }

    const fileValidation = GitHubValidator.validateWorkflowFilename(filename);
    if (!fileValidation.valid) {
      return { valid: false, preview: '', warnings: fileValidation.errors };
    }

    const yamlValidation = GitHubValidator.validateWorkflowYaml(content);
    if (!yamlValidation.valid) {
      return { valid: false, preview: '', warnings: yamlValidation.errors };
    }

    // Check if file already exists
    const octokit = this.getClient(credentials);
    const filePath = `.github/workflows/${fileValidation.sanitized}`;
    const warnings: string[] = [];

    try {
      await octokit.repos.getContent({
        owner: repoParsed.owner,
        repo: repoParsed.repo,
        path: filePath,
      });
      return {
        valid: false,
        preview: '',
        warnings: [`Workflow file "${filePath}" already exists in ${repoFullName}`],
        existingConflicts: [{ id: filePath, type: 'file', name: filePath }],
      };
    } catch {
      // File doesn't exist — good
    }

    if (fileValidation.sanitized !== filename) {
      warnings.push(`Filename sanitized from "${filename}" to "${fileValidation.sanitized}"`);
    }

    return {
      valid: true,
      preview: `Create workflow file "${filePath}" in ${repoFullName}`,
      warnings,
    };
  }

  private async dryRunCreateWebhook(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const repoFullName = params.repo as string;
    const repoParsed = GitHubValidator.validateRepoFullName(repoFullName);
    if (!repoParsed.valid) {
      return { valid: false, preview: '', warnings: repoParsed.errors };
    }

    const url = params.url as string;
    if (!url) {
      return { valid: false, preview: '', warnings: ['Webhook URL is required'] };
    }

    // Check for existing webhooks with same URL
    const octokit = this.getClient(credentials);
    const { data: hooks } = await octokit.repos.listWebhooks({
      owner: repoParsed.owner,
      repo: repoParsed.repo,
    });

    const existing = hooks.filter((h) => h.config.url === url);
    if (existing.length > 0) {
      return {
        valid: false,
        preview: '',
        warnings: ['A webhook with this URL already exists on this repo'],
        existingConflicts: existing.map((h) => ({
          id: String(h.id),
          type: 'webhook',
          name: h.config.url ?? 'unknown',
        })),
      };
    }

    const events = (params.events as string[]) ?? ['push'];
    return {
      valid: true,
      preview: `Create webhook on ${repoFullName} for events: ${events.join(', ')} → ${url}`,
      warnings: [],
    };
  }

  private async dryRunTriggerWorkflow(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const repoFullName = params.repo as string;
    const workflowId = params.workflowId as string;

    const repoParsed = GitHubValidator.validateRepoFullName(repoFullName);
    if (!repoParsed.valid) {
      return { valid: false, preview: '', warnings: repoParsed.errors };
    }

    if (!workflowId) {
      return { valid: false, preview: '', warnings: ['Workflow ID is required'] };
    }

    return {
      valid: true,
      preview: `Trigger workflow ${workflowId} on ${repoFullName}`,
      warnings: [],
    };
  }

  // ─── Execute ──────────────────────────────────────────

  async execute(credentials: DecryptedCredentials, action: DeploymentAction): Promise<ExecutionResult> {
    switch (action.type) {
      case 'create_workflow':
        return this.executeCreateWorkflow(credentials, action.params);
      case 'create_webhook':
        return this.executeCreateWebhook(credentials, action.params);
      case 'trigger_workflow':
        return this.executeTriggerWorkflow(credentials, action.params);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async executeCreateWorkflow(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const octokit = this.getClient(credentials);
    const repoFullName = params.repo as string;
    const content = params.content as string;
    const commitMessage = (params.commitMessage as string) ?? 'Add workflow via Taurus deployment agent';

    const repoParsed = GitHubValidator.validateRepoFullName(repoFullName);
    if (!repoParsed.valid) throw new Error(repoParsed.errors.join(', '));

    const fileValidation = GitHubValidator.validateWorkflowFilename(params.filename as string);
    if (!fileValidation.valid) throw new Error(fileValidation.errors.join(', '));

    const yamlValidation = GitHubValidator.validateWorkflowYaml(content);
    if (!yamlValidation.valid) throw new Error(yamlValidation.errors.join(', '));

    const filePath = `.github/workflows/${fileValidation.sanitized}`;

    const { data } = await octokit.repos.createOrUpdateFileContents({
      owner: repoParsed.owner,
      repo: repoParsed.repo,
      path: filePath,
      message: commitMessage,
      content: Buffer.from(content).toString('base64'),
    });

    this.logger.log(`Created workflow ${filePath} in ${repoFullName}`);

    return {
      success: true,
      resourceId: data.content?.sha,
      resourceUrl: data.content?.html_url ?? undefined,
      rollbackData: {
        action: 'create_workflow',
        owner: repoParsed.owner,
        repo: repoParsed.repo,
        path: filePath,
        sha: data.content?.sha,
      },
    };
  }

  private async executeCreateWebhook(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const octokit = this.getClient(credentials);
    const repoFullName = params.repo as string;
    const url = params.url as string;
    const events = (params.events as string[]) ?? ['push'];
    const secret = params.secret as string | undefined;

    const repoParsed = GitHubValidator.validateRepoFullName(repoFullName);
    if (!repoParsed.valid) throw new Error(repoParsed.errors.join(', '));

    const { data: hook } = await octokit.repos.createWebhook({
      owner: repoParsed.owner,
      repo: repoParsed.repo,
      config: {
        url,
        content_type: 'json',
        secret,
      },
      events,
      active: true,
    });

    this.logger.log(`Created webhook ${hook.id} on ${repoFullName}`);

    return {
      success: true,
      resourceId: String(hook.id),
      rollbackData: {
        action: 'create_webhook',
        owner: repoParsed.owner,
        repo: repoParsed.repo,
        hookId: hook.id,
      },
    };
  }

  private async executeTriggerWorkflow(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const octokit = this.getClient(credentials);
    const repoFullName = params.repo as string;
    const workflowId = params.workflowId as string;
    const ref = (params.ref as string) ?? 'main';

    const repoParsed = GitHubValidator.validateRepoFullName(repoFullName);
    if (!repoParsed.valid) throw new Error(repoParsed.errors.join(', '));

    await octokit.actions.createWorkflowDispatch({
      owner: repoParsed.owner,
      repo: repoParsed.repo,
      workflow_id: workflowId,
      ref,
      inputs: (params.inputs as Record<string, string>) ?? {},
    });

    this.logger.log(`Triggered workflow ${workflowId} on ${repoFullName}`);

    return {
      success: true,
      resourceId: workflowId,
      rollbackData: { action: 'trigger_workflow' },
      metadata: { ref },
    };
  }

  // ─── Rollback ─────────────────────────────────────────

  async rollback(
    credentials: DecryptedCredentials,
    _auditLogId: string,
    rollbackData: Record<string, unknown>,
  ): Promise<RollbackResult> {
    const octokit = this.getClient(credentials);
    const action = rollbackData.action as string;

    switch (action) {
      case 'create_workflow': {
        const owner = rollbackData.owner as string;
        const repo = rollbackData.repo as string;
        const path = rollbackData.path as string;
        const sha = rollbackData.sha as string;

        await octokit.repos.deleteFile({
          owner,
          repo,
          path,
          message: 'Rollback: remove workflow created by Taurus deployment agent',
          sha,
        });

        this.logger.log(`Rolled back: deleted ${path} from ${owner}/${repo}`);
        return { success: true, message: `Deleted workflow file ${path}` };
      }

      case 'create_webhook': {
        const owner = rollbackData.owner as string;
        const repo = rollbackData.repo as string;
        const hookId = rollbackData.hookId as number;

        await octokit.repos.deleteWebhook({ owner, repo, hook_id: hookId });

        this.logger.log(`Rolled back: deleted webhook ${hookId} from ${owner}/${repo}`);
        return { success: true, message: `Deleted webhook ${hookId}` };
      }

      case 'trigger_workflow': {
        this.logger.warn('Cannot rollback a triggered workflow dispatch');
        return { success: false, message: 'Workflow dispatch cannot be undone' };
      }

      default:
        return { success: false, message: `Unknown rollback action: ${action}` };
    }
  }

  // ─── Token Refresh (GitHub-specific) ──────────────────

  async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const clientId = this.configService.get<string>('github.clientId');
    const clientSecret = this.configService.get<string>('github.clientSecret');

    if (!clientId || !clientSecret) {
      throw new Error('GitHub OAuth credentials not configured');
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`GitHub token refresh failed: ${data.error_description || data.error}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }
}
