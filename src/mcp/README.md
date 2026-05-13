# MCP Layer

Phase 1 scaffolding for the MCP-native integration-tool surface. See the plan
in the PR description for full context.

## Layout

```
core/                       Transport-agnostic primitives
  mcp-context.ts            TenantContext (orgId, executionMode, …)
  tool-annotations.ts       Sensitivity tiers + dry-run policy
  tool-result.ts            Standard envelopes (dry-run / error)
  mcp-tool.ts               defineTool() helper + ToolDefinition type
  mcp-server.base.ts        Abstract per-provider server contract
  mcp-server-factory.ts     Thin wrapper over @modelcontextprotocol/sdk Server
  mcp-tool-router.ts        Single dispatch point + Anthropic Tool[] adapter
servers/                    One subdir per provider (slack, jira, …) — Phase 1b+
mcp.module.ts               NestJS module
```

## Adding a provider server (Phase 1b template)

1. Create `servers/<provider>/<provider>-tools.ts` with `defineTool({...})`
   declarations. Each tool sets `sensitivity` ('read' | 'write' | 'destructive')
   and a `handler` that delegates to the existing NestJS provider service.
2. Create `servers/<provider>/<provider>-mcp.server.ts` extending
   `McpServerBase`, returning the tool array from `listTools()`.
3. Register the server class in `mcp.module.ts` and append it to the
   `MCP_SERVERS` provider value.
4. Keep tool names byte-identical to the legacy `INTEGRATION_TOOLS` entries to
   preserve plan-history compatibility.

## Approval gating

The router consults `tool.sensitivity` and `ctx.executionMode`:

| Sensitivity | planning              | approved-execution |
|-------------|-----------------------|--------------------|
| read        | real call             | real call          |
| write       | dry-run if handler    | real call          |
| destructive | always dry-run        | real call          |

`PlanExecutor` passes `executionMode: 'approved-execution'`; the planner
loop passes `'planning'`.
