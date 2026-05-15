import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SlackService } from './services/slack.service';
import { GoogleDriveService } from './services/google-drive.service';
import { GoogleCalendarService } from './services/google-calendar.service';
import { GmailService } from './services/gmail.service';
import { AsanaService } from './services/asana.service';
import { ConfluenceService } from './services/confluence.service';
import { LinearService } from './services/linear.service';
import { JiraService } from './services/jira.service';
import { NotionService } from './services/notion.service';
import { HubSpotService } from './services/hubspot.service';
import { SalesforceService } from './services/salesforce.service';
import { TokenManager } from './services/token-manager';

@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    TokenManager,
    SlackService,
    GoogleDriveService,
    GoogleCalendarService,
    GmailService,
    AsanaService,
    ConfluenceService,
    LinearService,
    JiraService,
    NotionService,
    HubSpotService,
    SalesforceService,
  ],
  exports: [
    IntegrationsService,
    SlackService,
    GoogleDriveService,
    GoogleCalendarService,
    GmailService,
    AsanaService,
    ConfluenceService,
    LinearService,
    JiraService,
    NotionService,
    HubSpotService,
    SalesforceService,
  ],
})
export class IntegrationsModule {}
