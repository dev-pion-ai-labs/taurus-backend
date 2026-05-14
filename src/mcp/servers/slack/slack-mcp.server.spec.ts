import { SlackService } from '../../../integrations/services/slack.service';
import { McpServerFactory } from '../../core/mcp-server-factory';
import { McpToolRouter } from '../../core/mcp-tool-router';
import { SlackMcpServer } from './slack-mcp.server';

const LEGACY_SLACK_TOOL_NAMES = [
  'slack_create_channel',
  'slack_send_message',
  'slack_set_channel_topic',
  'slack_list_channels',
  'slack_list_users',
];

function makeSlackStub(): jest.Mocked<SlackService> {
  return {
    createChannel: jest.fn().mockResolvedValue({ channelId: 'C1', name: 'x' }),
    sendMessage: jest.fn().mockResolvedValue({ ok: true, ts: '1', channel: 'C1' }),
    setChannelTopic: jest.fn().mockResolvedValue({ channelId: 'C1', topic: 't' }),
    listChannels: jest.fn().mockResolvedValue([{ id: 'C1', name: 'x' }]),
    listUsers: jest.fn().mockResolvedValue([{ id: 'U1', name: 'u' }]),
  } as unknown as jest.Mocked<SlackService>;
}

describe('SlackMcpServer parity', () => {
  it('registers all legacy Slack tool names byte-identically', () => {
    const slack = makeSlackStub();
    const server = new SlackMcpServer(slack);
    const names = server.listTools().map((t) => t.name).sort();
    expect(names).toEqual([...LEGACY_SLACK_TOOL_NAMES].sort());
  });

  it('routes slack_send_message through the router to SlackService.sendMessage', async () => {
    const slack = makeSlackStub();
    const router = new McpToolRouter(new McpServerFactory(), [new SlackMcpServer(slack)]);

    const out = await router.invoke(
      'slack_send_message',
      { channel: 'C1', text: 'hello' },
      { orgId: 'org_1', executionMode: 'approved-execution' },
    );

    expect(slack.sendMessage).toHaveBeenCalledWith('org_1', {
      channel: 'C1',
      text: 'hello',
    });
    expect(out).toEqual({ ok: true, ts: '1', channel: 'C1' });
  });

  it('routes slack_list_channels (read) on planning mode without dry-run', async () => {
    const slack = makeSlackStub();
    const router = new McpToolRouter(new McpServerFactory(), [new SlackMcpServer(slack)]);

    const out = await router.invoke('slack_list_channels', {}, {
      orgId: 'org_1',
      executionMode: 'planning',
    });

    expect(slack.listChannels).toHaveBeenCalledWith('org_1');
    expect(out).toEqual([{ id: 'C1', name: 'x' }]);
  });

  it('wraps a SlackService throw into a TOOL_FAILED envelope', async () => {
    const slack = makeSlackStub();
    slack.sendMessage = jest
      .fn()
      .mockRejectedValue(new Error('Slack is not connected for this organization'));
    const router = new McpToolRouter(new McpServerFactory(), [
      new SlackMcpServer(slack)]);

    const out = (await router.invoke(
      'slack_send_message',
      { channel: 'C1', text: 'hi' },
      { orgId: 'org_1', executionMode: 'approved-execution' },
    )) as { error?: boolean; code?: string; message?: string };

    expect(out.error).toBe(true);
    expect(out.code).toBe('TOOL_FAILED');
    expect(out.message).toContain('not connected');
  });

  it('returns dry-run envelope for slack_send_message during planning', async () => {
    const slack = makeSlackStub();
    const router = new McpToolRouter(new McpServerFactory(), [new SlackMcpServer(slack)]);

    const out = (await router.invoke(
      'slack_send_message',
      { channel: 'C1', text: 'hello' },
      { orgId: 'org_1', executionMode: 'planning' },
    )) as { wouldExecute?: boolean; summary?: string };

    expect(slack.sendMessage).not.toHaveBeenCalled();
    expect(out.wouldExecute).toBe(true);
    expect(out.summary).toContain('C1');
  });
});
