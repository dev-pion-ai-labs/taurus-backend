import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { McpServerBase } from './mcp-server.base';
import { McpServerFactory } from './mcp-server-factory';
import { ToolDefinition } from './mcp-tool';
import { TenantContext } from './mcp-context';
import { shouldDryRun } from './tool-annotations';
import { ToolDryRunEnvelope, toolError } from './tool-result';

export const MCP_SERVERS = Symbol('MCP_SERVERS');

/**
 * Single entry point for every integration tool call. The router owns:
 *   1. Name → tool lookup across all registered servers
 *   2. Sensitivity gating (dry-run vs real call per executionMode)
 *   3. Translation from MCP tool defs → Anthropic Tool[] for the planner
 *
 * Provider services are invoked via each tool's handler closure — the router
 * never sees raw OAuth tokens.
 */
@Injectable()
export class McpToolRouter {
  private readonly logger = new Logger(McpToolRouter.name);
  private readonly tools = new Map<string, ToolDefinition>();

  private readonly namespaces = new Set<string>();

  constructor(
    private readonly factory: McpServerFactory,
    @Optional() @Inject(MCP_SERVERS) servers: McpServerBase[] = [],
  ) {
    for (const server of servers) {
      this.namespaces.add(server.namespace);
      for (const tool of server.listTools()) {
        if (this.tools.has(tool.name)) {
          throw new Error(`Duplicate MCP tool name: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
      }
      // Build the underlying SDK Server so future transports can attach.
      this.factory.create(
        server.namespace,
        server.listTools(),
        (name, input, ctx) => this.invoke(name, input, ctx),
      );
    }
    this.logger.log(
      `McpToolRouter initialized with ${this.tools.size} tools across [${[...this.namespaces].join(', ') || 'none'}]`,
    );
  }

  /** Provider namespaces currently registered with the router. */
  listNamespaces(): string[] {
    return [...this.namespaces];
  }

  /** Tool list translated for Anthropic SDK's tool_use. */
  listToolsForClaude(): Anthropic.Tool[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: zodToAnthropicSchema(t.inputSchema),
    }));
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Names of tools eligible to appear in a deploymentStep — i.e. anything
   * that mutates external state. Read-only tools (list_*, search, query,
   * taurus context) are filtered out so the planner can't accidentally
   * schedule a read as a deployment action.
   */
  listWriteToolNames(): Set<string> {
    const names = new Set<string>();
    for (const tool of this.tools.values()) {
      if (tool.sensitivity === 'write' || tool.sensitivity === 'destructive') {
        names.add(tool.name);
      }
    }
    return names;
  }

  async invoke(
    toolName: string,
    rawInput: Record<string, unknown>,
    ctx: TenantContext,
  ): Promise<unknown> {
    const tool = this.tools.get(toolName);
    if (!tool) return toolError('UNKNOWN_TOOL', `No MCP tool named ${toolName}`);

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return toolError('INVALID_INPUT', parsed.error.message);
    }
    const input = parsed.data as Record<string, unknown>;

    const dryRun = shouldDryRun(
      tool.sensitivity,
      ctx.executionMode,
      Boolean(tool.dryRun),
    );

    try {
      if (dryRun) {
        if (tool.dryRun) return await tool.dryRun(input, ctx);
        const envelope: ToolDryRunEnvelope = {
          wouldExecute: true,
          summary: `Would call ${toolName}`,
          params: input,
        };
        return envelope;
      }
      return await tool.handler(input, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tool ${toolName} failed: ${message}`);
      return toolError('TOOL_FAILED', message);
    }
  }
}

function zodToAnthropicSchema(schema: z.ZodTypeAny): Anthropic.Tool['input_schema'] {
  const zAny = z as unknown as { toJSONSchema?: (s: z.ZodTypeAny) => unknown };
  let json: Record<string, unknown>;
  if (typeof zAny.toJSONSchema === 'function') {
    json = zAny.toJSONSchema(schema) as Record<string, unknown>;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { zodToJsonSchema } = require('zod-to-json-schema');
    json = zodToJsonSchema(schema) as Record<string, unknown>;
  }
  // Anthropic requires { type: 'object', properties, required? }
  if (json.type !== 'object') {
    return { type: 'object', properties: {} };
  }
  return json as Anthropic.Tool['input_schema'];
}
