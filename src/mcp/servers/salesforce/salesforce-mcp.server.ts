import { Injectable } from '@nestjs/common';
import { SalesforceService } from '../../../integrations/services/salesforce.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildSalesforceTools } from './salesforce-tools';

@Injectable()
export class SalesforceMcpServer extends McpServerBase {
  readonly namespace = 'salesforce';
  private readonly tools: ToolDefinition[];

  constructor(salesforce: SalesforceService) {
    super();
    this.tools = buildSalesforceTools(salesforce);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
