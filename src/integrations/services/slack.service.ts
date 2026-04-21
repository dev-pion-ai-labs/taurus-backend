import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import type { PlanExecutionSummary } from '../../implementation/plan-executor.service';

interface SlackMessage {
  channel?: string;
  text: string;
  blocks?: SlackBlock[];
}

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: { type: string; text: string }[];
  fields?: { type: string; text: string }[];
  accessory?: Record<string, unknown>;
}

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Send a message to the connected Slack workspace.
   *
   * Return shape is intentionally aligned with other action methods so the
   * PlanExecutor's {error}-based failure detection can catch problems:
   *   - success: { ok: true, ts, channel }
   *   - failure: { error: string }   (also marks the integration EXPIRED on
   *     token_expired / invalid_auth)
   *
   * Fire-and-forget notify* wrappers don't inspect the return value, so they
   * continue to work unchanged.
   */
  async sendMessage(organizationId: string, message: SlackMessage) {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: 'SLACK' },
      },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      this.logger.debug(
        `Slack not connected for org ${organizationId}, skipping notification`,
      );
      return { error: 'Slack is not connected for this organization' };
    }

    try {
      const channel = message.channel || await this.getDefaultChannel(connection.accessToken);
      if (!channel) {
        this.logger.error(
          `Slack message failed for org ${organizationId}: no channel the bot is a member of`,
        );
        return {
          error:
            'Slack bot is not a member of any channel — invite it with /invite @<bot> in the target channel or add the chat:write.public scope.',
        };
      }

      const post = async () =>
        fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${connection.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel,
            text: message.text,
            blocks: message.blocks,
          }),
        });

      let response = await post();
      let data = await response.json() as {
        ok: boolean;
        error?: string;
        ts?: string;
        channel?: string;
      };

      // If the bot isn't in the channel, try to join it and retry once.
      // Requires channels:join scope; if it's missing we fall through to the
      // normal error path with a clearer hint.
      if (!data.ok && data.error === 'not_in_channel') {
        const joined = await this.tryJoinChannel(connection.accessToken, channel);
        if (joined) {
          response = await post();
          data = await response.json() as typeof data;
        }
      }

      if (!data.ok) {
        const hint =
          data.error === 'not_in_channel'
            ? ` — invite the bot with "/invite @<bot>" in that channel, or add the chat:write.public scope`
            : '';
        this.logger.error(
          `Slack message failed for org ${organizationId}: ${data.error}${hint}`,
        );

        // Mark as expired if token issue
        if (data.error === 'token_expired' || data.error === 'invalid_auth') {
          await this.prisma.integrationConnection.update({
            where: { id: connection.id },
            data: { status: 'EXPIRED' },
          });
        }

        return { error: data.error || 'Slack API returned ok=false' };
      }

      return { ok: true, ts: data.ts, channel: data.channel };
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`Slack send failed: ${msg}`);
      return { error: msg };
    }
  }

  /** Get the id of the first public channel the bot is actually a member of. */
  private async getDefaultChannel(token: string): Promise<string | null> {
    try {
      const response = await fetch(
        'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200',
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await response.json() as {
        ok: boolean;
        channels?: { id: string; name: string; is_member?: boolean }[];
      };

      if (!data.ok || !data.channels) return null;

      const memberChannel = data.channels.find((c) => c.is_member);
      if (memberChannel) return memberChannel.id;

      // No membership anywhere. Try to join #general as a last resort.
      const general = data.channels.find((c) => c.name === 'general');
      if (general && (await this.tryJoinChannel(token, general.id))) {
        return general.id;
      }
    } catch {
      // Fall through
    }
    return null;
  }

  /** Best-effort conversations.join; returns true on success. */
  private async tryJoinChannel(token: string, channelId: string): Promise<boolean> {
    try {
      const response = await fetch('https://slack.com/api/conversations.join', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: channelId }),
      });
      const data = await response.json() as { ok: boolean; error?: string };
      if (!data.ok) {
        this.logger.debug(`Slack conversations.join(${channelId}) failed: ${data.error}`);
      }
      return data.ok;
    } catch {
      return false;
    }
  }

  // ── Action Methods ─────────────────────────────────────

  /** Create a Slack channel */
  async createChannel(organizationId: string, name: string, isPrivate = false) {
    const token = await this.getConnectionToken(organizationId);

    const response = await fetch('https://slack.com/api/conversations.create', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-_]/g, '-'), is_private: isPrivate }),
    });

    const data = await response.json() as { ok: boolean; channel?: { id: string; name: string }; error?: string };
    if (!data.ok) {
      this.logger.error(`Failed to create channel: ${data.error}`);
      if (data.error === 'name_taken') return { channelId: null, error: 'Channel name already taken' };
      return { channelId: null, error: data.error };
    }

    this.logger.log(`Created Slack channel #${data.channel!.name} for org ${organizationId}`);
    return { channelId: data.channel!.id, name: data.channel!.name };
  }

  /** Invite users to a channel */
  async inviteToChannel(organizationId: string, channelId: string, userIds: string[]) {
    const token = await this.getConnectionToken(organizationId);

    const response = await fetch('https://slack.com/api/conversations.invite', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, users: userIds.join(',') }),
    });

    const data = await response.json() as { ok: boolean; error?: string };
    return { ok: data.ok, error: data.error };
  }

  /** Set channel topic */
  async setChannelTopic(organizationId: string, channelId: string, topic: string) {
    let token: string;
    try {
      token = await this.getConnectionToken(organizationId);
    } catch (error) {
      return { error: (error as Error).message };
    }

    try {
      const response = await fetch(
        'https://slack.com/api/conversations.setTopic',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ channel: channelId, topic }),
        },
      );

      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        this.logger.error(
          `Slack setChannelTopic failed for ${channelId}: ${data.error}`,
        );
        return { error: data.error || 'Slack API returned ok=false' };
      }

      return { channelId, topic };
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`Slack setChannelTopic failed: ${msg}`);
      return { error: msg };
    }
  }

  /** List workspace users */
  async listUsers(organizationId: string) {
    const token = await this.getConnectionToken(organizationId);

    const response = await fetch('https://slack.com/api/users.list?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json() as {
      ok: boolean;
      members?: { id: string; name: string; real_name: string; profile: { email?: string } }[];
    };

    if (!data.ok || !data.members) return [];

    return data.members
      .filter((m) => !m.name.includes('bot') && m.id !== 'USLACKBOT')
      .map((m) => ({ id: m.id, name: m.real_name, email: m.profile.email }));
  }

  /** List channels */
  async listChannels(organizationId: string) {
    const token = await this.getConnectionToken(organizationId);

    const response = await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel&limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await response.json() as {
      ok: boolean;
      channels?: { id: string; name: string; is_private: boolean; num_members: number }[];
    };

    if (!data.ok || !data.channels) return [];
    return data.channels.map((c) => ({ id: c.id, name: c.name, isPrivate: c.is_private, members: c.num_members }));
  }

  private async getConnectionToken(organizationId: string): Promise<string> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'SLACK' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new Error('Slack is not connected');
    }

    return connection.accessToken;
  }

  // ── Pre-built notification templates ───────────────────

  async notifyPlanReady(
    organizationId: string,
    planTitle: string,
    actionTitle: string,
    stepsCount: number,
  ) {
    return this.sendMessage(organizationId, {
      text: `Deployment plan ready: ${planTitle}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Deployment Plan Ready', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Plan:*\n${planTitle}` },
            { type: 'mrkdwn', text: `*Action:*\n${actionTitle}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `The AI has generated a ${stepsCount}-step deployment plan. Review and approve it in the Implementation Engine.`,
          },
        },
      ],
    });
  }

  async notifyArtifactsReady(
    organizationId: string,
    planTitle: string,
    artifactCount: number,
  ) {
    return this.sendMessage(organizationId, {
      text: `${artifactCount} deployment artifacts generated for: ${planTitle}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Artifacts Generated', emoji: true },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${planTitle}*\n${artifactCount} artifact(s) are ready — including implementation guide and integration checklist. Complete the checklist to deploy.`,
          },
        },
      ],
    });
  }

  async notifyExecutionStarted(
    organizationId: string,
    actionTitle: string,
    stepCount: number,
  ) {
    return this.sendMessage(organizationId, {
      text: `Deploying: ${actionTitle}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Deployment Started', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Action:*\n${actionTitle}` },
            {
              type: 'mrkdwn',
              text: `*Steps to run:*\n${stepCount}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'Taurus is executing the deployment plan now. You\'ll get a final summary when it finishes.',
          },
        },
      ],
    });
  }

  async notifyDeployed(
    organizationId: string,
    actionTitle: string,
    deployedBy: string,
    summary?: PlanExecutionSummary,
  ) {
    const hasFailures = summary && (summary.failed > 0 || summary.skipped > 0);
    const header = hasFailures ? 'Action Deployed (partial)' : 'Action Deployed';
    const title = hasFailures ? `Partially deployed: ${actionTitle}` : `Deployed: ${actionTitle}`;

    const fields: SlackBlock['fields'] = [
      { type: 'mrkdwn', text: `*Action:*\n${actionTitle}` },
      { type: 'mrkdwn', text: `*Deployed by:*\n${deployedBy}` },
    ];

    if (summary && summary.total > 0) {
      const parts = [`${summary.completed}/${summary.total} completed`];
      if (summary.failed > 0) parts.push(`${summary.failed} failed`);
      if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`);
      fields.push({ type: 'mrkdwn', text: `*Steps:*\n${parts.join(', ')}` });
    }

    return this.sendMessage(organizationId, {
      text: title,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: header, emoji: true },
        },
        {
          type: 'section',
          fields,
        },
      ],
    });
  }

  async notifyReportReady(
    organizationId: string,
    score: number,
    maturityLevel: string,
    totalValue: number,
  ) {
    const formattedValue = totalValue >= 1000
      ? `$${(totalValue / 1000).toFixed(0)}K`
      : `$${totalValue.toFixed(0)}`;

    return this.sendMessage(organizationId, {
      text: `Transformation Report ready — Score: ${score}/100`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Transformation Report Ready', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*AI Maturity Score:*\n${score}/100` },
            { type: 'mrkdwn', text: `*Maturity Level:*\n${maturityLevel}` },
          ],
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Total Value Identified:*\n${formattedValue}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'View the full report and import recommendations to the Tracker.',
          },
        },
      ],
    });
  }

  async notifyActionStatusChange(
    organizationId: string,
    actionTitle: string,
    oldStatus: string,
    newStatus: string,
  ) {
    return this.sendMessage(organizationId, {
      text: `Action "${actionTitle}" moved from ${oldStatus} to ${newStatus}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${actionTitle}*\n\`${oldStatus}\` → \`${newStatus}\``,
          },
        },
      ],
    });
  }

  async notifySprintCompleted(
    organizationId: string,
    sprintName: string,
    actionsCompleted: number,
  ) {
    return this.sendMessage(organizationId, {
      text: `Sprint completed: ${sprintName}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Sprint Completed', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Sprint:*\n${sprintName}` },
            { type: 'mrkdwn', text: `*Actions delivered:*\n${actionsCompleted}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'All actions in this sprint have been deployed or verified. Review outcomes in the Tracker.',
          },
        },
      ],
    });
  }
}
