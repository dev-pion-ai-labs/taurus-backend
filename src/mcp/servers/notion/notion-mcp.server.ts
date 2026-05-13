import { Injectable } from '@nestjs/common';
import { NotionService } from '../../../integrations/services/notion.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildNotionTools } from './notion-tools';

@Injectable()
export class NotionMcpServer extends McpServerBase {
  readonly namespace = 'notion';
  private readonly tools: ToolDefinition[];

  constructor(notion: NotionService) {
    super();
    this.tools = buildNotionTools(notion);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
