import { Injectable, Logger } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ToolDefinition } from './mcp-tool';
import { TenantContext } from './mcp-context';

type ToolInvoker = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: TenantContext,
) => Promise<unknown>;

/**
 * Thin wrapper over @modelcontextprotocol/sdk's Server. Owns nothing but the
 * SDK wiring so that future SDK upgrades stay contained to this file.
 *
 * The factory builds one Server per namespace (slack, jira, …) but the
 * dispatch entry point remains the McpToolRouter — Servers exist so the
 * Phase 2 externalization (stdio / HTTP) is a transport swap.
 */
@Injectable()
export class McpServerFactory {
  private readonly logger = new Logger(McpServerFactory.name);

  create(
    namespace: string,
    tools: ToolDefinition[],
    invoker: ToolInvoker,
  ): Server {
    const server = new Server(
      { name: `taurus-${namespace}`, version: '0.1.0' },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.inputSchema),
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
      const ctx = (extra as { _meta?: { tenantContext?: TenantContext } })
        ?._meta?.tenantContext;
      if (!ctx) {
        throw new Error(
          `MCP tool call for ${req.params.name} missing tenantContext in _meta`,
        );
      }
      const result = await invoker(
        req.params.name,
        (req.params.arguments ?? {}) as Record<string, unknown>,
        ctx,
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    });

    this.logger.log(
      `Registered MCP server "${namespace}" with ${tools.length} tools`,
    );
    return server;
  }
}

/**
 * zod → JSON Schema. zod v4 ships a builtin; fall back to a minimal shape if
 * unavailable. Kept inline so the factory has no extra runtime dep beyond the
 * MCP SDK itself.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const zAny = z as unknown as { toJSONSchema?: (s: z.ZodTypeAny) => unknown };
  if (typeof zAny.toJSONSchema === 'function') {
    return zAny.toJSONSchema(schema) as Record<string, unknown>;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { zodToJsonSchema: convert } = require('zod-to-json-schema');
  return convert(schema) as Record<string, unknown>;
}
