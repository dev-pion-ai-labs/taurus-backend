import { ToolDefinition } from './mcp-tool';

/**
 * Base contract for an in-process MCP server. Each provider (Slack, Jira, …)
 * implements this and is registered with the McpToolRouter at boot.
 *
 * The MCP SDK Server object is created lazily via McpServerFactory when the
 * router boots, so this base class deliberately stays SDK-agnostic. That keeps
 * the externalization path (stdio / HTTP transport) a transport swap rather
 * than a rewrite.
 */
export abstract class McpServerBase {
  abstract readonly namespace: string;
  abstract listTools(): ToolDefinition[];
}
