import { Injectable } from '@nestjs/common';
import { LinearService } from '../../../integrations/services/linear.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildLinearTools } from './linear-tools';

@Injectable()
export class LinearMcpServer extends McpServerBase {
  readonly namespace = 'linear';
  private readonly tools: ToolDefinition[];

  constructor(linear: LinearService) {
    super();
    this.tools = buildLinearTools(linear);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
