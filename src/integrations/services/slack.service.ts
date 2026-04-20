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

  /** Send a message to the connected Slack workspace's default channel */
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
      return null;
    }

    try {
      const channel = message.channel || await this.getDefaultChannel(connection.accessToken);

      const response = await fetch('https://slack.com/api/chat.postMessage', {
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

      const data = await response.json() as { ok: boolean; error?: string };

      if (!data.ok) {
        this.logger.error(
          `Slack message failed for org ${organizationId}: ${data.error}`,
        );

        // Mark as expired if token issue
        if (data.error === 'token_expired' || data.error === 'invalid_auth') {
          await this.prisma.integrationConnection.update({
            where: { id: connection.id },
            data: { status: 'EXPIRED' },
          });
        }

        return null;
      }

      return data;
    } catch (error) {
      this.logger.error(
        `Slack send failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /** Get the first public channel the bot is in */
  private async getDefaultChannel(token: string): Promise<string> {
    try {
      const response = await fetch(
        'https://slack.com/api/conversations.list?types=public_channel&limit=1',
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await response.json() as {
        ok: boolean;
        channels?: { id: string }[];
      };

      if (data.ok && data.channels?.[0]) {
        return data.channels[0].id;
      }
    } catch {
      // Fall through
    }
    return 'general';
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
    const token = await this.getConnectionToken(organizationId);

    await fetch('https://slack.com/api/conversations.setTopic', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel: channelId, topic }),
    });

    return { channelId, topic };
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
