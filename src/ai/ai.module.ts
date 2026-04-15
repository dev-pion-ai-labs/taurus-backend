import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations';
import { AiService } from './ai.service';
import { ImplementationAiService } from './implementation-ai.service';
import { ImplementationToolExecutor } from './tools/implementation-tool-executor';
import { SlackToolExecutor } from './tools/slack-tool-executor';
import { GitHubToolExecutor } from './tools/github-tool-executor';
import { MakeToolExecutor } from './tools/make-tool-executor';
import { NotionToolExecutor } from './tools/notion-tool-executor';

@Module({
  imports: [IntegrationsModule],
  providers: [
    AiService,
    ImplementationAiService,
    ImplementationToolExecutor,
    SlackToolExecutor,
    GitHubToolExecutor,
    MakeToolExecutor,
    NotionToolExecutor,
  ],
  exports: [
    AiService,
    ImplementationAiService,
    ImplementationToolExecutor,
    SlackToolExecutor,
    GitHubToolExecutor,
    MakeToolExecutor,
    NotionToolExecutor,
  ],
})
export class AiModule {}
