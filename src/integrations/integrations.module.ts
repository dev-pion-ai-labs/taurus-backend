import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SlackService } from './services/slack.service';
import { GoogleDriveService } from './services/google-drive.service';
import { JiraService } from './services/jira.service';
import { NotionService } from './services/notion.service';
import { HubSpotService } from './services/hubspot.service';
import { SalesforceService } from './services/salesforce.service';

@Module({
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    SlackService,
    GoogleDriveService,
    JiraService,
    NotionService,
    HubSpotService,
    SalesforceService,
  ],
  exports: [
    IntegrationsService,
    SlackService,
    GoogleDriveService,
    JiraService,
    NotionService,
    HubSpotService,
    SalesforceService,
  ],
})
export class IntegrationsModule {}
