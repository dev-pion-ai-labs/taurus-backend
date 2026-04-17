import { Module } from '@nestjs/common';
import { AiModule } from '../ai';
import { QueueModule } from '../queue';
import { IntegrationsModule } from '../integrations';
import { ImplementationController } from './implementation.controller';
import { ImplementationService } from './implementation.service';

@Module({
  imports: [AiModule, QueueModule, IntegrationsModule],
  controllers: [ImplementationController],
  providers: [ImplementationService],
  exports: [ImplementationService],
})
export class ImplementationModule {}
