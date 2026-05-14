import { Injectable } from '@nestjs/common';
import { GoogleCalendarService } from '../../../integrations/services/google-calendar.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildGCalTools } from './gcal-tools';

@Injectable()
export class GCalMcpServer extends McpServerBase {
  readonly namespace = 'gcal';
  private readonly tools: ToolDefinition[];

  constructor(gcal: GoogleCalendarService) {
    super();
    this.tools = buildGCalTools(gcal);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
