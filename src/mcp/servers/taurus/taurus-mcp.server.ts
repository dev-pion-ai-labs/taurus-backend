import { Injectable } from '@nestjs/common';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { TaurusContextService } from './taurus-context.service';
import { buildTaurusTools } from './taurus-tools';

@Injectable()
export class TaurusMcpServer extends McpServerBase {
  readonly namespace = 'taurus';
  private readonly tools: ToolDefinition[];

  constructor(ctxService: TaurusContextService) {
    super();
    this.tools = buildTaurusTools(ctxService);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
