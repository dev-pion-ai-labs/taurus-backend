import { Injectable } from '@nestjs/common';
import { AsanaService } from '../../../integrations/services/asana.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildAsanaTools } from './asana-tools';

@Injectable()
export class AsanaMcpServer extends McpServerBase {
  readonly namespace = 'asana';
  private readonly tools: ToolDefinition[];

  constructor(asana: AsanaService) {
    super();
    this.tools = buildAsanaTools(asana);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
