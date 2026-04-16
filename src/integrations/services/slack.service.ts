import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

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
  ) {
    return this.sendMessage(organizationId, {
      text: `Deployed: ${actionTitle}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Action Deployed', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Action:*\n${actionTitle}` },
            { type: 'mrkdwn', text: `*Deployed by:*\n${deployedBy}` },
          ],
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
}
