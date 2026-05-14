import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { AiService } from './ai.service';
import { ImplementationAiService } from './implementation-ai.service';

@Module({
  imports: [McpModule],
  providers: [AiService, ImplementationAiService],
  exports: [AiService, ImplementationAiService],
})
export class AiModule {}
