import { Injectable } from '@nestjs/common';
import { GmailService } from '../../../integrations/services/gmail.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildGmailTools } from './gmail-tools';

@Injectable()
export class GmailMcpServer extends McpServerBase {
  readonly namespace = 'gmail';
  private readonly tools: ToolDefinition[];

  constructor(gmail: GmailService) {
    super();
    this.tools = buildGmailTools(gmail);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
