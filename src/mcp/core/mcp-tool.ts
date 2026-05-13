import { z, ZodTypeAny } from 'zod';
import { TenantContext } from './mcp-context';
import { ToolSensitivity } from './tool-annotations';
import { ToolDryRunEnvelope } from './tool-result';

export interface ToolDefinition<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  sensitivity: ToolSensitivity;
  inputSchema: TSchema;
  handler: (input: z.infer<TSchema>, ctx: TenantContext) => Promise<unknown>;
  dryRun?: (
    input: z.infer<TSchema>,
    ctx: TenantContext,
  ) => ToolDryRunEnvelope | Promise<ToolDryRunEnvelope>;
}

export function defineTool<TSchema extends ZodTypeAny>(
  def: ToolDefinition<TSchema>,
): ToolDefinition<TSchema> {
  return def;
}
