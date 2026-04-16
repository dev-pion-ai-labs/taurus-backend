import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { ImplementationAiService } from './implementation-ai.service';
import { ImplementationToolExecutor } from './tools/implementation-tool-executor';

@Module({
  providers: [
    AiService,
    ImplementationAiService,
    ImplementationToolExecutor,
  ],
  exports: [
    AiService,
    ImplementationAiService,
    ImplementationToolExecutor,
  ],
})
export class AiModule {}
