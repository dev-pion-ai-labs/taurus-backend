import { Injectable } from '@nestjs/common';
import { JiraService } from '../../../integrations/services/jira.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildJiraTools } from './jira-tools';

@Injectable()
export class JiraMcpServer extends McpServerBase {
  readonly namespace = 'jira';
  private readonly tools: ToolDefinition[];

  constructor(jira: JiraService) {
    super();
    this.tools = buildJiraTools(jira);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
