import { Injectable } from '@nestjs/common';
import { SlackService } from '../../../integrations/services/slack.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildSlackTools } from './slack-tools';

@Injectable()
export class SlackMcpServer extends McpServerBase {
  readonly namespace = 'slack';
  private readonly tools: ToolDefinition[];

  constructor(slack: SlackService) {
    super();
    this.tools = buildSlackTools(slack);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
