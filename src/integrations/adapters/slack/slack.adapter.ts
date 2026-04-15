import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebClient } from '@slack/web-api';
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
import { SlackValidator } from './slack.validator';
import { LIST_LIMIT } from './slack.constants';

@Injectable()
export class SlackAdapter implements DeploymentAdapter {
  readonly provider = IntegrationProvider.SLACK;
  private readonly logger = new Logger(SlackAdapter.name);

  constructor(private configService: ConfigService) {}

  private getClient(credentials: DecryptedCredentials): WebClient {
    if (!credentials.accessToken) {
      throw new Error('Slack access token not found in credentials');
    }
    return new WebClient(credentials.accessToken);
  }

  // ─── Connection ───────────────────────────────────────

  async testConnection(credentials: DecryptedCredentials): Promise<ConnectionTestResult> {
    try {
      const client = this.getClient(credentials);
      const result = await client.auth.test();

      return {
        success: result.ok ?? false,
        message: result.ok
          ? `Connected to workspace "${result.team}" as ${result.user}`
          : 'Auth test failed',
        metadata: {
          team: result.team,
          teamId: result.team_id,
          user: result.user,
          userId: result.user_id,
          botId: result.bot_id,
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
    const client = this.getClient(credentials);

    switch (type) {
      case 'channels':
        return this.listChannels(client);
      case 'users':
        return this.listUsers(client);
      default:
        throw new Error(`Unknown Slack resource type: ${type}`);
    }
  }

  private async listChannels(client: WebClient): Promise<Resource[]> {
    const result = await client.conversations.list({
      types: 'public_channel',
      limit: LIST_LIMIT,
      exclude_archived: true,
    });

    return (result.channels ?? []).map((ch) => ({
      id: ch.id!,
      type: 'channel',
      name: ch.name ?? '',
      metadata: {
        topic: ch.topic?.value,
        purpose: ch.purpose?.value,
        numMembers: ch.num_members,
        isGeneral: ch.is_general,
      },
    }));
  }

  private async listUsers(client: WebClient): Promise<Resource[]> {
    const result = await client.users.list({ limit: LIST_LIMIT });

    return (result.members ?? [])
      .filter((u) => !u.deleted && !u.is_bot && u.id !== 'USLACKBOT')
      .map((u) => ({
        id: u.id!,
        type: 'user',
        name: u.real_name ?? u.name ?? '',
        metadata: {
          displayName: u.profile?.display_name,
          email: u.profile?.email,
          isAdmin: u.is_admin,
        },
      }));
  }

  // ─── Get Resource ─────────────────────────────────────

  async getResource(credentials: DecryptedCredentials, type: string, id: string): Promise<Resource> {
    const client = this.getClient(credentials);

    switch (type) {
      case 'channel': {
        const result = await client.conversations.info({ channel: id });
        const ch = result.channel!;
        return {
          id: ch.id!,
          type: 'channel',
          name: ch.name ?? '',
          metadata: {
            topic: ch.topic?.value,
            purpose: ch.purpose?.value,
            numMembers: ch.num_members,
          },
        };
      }
      case 'user': {
        const result = await client.users.info({ user: id });
        const u = result.user!;
        return {
          id: u.id!,
          type: 'user',
          name: u.real_name ?? u.name ?? '',
          metadata: {
            displayName: u.profile?.display_name,
            email: u.profile?.email,
          },
        };
      }
      default:
        throw new Error(`Unknown Slack resource type: ${type}`);
    }
  }

  // ─── Dry Run ──────────────────────────────────────────

  async dryRun(credentials: DecryptedCredentials, action: DeploymentAction): Promise<DryRunResult> {
    switch (action.type) {
      case 'create_channel':
        return this.dryRunCreateChannel(credentials, action.params);
      case 'set_topic':
        return this.dryRunSetTopic(credentials, action.params);
      case 'create_webhook':
        return this.dryRunCreateWebhook(credentials, action.params);
      case 'post_message':
        return this.dryRunPostMessage(credentials, action.params);
      case 'invite_users':
        return this.dryRunInviteUsers(credentials, action.params);
      default:
        return { valid: false, preview: '', warnings: [`Unknown action type: ${action.type}`] };
    }
  }

  private async dryRunCreateChannel(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const validation = SlackValidator.validateChannelName(params.name as string);
    if (!validation.valid) {
      return {
        valid: false,
        preview: '',
        warnings: validation.errors,
      };
    }

    // Check for existing channel with same name
    const channels = await this.listResources(credentials, 'channels');
    const existing = channels.filter((ch) => ch.name === validation.sanitized);

    const warnings: string[] = [];
    if (validation.sanitized !== (params.name as string)) {
      warnings.push(`Channel name sanitized from "${params.name}" to "${validation.sanitized}"`);
    }

    return {
      valid: existing.length === 0,
      preview: `Create public channel #${validation.sanitized}${params.topic ? ` with topic: "${params.topic}"` : ''}${params.purpose ? ` — purpose: "${params.purpose}"` : ''}`,
      warnings,
      existingConflicts: existing.length > 0 ? existing : undefined,
    };
  }

  private async dryRunSetTopic(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    try {
      const channel = await this.getResource(credentials, 'channel', params.channelId as string);
      return {
        valid: true,
        preview: `Set topic of #${channel.name} to: "${params.topic}"`,
        warnings: [],
      };
    } catch {
      return { valid: false, preview: '', warnings: ['Channel not found'] };
    }
  }

  private async dryRunCreateWebhook(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    // Webhook URL is granted at OAuth time; check if one exists in credentials
    const webhookUrl = credentials.extra?.incoming_webhook as Record<string, unknown> | undefined;

    if (webhookUrl) {
      return {
        valid: true,
        preview: `Incoming webhook is already configured for this workspace (granted during OAuth)`,
        warnings: [],
      };
    }

    try {
      await this.getResource(credentials, 'channel', params.channelId as string);
      return {
        valid: true,
        preview: `Webhook can be configured for the specified channel. Note: incoming webhooks are granted during OAuth — the existing webhook will be used.`,
        warnings: ['Webhook URL is set during OAuth consent. Re-authorization may be needed to change the target channel.'],
      };
    } catch {
      return { valid: false, preview: '', warnings: ['Channel not found'] };
    }
  }

  private async dryRunPostMessage(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const sanitized = SlackValidator.sanitizeMessage(params.text as string);
    const warnings: string[] = [];

    if (sanitized !== (params.text as string)) {
      warnings.push('Message text was sanitized (control characters removed or text truncated)');
    }

    try {
      const channel = await this.getResource(credentials, 'channel', params.channelId as string);
      return {
        valid: true,
        preview: `Post message to #${channel.name}: "${sanitized.slice(0, 100)}${sanitized.length > 100 ? '...' : ''}"`,
        warnings,
      };
    } catch {
      return { valid: false, preview: '', warnings: ['Channel not found'] };
    }
  }

  private async dryRunInviteUsers(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const userIds = params.userIds as string[];
    if (!userIds || userIds.length === 0) {
      return { valid: false, preview: '', warnings: ['No user IDs provided'] };
    }

    try {
      const channel = await this.getResource(credentials, 'channel', params.channelId as string);
      return {
        valid: true,
        preview: `Invite ${userIds.length} user(s) to #${channel.name}`,
        warnings: [],
      };
    } catch {
      return { valid: false, preview: '', warnings: ['Channel not found'] };
    }
  }

  // ─── Execute ──────────────────────────────────────────

  async execute(credentials: DecryptedCredentials, action: DeploymentAction): Promise<ExecutionResult> {
    switch (action.type) {
      case 'create_channel':
        return this.executeCreateChannel(credentials, action.params);
      case 'set_topic':
        return this.executeSetTopic(credentials, action.params);
      case 'create_webhook':
        return this.executeCreateWebhook(credentials);
      case 'post_message':
        return this.executePostMessage(credentials, action.params);
      case 'invite_users':
        return this.executeInviteUsers(credentials, action.params);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async executeCreateChannel(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const client = this.getClient(credentials);
    const validation = SlackValidator.validateChannelName(params.name as string);

    if (!validation.valid) {
      throw new Error(`Invalid channel name: ${validation.errors.join(', ')}`);
    }

    const result = await client.conversations.create({
      name: validation.sanitized,
      is_private: false,
    });

    const channelId = result.channel!.id!;

    // Set topic if provided
    if (params.topic) {
      await client.conversations.setTopic({
        channel: channelId,
        topic: params.topic as string,
      });
    }

    // Set purpose if provided
    if (params.purpose) {
      await client.conversations.setPurpose({
        channel: channelId,
        purpose: params.purpose as string,
      });
    }

    this.logger.log(`Created Slack channel #${validation.sanitized} (${channelId})`);

    return {
      success: true,
      resourceId: channelId,
      rollbackData: { action: 'create_channel', channelId },
      metadata: { channelName: validation.sanitized },
    };
  }

  private async executeSetTopic(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const client = this.getClient(credentials);
    const channelId = params.channelId as string;

    // Get current topic for rollback
    const channelInfo = await client.conversations.info({ channel: channelId });
    const previousTopic = channelInfo.channel?.topic?.value ?? '';

    await client.conversations.setTopic({
      channel: channelId,
      topic: params.topic as string,
    });

    return {
      success: true,
      resourceId: channelId,
      rollbackData: { action: 'set_topic', channelId, previousTopic },
    };
  }

  private async executeCreateWebhook(
    credentials: DecryptedCredentials,
  ): Promise<ExecutionResult> {
    // Slack incoming webhooks are granted at OAuth consent time.
    // The webhook URL is stored in credentials.extra.incoming_webhook
    const webhook = credentials.extra?.incoming_webhook as Record<string, unknown> | undefined;

    if (!webhook) {
      throw new Error(
        'No incoming webhook found. The Slack app must be re-authorized with the incoming-webhook scope to configure a webhook.',
      );
    }

    return {
      success: true,
      resourceId: webhook.channel_id as string | undefined,
      rollbackData: { action: 'create_webhook' },
      metadata: {
        webhookConfigured: true,
        channel: webhook.channel,
        configurationUrl: webhook.configuration_url,
      },
    };
  }

  private async executePostMessage(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const client = this.getClient(credentials);
    const channelId = params.channelId as string;
    const text = SlackValidator.sanitizeMessage(params.text as string);

    const result = await client.chat.postMessage({
      channel: channelId,
      text,
    });

    return {
      success: true,
      resourceId: result.ts,
      rollbackData: { action: 'post_message', channelId, ts: result.ts },
      metadata: { channelId },
    };
  }

  private async executeInviteUsers(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const client = this.getClient(credentials);
    const channelId = params.channelId as string;
    const userIds = params.userIds as string[];

    await client.conversations.invite({
      channel: channelId,
      users: userIds.join(','),
    });

    return {
      success: true,
      resourceId: channelId,
      rollbackData: { action: 'invite_users', channelId, userIds },
      metadata: { invitedCount: userIds.length },
    };
  }

  // ─── Rollback ─────────────────────────────────────────

  async rollback(
    credentials: DecryptedCredentials,
    _auditLogId: string,
    rollbackData: Record<string, unknown>,
  ): Promise<RollbackResult> {
    const client = this.getClient(credentials);
    const action = rollbackData.action as string;

    switch (action) {
      case 'create_channel': {
        const channelId = rollbackData.channelId as string;
        await client.conversations.archive({ channel: channelId });
        this.logger.log(`Rolled back: archived channel ${channelId}`);
        return { success: true, message: `Archived channel ${channelId}` };
      }

      case 'set_topic': {
        const channelId = rollbackData.channelId as string;
        const previousTopic = rollbackData.previousTopic as string;
        await client.conversations.setTopic({ channel: channelId, topic: previousTopic });
        return { success: true, message: `Restored topic on channel ${channelId}` };
      }

      case 'post_message': {
        const channelId = rollbackData.channelId as string;
        const ts = rollbackData.ts as string;
        await client.chat.delete({ channel: channelId, ts });
        return { success: true, message: `Deleted message ${ts} from channel ${channelId}` };
      }

      case 'invite_users': {
        // Slack doesn't have a "remove from channel" API for bots easily;
        // log a warning instead of failing
        this.logger.warn('Cannot automatically rollback user invitations — manual removal required');
        return { success: false, message: 'User invitation rollback not supported by Slack API' };
      }

      case 'create_webhook': {
        // Webhooks granted at OAuth time cannot be individually revoked
        this.logger.warn('Webhook rollback not applicable — webhook is tied to OAuth grant');
        return { success: false, message: 'Webhook rollback not applicable' };
      }

      default:
        return { success: false, message: `Unknown rollback action: ${action}` };
    }
  }

  // ─── Token Refresh (Slack-specific) ───────────────────

  async refreshToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const clientId = this.configService.get<string>('slack.clientId');
    const clientSecret = this.configService.get<string>('slack.clientSecret');

    if (!clientId || !clientSecret) {
      throw new Error('Slack OAuth credentials not configured');
    }

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Slack token refresh failed: ${data.error}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }
}
