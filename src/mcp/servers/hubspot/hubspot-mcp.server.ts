import { Injectable } from '@nestjs/common';
import { HubSpotService } from '../../../integrations/services/hubspot.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildHubSpotTools } from './hubspot-tools';

@Injectable()
export class HubSpotMcpServer extends McpServerBase {
  readonly namespace = 'hubspot';
  private readonly tools: ToolDefinition[];

  constructor(hubspot: HubSpotService) {
    super();
    this.tools = buildHubSpotTools(hubspot);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
