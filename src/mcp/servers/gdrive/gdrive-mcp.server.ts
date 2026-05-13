import { Injectable } from '@nestjs/common';
import { GoogleDriveService } from '../../../integrations/services/google-drive.service';
import { McpServerBase } from '../../core/mcp-server.base';
import { ToolDefinition } from '../../core/mcp-tool';
import { buildGDriveTools } from './gdrive-tools';

@Injectable()
export class GDriveMcpServer extends McpServerBase {
  readonly namespace = 'gdrive';
  private readonly tools: ToolDefinition[];

  constructor(gdrive: GoogleDriveService) {
    super();
    this.tools = buildGDriveTools(gdrive);
  }

  listTools(): ToolDefinition[] {
    return this.tools;
  }
}
