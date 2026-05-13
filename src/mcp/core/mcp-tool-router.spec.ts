import { z } from 'zod';
import { McpServerBase } from './mcp-server.base';
import { McpServerFactory } from './mcp-server-factory';
import { McpToolRouter } from './mcp-tool-router';
import { defineTool, ToolDefinition } from './mcp-tool';
import { TenantContext } from './mcp-context';

class StubServer extends McpServerBase {
  readonly namespace = 'stub';
  constructor(private readonly _tools: ToolDefinition[]) {
    super();
  }
  listTools() {
    return this._tools;
  }
}

const baseCtx = (mode: TenantContext['executionMode']): TenantContext => ({
  orgId: 'org_1',
  executionMode: mode,
});

describe('McpToolRouter', () => {
  const factory = new McpServerFactory();

  it('dispatches read tools in planning mode', async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    const router = new McpToolRouter(factory, [
      new StubServer([
        defineTool({
          name: 'stub_read',
          description: 'read',
          sensitivity: 'read',
          inputSchema: z.object({ q: z.string() }),
          handler,
        }),
      ]),
    ]);

    const out = await router.invoke('stub_read', { q: 'hi' }, baseCtx('planning'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ ok: true });
  });

  it('returns dry-run envelope for destructive tools during planning', async () => {
    const handler = jest.fn();
    const router = new McpToolRouter(factory, [
      new StubServer([
        defineTool({
          name: 'stub_destroy',
          description: 'destroy',
          sensitivity: 'destructive',
          inputSchema: z.object({ id: z.string() }),
          handler,
        }),
      ]),
    ]);

    const out = await router.invoke(
      'stub_destroy',
      { id: 'x' },
      baseCtx('planning'),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(out).toMatchObject({ wouldExecute: true, params: { id: 'x' } });
  });

  it('executes destructive tools in approved-execution mode', async () => {
    const handler = jest.fn().mockResolvedValue({ deleted: 1 });
    const router = new McpToolRouter(factory, [
      new StubServer([
        defineTool({
          name: 'stub_destroy',
          description: 'destroy',
          sensitivity: 'destructive',
          inputSchema: z.object({ id: z.string() }),
          handler,
        }),
      ]),
    ]);

    const out = await router.invoke(
      'stub_destroy',
      { id: 'x' },
      baseCtx('approved-execution'),
    );
    expect(handler).toHaveBeenCalledWith({ id: 'x' }, expect.any(Object));
    expect(out).toEqual({ deleted: 1 });
  });

  it('uses tool-provided dryRun when available for write tools in planning', async () => {
    const dryRun = jest.fn().mockReturnValue({
      wouldExecute: true,
      summary: 'preview',
      params: { v: 1 },
    });
    const handler = jest.fn();
    const router = new McpToolRouter(factory, [
      new StubServer([
        defineTool({
          name: 'stub_write',
          description: 'write',
          sensitivity: 'write',
          inputSchema: z.object({ v: z.number() }),
          handler,
          dryRun,
        }),
      ]),
    ]);

    const out = await router.invoke('stub_write', { v: 1 }, baseCtx('planning'));
    expect(handler).not.toHaveBeenCalled();
    expect(dryRun).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ summary: 'preview' });
  });

  it('executes write tools in planning when no dryRun handler is provided', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const router = new McpToolRouter(factory, [
      new StubServer([
        defineTool({
          name: 'stub_write_idempotent',
          description: 'write',
          sensitivity: 'write',
          inputSchema: z.object({}),
          handler,
        }),
      ]),
    ]);

    const out = await router.invoke(
      'stub_write_idempotent',
      {},
      baseCtx('planning'),
    );
    expect(handler).toHaveBeenCalled();
    expect(out).toBe('ok');
  });

  it('returns INVALID_INPUT for schema violations', async () => {
    const router = new McpToolRouter(factory, [
      new StubServer([
        defineTool({
          name: 'stub_read',
          description: 'read',
          sensitivity: 'read',
          inputSchema: z.object({ q: z.string() }),
          handler: jest.fn(),
        }),
      ]),
    ]);

    const out = (await router.invoke(
      'stub_read',
      { q: 123 },
      baseCtx('planning'),
    )) as { code?: string };
    expect(out.code).toBe('INVALID_INPUT');
  });

  it('returns UNKNOWN_TOOL for missing names', async () => {
    const router = new McpToolRouter(factory, []);
    const out = (await router.invoke('nope', {}, baseCtx('planning'))) as {
      code?: string;
    };
    expect(out.code).toBe('UNKNOWN_TOOL');
  });

  it('rejects duplicate tool names at registration', () => {
    const dup = defineTool({
      name: 'dup',
      description: 'd',
      sensitivity: 'read',
      inputSchema: z.object({}),
      handler: jest.fn(),
    });
    expect(
      () =>
        new McpToolRouter(factory, [new StubServer([dup]), new StubServer([dup])]),
    ).toThrow(/Duplicate MCP tool name/);
  });
});
