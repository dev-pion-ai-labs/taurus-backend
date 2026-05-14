import { McpToolRouter } from '../mcp/core/mcp-tool-router';
import { toolError } from '../mcp/core/tool-result';
import type { DeploymentStepPlan } from '../ai/implementation-ai.service';
import { PlanExecutorService } from './plan-executor.service';

type StoredPlan = {
  id: string;
  actionId: string;
  organizationId: string;
  deploymentSteps: DeploymentStepPlan[];
};

function makePlan(steps: DeploymentStepPlan[]): StoredPlan {
  return {
    id: 'plan-1',
    actionId: 'action-1',
    organizationId: 'org-1',
    deploymentSteps: steps,
  };
}

function makePrismaStub(initial: StoredPlan) {
  let current: StoredPlan = { ...initial };
  return {
    state: () => current,
    deploymentPlan: {
      findFirstOrThrow: jest.fn(async () => current),
      update: jest.fn(async ({ data }: { data: { deploymentSteps: unknown } }) => {
        current = {
          ...current,
          deploymentSteps: data.deploymentSteps as DeploymentStepPlan[],
        };
        return current;
      }),
    },
    transformationAction: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async () => ({ title: 'Test action' })),
      update: jest.fn(async () => ({ title: 'Test action' })),
    },
    user: {
      findUnique: jest.fn(async () => ({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
      })),
    },
  };
}

const slackStub = () => ({
  notifyExecutionStarted: jest.fn().mockResolvedValue(undefined),
  notifyDeployed: jest.fn().mockResolvedValue(undefined),
});

const trackerStub = () => ({
  maybeCompleteSprint: jest.fn().mockResolvedValue(undefined),
});

function makeRouter(invoke: jest.Mock): McpToolRouter {
  return { invoke } as unknown as McpToolRouter;
}

describe('PlanExecutorService', () => {
  it('marks step completed and counts success when handler returns a value', async () => {
    const prisma = makePrismaStub(
      makePlan([
        {
          provider: 'SLACK',
          tool: 'slack_create_channel',
          params: { name: 'launch' },
        },
      ]),
    );
    const invoke = jest.fn().mockResolvedValue({ channelId: 'C123' });
    const executor = new PlanExecutorService(
      prisma as never,
      makeRouter(invoke),
      slackStub() as never,
      trackerStub() as never,
    );

    const summary = await executor.execute('plan-1', 'org-1', 'user-1');

    expect(summary).toMatchObject({ total: 1, completed: 1, failed: 0, skipped: 0 });
    const persisted = prisma.state().deploymentSteps[0];
    expect(persisted.status).toBe('completed');
    expect(persisted.result).toEqual({ channelId: 'C123' });
  });

  it('marks step failed when MCP returns a tool-error envelope', async () => {
    const prisma = makePrismaStub(
      makePlan([
        {
          provider: 'SLACK',
          tool: 'slack_send_message',
          params: { channel: 'C123', text: 'hi' },
        },
      ]),
    );
    const invoke = jest
      .fn()
      .mockResolvedValue(toolError('TOOL_FAILED', 'Slack workspace disconnected'));
    const executor = new PlanExecutorService(
      prisma as never,
      makeRouter(invoke),
      slackStub() as never,
      trackerStub() as never,
    );

    const summary = await executor.execute('plan-1', 'org-1', 'user-1');

    expect(summary).toMatchObject({ total: 1, completed: 0, failed: 1, skipped: 0 });
    const persisted = prisma.state().deploymentSteps[0];
    expect(persisted.status).toBe('failed');
    expect(persisted.error).toContain('TOOL_FAILED');
    expect(persisted.error).toContain('Slack workspace disconnected');
  });

  it('skips dependent step when its dependency failed', async () => {
    const prisma = makePrismaStub(
      makePlan([
        {
          provider: 'SLACK',
          tool: 'slack_create_channel',
          params: { name: 'launch' },
        },
        {
          provider: 'SLACK',
          tool: 'slack_send_message',
          params: { channel: '{{steps[0].result.channelId}}', text: 'hi' },
          dependsOn: [0],
        },
      ]),
    );
    const invoke = jest
      .fn()
      .mockResolvedValueOnce(toolError('TOOL_FAILED', 'channel name taken'));
    const executor = new PlanExecutorService(
      prisma as never,
      makeRouter(invoke),
      slackStub() as never,
      trackerStub() as never,
    );

    const summary = await executor.execute('plan-1', 'org-1', 'user-1');

    expect(summary).toMatchObject({ total: 2, completed: 0, failed: 1, skipped: 1 });
    expect(invoke).toHaveBeenCalledTimes(1);
    const steps = prisma.state().deploymentSteps;
    expect(steps[0].status).toBe('failed');
    expect(steps[1].status).toBe('skipped');
    expect(steps[1].error).toContain('dependency failed');
  });

  it('substitutes {{steps[N].result.path}} from a successful prior step', async () => {
    const prisma = makePrismaStub(
      makePlan([
        {
          provider: 'SLACK',
          tool: 'slack_create_channel',
          params: { name: 'launch' },
        },
        {
          provider: 'SLACK',
          tool: 'slack_send_message',
          params: { channel: '{{steps[0].result.channelId}}', text: 'hi' },
          dependsOn: [0],
        },
      ]),
    );
    const invoke = jest
      .fn()
      .mockResolvedValueOnce({ channelId: 'C999' })
      .mockResolvedValueOnce({ ok: true, ts: '1' });
    const executor = new PlanExecutorService(
      prisma as never,
      makeRouter(invoke),
      slackStub() as never,
      trackerStub() as never,
    );

    const summary = await executor.execute('plan-1', 'org-1', 'user-1');

    expect(summary).toMatchObject({ total: 2, completed: 2, failed: 0, skipped: 0 });
    expect(invoke.mock.calls[1][1]).toEqual({ channel: 'C999', text: 'hi' });
  });

  it('clears stale step.result when re-running a previously-failed step', async () => {
    // Pre-seed step 0 as 'failed' but with a stale result from a prior run
    // (e.g. a partial response shape). On retry, step 0 fails again — and
    // the stale result must NOT leak into a sibling step whose dependsOn
    // wasn't declared (so the dependency-skip guard doesn't fire).
    const prisma = makePrismaStub(
      makePlan([
        {
          provider: 'SLACK',
          tool: 'slack_create_channel',
          params: { name: 'launch' },
          status: 'failed',
          result: { channelId: 'STALE_FROM_PRIOR_RUN' },
          error: 'previous attempt failed',
        },
      ]),
    );
    const invoke = jest
      .fn()
      .mockResolvedValue(toolError('TOOL_FAILED', 'still broken'));
    const executor = new PlanExecutorService(
      prisma as never,
      makeRouter(invoke),
      slackStub() as never,
      trackerStub() as never,
    );

    await executor.execute('plan-1', 'org-1', 'user-1');

    const persisted = prisma.state().deploymentSteps[0];
    expect(persisted.status).toBe('failed');
    expect(persisted.result).toBeUndefined();
    expect(persisted.error).toContain('still broken');
  });

  it('rejects substitution when the referenced step result is an error envelope', async () => {
    // Pre-seed step 0 as "completed" but with an error envelope as result —
    // the shape PlanExecutor used to write before the envelope-detection fix.
    // The substitution path must reject this to avoid silent garbage.
    const prisma = makePrismaStub(
      makePlan([
        {
          provider: 'SLACK',
          tool: 'slack_create_channel',
          params: { name: 'launch' },
          status: 'completed',
          result: toolError('TOOL_FAILED', 'rate limited'),
        },
        {
          provider: 'SLACK',
          tool: 'slack_send_message',
          params: { channel: '{{steps[0].result.channelId}}', text: 'hi' },
        },
      ]),
    );
    const invoke = jest.fn();
    const executor = new PlanExecutorService(
      prisma as never,
      makeRouter(invoke),
      slackStub() as never,
      trackerStub() as never,
    );

    const summary = await executor.execute('plan-1', 'org-1', 'user-1');

    expect(summary.failed).toBe(1);
    expect(invoke).not.toHaveBeenCalled();
    const step1 = prisma.state().deploymentSteps[1];
    expect(step1.status).toBe('failed');
    expect(step1.error).toContain('error envelope');
  });
});
