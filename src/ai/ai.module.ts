import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations';
import { AiService } from './ai.service';
import { ImplementationAiService } from './implementation-ai.service';
import { ImplementationToolExecutor } from './tools/implementation-tool-executor';
import { IntegrationToolExecutor } from './tools/integration-tool-executor';

@Module({
  imports: [IntegrationsModule],
  providers: [
    AiService,
    ImplementationAiService,
    ImplementationToolExecutor,
    IntegrationToolExecutor,
  ],
  exports: [
    AiService,
    ImplementationAiService,
    ImplementationToolExecutor,
    IntegrationToolExecutor,
  ],
})
export class AiModule {}
