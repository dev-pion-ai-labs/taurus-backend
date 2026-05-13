import { buildTaurusTools } from './taurus-tools';
import { TaurusMcpServer } from './taurus-mcp.server';
import { TaurusContextService } from './taurus-context.service';
import { McpServerFactory } from '../../core/mcp-server-factory';
import { McpToolRouter } from '../../core/mcp-tool-router';

const LEGACY_TAURUS_TOOL_NAMES = [
  'get_organization_context',
  'get_department_details',
  'get_tech_stack',
  'get_related_actions',
  'get_report_context',
  'get_connected_integrations',
];

function makeContextStub(): jest.Mocked<TaurusContextService> {
  return {
    getOrganizationContext: jest.fn().mockResolvedValue({ name: 'Acme' }),
    getDepartmentDetails: jest.fn().mockResolvedValue([{ name: 'Eng' }]),
    getTechStack: jest.fn().mockResolvedValue([{ name: 'Notion' }]),
    getRelatedActions: jest.fn().mockResolvedValue([{ id: 'a1' }]),
    getReportContext: jest.fn().mockResolvedValue({ overallScore: 80 }),
    getConnectedIntegrations: jest
      .fn()
      .mockResolvedValue({ connected: [], availableTools: [] }),
  } as unknown as jest.Mocked<TaurusContextService>;
}

describe('TaurusMcpServer', () => {
  it('registers all legacy taurus + meta tool names byte-identically', () => {
    const tools = buildTaurusTools(makeContextStub());
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...LEGACY_TAURUS_TOOL_NAMES].sort(),
    );
  });

  it('marks every taurus tool as read-only', () => {
    const tools = buildTaurusTools(makeContextStub());
    for (const t of tools) {
      expect(t.sensitivity).toBe('read');
    }
  });

  it('routes get_department_details with departmentName filter', async () => {
    const ctxStub = makeContextStub();
    const router = new McpToolRouter(new McpServerFactory(), [
      new TaurusMcpServer(ctxStub),
    ]);

    await router.invoke(
      'get_department_details',
      { departmentName: 'Sales' },
      { orgId: 'org_1', executionMode: 'planning' },
    );

    expect(ctxStub.getDepartmentDetails).toHaveBeenCalledWith('org_1', 'Sales');
  });

  it('routes get_related_actions with both filters', async () => {
    const ctxStub = makeContextStub();
    const router = new McpToolRouter(new McpServerFactory(), [
      new TaurusMcpServer(ctxStub),
    ]);

    await router.invoke(
      'get_related_actions',
      { department: 'Ops', status: 'IN_PROGRESS' },
      { orgId: 'org_1', executionMode: 'planning' },
    );

    expect(ctxStub.getRelatedActions).toHaveBeenCalledWith(
      'org_1',
      'Ops',
      'IN_PROGRESS',
    );
  });

  it('reads execute in planning mode without dry-run', async () => {
    const ctxStub = makeContextStub();
    const router = new McpToolRouter(new McpServerFactory(), [
      new TaurusMcpServer(ctxStub),
    ]);

    const out = await router.invoke('get_organization_context', {}, {
      orgId: 'org_1',
      executionMode: 'planning',
    });

    expect(ctxStub.getOrganizationContext).toHaveBeenCalledWith('org_1');
    expect(out).toEqual({ name: 'Acme' });
  });
});
