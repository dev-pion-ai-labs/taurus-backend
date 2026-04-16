import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { SlackService } from './services/slack.service';
import { GoogleDriveService } from './services/google-drive.service';

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationsService, SlackService, GoogleDriveService],
  exports: [IntegrationsService, SlackService, GoogleDriveService],
})
export class IntegrationsModule {}
