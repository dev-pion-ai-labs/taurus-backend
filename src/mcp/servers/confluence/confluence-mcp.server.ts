import { Injectable } from '@nestjs/common';
import { ConfluenceService } from '../../../integrations/services/confluence.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildConfluenceTools } from './confluence-tools';

@Injectable()
export class ConfluenceMcpServer extends McpServerBase {
  readonly namespace = 'confluence';
  private readonly tools: ToolDefinition[];

  constructor(confluence: ConfluenceService) {
    super();
    this.tools = buildConfluenceTools(confluence);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
