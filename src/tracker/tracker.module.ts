import { Module } from '@nestjs/common';
import { TrackerController } from './tracker.controller';
import { TrackerService } from './tracker.service';
import { AiModule } from '../ai';
import { IntegrationsModule } from '../integrations';

@Module({
  imports: [AiModule, IntegrationsModule],
  controllers: [TrackerController],
  providers: [TrackerService],
  exports: [TrackerService],
})
export class TrackerModule {}
