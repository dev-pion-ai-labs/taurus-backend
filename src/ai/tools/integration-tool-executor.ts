import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { SlackService } from '../../integrations/services/slack.service';
import { GoogleDriveService } from '../../integrations/services/google-drive.service';
import { JiraService } from '../../integrations/services/jira.service';
import { NotionService } from '../../integrations/services/notion.service';
import { HubSpotService } from '../../integrations/services/hubspot.service';
import { SalesforceService } from '../../integrations/services/salesforce.service';

@Injectable()
export class IntegrationToolExecutor {
  private readonly logger = new Logger(IntegrationToolExecutor.name);

  constructor(
    private prisma: PrismaService,
    private slack: SlackService,
    private gdrive: GoogleDriveService,
    private jira: JiraService,
    private notion: NotionService,
    private hubspot: HubSpotService,
    private salesforce: SalesforceService,
  ) {}

  /** Returns true if this executor handles the given tool name */
  canHandle(toolName: string): boolean {
    return toolName.startsWith('slack_')
      || toolName.startsWith('gdrive_')
      || toolName.startsWith('jira_')
      || toolName.startsWith('notion_')
      || toolName.startsWith('hubspot_')
      || toolName.startsWith('salesforce_')
      || toolName === 'get_connected_integrations';
  }

  async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    organizationId: string,
  ): Promise<unknown> {
    this.logger.log(`Executing integration tool: ${toolName}`);

    try {
      switch (toolName) {
        // ── Meta ─────────────────────────────────────────
        case 'get_connected_integrations':
          return this.getConnectedIntegrations(organizationId);

        // ── Slack ────────────────────────────────────────
        case 'slack_create_channel':
          return this.slack.createChannel(
            organizationId,
            input.name as string,
            (input.isPrivate as boolean) ?? false,
          );
        case 'slack_send_message':
          return this.slack.sendMessage(organizationId, {
            channel: input.channel as string | undefined,
            text: input.text as string,
          });
        case 'slack_set_channel_topic':
          return this.slack.setChannelTopic(
            organizationId,
            input.channelId as string,
            input.topic as string,
          );
        case 'slack_list_channels':
          return this.slack.listChannels(organizationId);
        case 'slack_list_users':
          return this.slack.listUsers(organizationId);

        // ── Google Drive ─────────────────────────────────
        case 'gdrive_create_document':
          return this.gdrive.exportDocument(
            organizationId,
            input.title as string,
            input.content as string,
          );

        // ── Jira ─────────────────────────────────────────
        case 'jira_create_issue':
          return this.jira.createIssue(organizationId, {
            projectKey: input.projectKey as string,
            summary: input.summary as string,
            description: input.description as string | undefined,
            issueType: input.issueType as string | undefined,
            priority: input.priority as string | undefined,
            labels: input.labels as string[] | undefined,
          });
        case 'jira_transition_issue':
          return this.jira.transitionIssue(
            organizationId,
            input.issueKey as string,
            input.targetStatus as string,
          );
        case 'jira_add_comment':
          return this.jira.addComment(
            organizationId,
            input.issueKey as string,
            input.text as string,
          );
        case 'jira_list_projects':
          return this.jira.listProjects(organizationId);

        // ── Notion ───────────────────────────────────────
        case 'notion_create_page':
          return this.notion.createPage(organizationId, {
            title: input.title as string,
            content: input.content as string | undefined,
            parentPageId: input.parentPageId as string | undefined,
          });
        case 'notion_create_database':
          return this.notion.createDatabase(organizationId, {
            parentPageId: input.parentPageId as string,
            title: input.title as string,
            properties: input.columns as Record<string, { type: string; options?: string[] }>,
          });
        case 'notion_search':
          return this.notion.search(organizationId, input.query as string);

        // ── HubSpot ──────────────────────────────────────
        case 'hubspot_create_contact':
          return this.hubspot.createContact(organizationId, {
            email: input.email as string,
            firstName: input.firstName as string | undefined,
            lastName: input.lastName as string | undefined,
            company: input.company as string | undefined,
            jobTitle: input.jobTitle as string | undefined,
          });
        case 'hubspot_create_deal':
          return this.hubspot.createDeal(organizationId, {
            name: input.name as string,
            stage: input.stage as string | undefined,
            amount: input.amount as number | undefined,
            pipeline: input.pipeline as string | undefined,
          });
        case 'hubspot_list_pipelines':
          return this.hubspot.listPipelines(organizationId);

        // ── Salesforce ───────────────────────────────────
        case 'salesforce_create_record':
          return this.salesforce.createRecord(
            organizationId,
            input.objectType as string,
            input.fields as Record<string, unknown>,
          );
        case 'salesforce_query':
          return this.salesforce.query(organizationId, input.soql as string);

        default:
          return { error: `Unknown integration tool: ${toolName}` };
      }
    } catch (error) {
      const msg = (error as Error).message;
      this.logger.error(`Integration tool ${toolName} failed: ${msg}`);
      return { error: msg };
    }
  }

  private async getConnectedIntegrations(organizationId: string) {
    const connections = await this.prisma.integrationConnection.findMany({
      where: { organizationId, status: 'CONNECTED' },
      select: { provider: true, externalTeamName: true },
    });

    return {
      connected: connections.map((c) => ({
        provider: c.provider,
        teamName: c.externalTeamName,
      })),
      availableTools: connections.flatMap((c) => {
        switch (c.provider) {
          case 'SLACK':
            return ['slack_create_channel', 'slack_send_message', 'slack_set_channel_topic', 'slack_list_channels', 'slack_list_users'];
          case 'GOOGLE_DRIVE':
            return ['gdrive_create_document'];
          case 'JIRA':
            return ['jira_create_issue', 'jira_transition_issue', 'jira_add_comment', 'jira_list_projects'];
          case 'NOTION':
            return ['notion_create_page', 'notion_create_database', 'notion_search'];
          case 'HUBSPOT':
            return ['hubspot_create_contact', 'hubspot_create_deal', 'hubspot_list_pipelines'];
          case 'SALESFORCE':
            return ['salesforce_create_record', 'salesforce_query'];
          default:
            return [];
        }
      }),
    };
  }
}
