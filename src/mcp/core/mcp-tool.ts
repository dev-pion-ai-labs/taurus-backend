import { z, ZodTypeAny } from 'zod';
import { TenantContext } from './mcp-context';
import { ToolSensitivity } from './tool-annotations';
import { ToolDryRunEnvelope } from './tool-result';

export interface ToolDefinition<TSchema extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  sensitivity: ToolSensitivity;
  inputSchema: TSchema;
  /**
   * Tool handler — invoked by the router on success path.
   *
   * Contract: on failure, THROW. Do not return `{ error: ... }` envelopes.
   * The router's try/catch in `McpToolRouter.invoke` converts thrown errors
   * into the canonical `{ error: true, code: 'TOOL_FAILED', message }` shape
   * that `PlanExecutorService` and the planning loop both rely on. Returning
   * a soft-error object instead of throwing makes the executor record the
   * step as `completed` with garbage data — see the regression test
   * "wraps a SlackService throw into a TOOL_FAILED envelope" in
   * `slack-mcp.server.spec.ts` and the matching per-provider tests in
   * `phase1c-parity.spec.ts`.
   *
   * The provider services this delegates to (jira/notion/gdrive/hubspot/
   * salesforce/slack) already throw `BadRequestException` on API failure,
   * so most handlers just need to call through.
   */
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
