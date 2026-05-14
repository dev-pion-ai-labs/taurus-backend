import { buildJiraTools } from './jira/jira-tools';
import { buildNotionTools } from './notion/notion-tools';
import { buildGDriveTools } from './gdrive/gdrive-tools';
import { buildHubSpotTools } from './hubspot/hubspot-tools';
import { buildSalesforceTools } from './salesforce/salesforce-tools';
import { McpServerFactory } from '../core/mcp-server-factory';
import { McpToolRouter } from '../core/mcp-tool-router';
import { JiraMcpServer } from './jira/jira-mcp.server';
import { NotionMcpServer } from './notion/notion-mcp.server';
import { GDriveMcpServer } from './gdrive/gdrive-mcp.server';
import { HubSpotMcpServer } from './hubspot/hubspot-mcp.server';
import { SalesforceMcpServer } from './salesforce/salesforce-mcp.server';

// Frozen tool-name allow-list. Renaming any of these is a separate, deliberate
// PR because it breaks plan-history compatibility (deploymentSteps reference
// tool names verbatim) and prompts that mention tool names.
const LEGACY = {
  jira: [
    'jira_create_issue',
    'jira_transition_issue',
    'jira_add_comment',
    'jira_list_projects',
  ],
  notion: ['notion_create_page', 'notion_create_database', 'notion_search'],
  gdrive: ['gdrive_create_document'],
  hubspot: ['hubspot_create_contact', 'hubspot_create_deal', 'hubspot_list_pipelines'],
  salesforce: ['salesforce_create_record', 'salesforce_query'],
};

function names(tools: { name: string }[]) {
  return tools.map((t) => t.name).sort();
}

describe('Phase 1c provider parity', () => {
  it('Jira tool names match legacy', () => {
    expect(names(buildJiraTools({} as never))).toEqual([...LEGACY.jira].sort());
  });
  it('Notion tool names match legacy', () => {
    expect(names(buildNotionTools({} as never))).toEqual(
      [...LEGACY.notion].sort(),
    );
  });
  it('GDrive tool names match legacy', () => {
    expect(names(buildGDriveTools({} as never))).toEqual(
      [...LEGACY.gdrive].sort(),
    );
  });
  it('HubSpot tool names match legacy', () => {
    expect(names(buildHubSpotTools({} as never))).toEqual(
      [...LEGACY.hubspot].sort(),
    );
  });
  it('Salesforce tool names match legacy', () => {
    expect(names(buildSalesforceTools({} as never))).toEqual(
      [...LEGACY.salesforce].sort(),
    );
  });

  it('handlers delegate to the underlying provider service', async () => {
    const jira = { createIssue: jest.fn().mockResolvedValue({ key: 'P-1' }) };
    const notion = { search: jest.fn().mockResolvedValue([{ id: 'p' }]) };
    const gdrive = {
      exportDocument: jest.fn().mockResolvedValue({ docId: 'd1' }),
    };
    const hubspot = {
      listPipelines: jest.fn().mockResolvedValue([{ id: 'pl' }]),
    };
    const salesforce = {
      createRecord: jest.fn().mockResolvedValue({ id: 'r1' }),
    };

    const router = new McpToolRouter(new McpServerFactory(), [
      new JiraMcpServer(jira as never),
      new NotionMcpServer(notion as never),
      new GDriveMcpServer(gdrive as never),
      new HubSpotMcpServer(hubspot as never),
      new SalesforceMcpServer(salesforce as never),
    ]);

    const ctx = { orgId: 'org_1', executionMode: 'approved-execution' as const };

    await router.invoke(
      'jira_create_issue',
      { projectKey: 'P', summary: 's' },
      ctx,
    );
    expect(jira.createIssue).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ projectKey: 'P', summary: 's' }),
    );

    await router.invoke('notion_search', { query: 'q' }, ctx);
    expect(notion.search).toHaveBeenCalledWith('org_1', 'q');

    await router.invoke(
      'gdrive_create_document',
      { title: 't', content: 'c' },
      ctx,
    );
    expect(gdrive.exportDocument).toHaveBeenCalledWith('org_1', 't', 'c');

    await router.invoke('hubspot_list_pipelines', {}, ctx);
    expect(hubspot.listPipelines).toHaveBeenCalledWith('org_1');

    await router.invoke(
      'salesforce_create_record',
      { objectType: 'Account', fields: { Name: 'Acme' } },
      ctx,
    );
    expect(salesforce.createRecord).toHaveBeenCalledWith(
      'org_1',
      'Account',
      { Name: 'Acme' },
    );
  });

  it('passes only the legacy fields when calling Jira.createIssue', async () => {
    const jira = { createIssue: jest.fn().mockResolvedValue({ key: 'P-1' }) };
    const router = new McpToolRouter(new McpServerFactory(), [
      new JiraMcpServer(jira as never),
    ]);

    await router.invoke(
      'jira_create_issue',
      {
        projectKey: 'PROJ',
        summary: 'Do thing',
        description: 'desc',
        issueType: 'Bug',
        priority: 'High',
        labels: ['x', 'y'],
      },
      { orgId: 'org_1', executionMode: 'approved-execution' },
    );

    expect(jira.createIssue).toHaveBeenCalledWith('org_1', {
      projectKey: 'PROJ',
      summary: 'Do thing',
      description: 'desc',
      issueType: 'Bug',
      priority: 'High',
      labels: ['x', 'y'],
    });
  });

  // Regression guard for the bug class fixed in slack.service.ts: a provider
  // service returning a soft-error envelope instead of throwing causes the
  // executor to mark the step `completed` with garbage data. Every write
  // handler must throw on failure so the router converts it to TOOL_FAILED.
  // Add new providers (Linear, Asana, etc.) to this table.
  describe.each([
    {
      provider: 'jira',
      tool: 'jira_create_issue',
      params: { projectKey: 'P', summary: 's' },
      makeStub: () => ({
        createIssue: jest.fn().mockRejectedValue(new Error('Jira API error: 401')),
      }),
      makeServer: (stub: unknown) => new JiraMcpServer(stub as never),
    },
    {
      provider: 'notion',
      tool: 'notion_create_page',
      params: { title: 't' },
      makeStub: () => ({
        createPage: jest.fn().mockRejectedValue(new Error('Notion is not connected')),
      }),
      makeServer: (stub: unknown) => new NotionMcpServer(stub as never),
    },
    {
      provider: 'gdrive',
      tool: 'gdrive_create_document',
      params: { title: 't', content: 'c' },
      makeStub: () => ({
        exportDocument: jest
          .fn()
          .mockRejectedValue(new Error('Failed to export to Google Drive')),
      }),
      makeServer: (stub: unknown) => new GDriveMcpServer(stub as never),
    },
    {
      provider: 'hubspot',
      tool: 'hubspot_create_contact',
      params: { email: 'x@y.com' },
      makeStub: () => ({
        createContact: jest
          .fn()
          .mockRejectedValue(new Error('HubSpot API error: 403')),
      }),
      makeServer: (stub: unknown) => new HubSpotMcpServer(stub as never),
    },
    {
      provider: 'salesforce',
      tool: 'salesforce_create_record',
      params: { objectType: 'Account', fields: { Name: 'Acme' } },
      makeStub: () => ({
        createRecord: jest
          .fn()
          .mockRejectedValue(new Error('Salesforce API error: 400')),
      }),
      makeServer: (stub: unknown) => new SalesforceMcpServer(stub as never),
    },
  ])('$provider service-throws contract', ({ tool, params, makeStub, makeServer }) => {
    it(`wraps a thrown error from ${tool} into a TOOL_FAILED envelope`, async () => {
      const stub = makeStub();
      const router = new McpToolRouter(new McpServerFactory(), [makeServer(stub)]);

      const out = (await router.invoke(tool, params, {
        orgId: 'org_1',
        executionMode: 'approved-execution',
      })) as { error?: boolean; code?: string; message?: string };

      expect(out.error).toBe(true);
      expect(out.code).toBe('TOOL_FAILED');
      expect(typeof out.message).toBe('string');
      expect(out.message!.length).toBeGreaterThan(0);
    });
  });

  it('maps Notion `columns` input to service `properties`', async () => {
    const notion = {
      createDatabase: jest.fn().mockResolvedValue({ id: 'db1' }),
    };
    const router = new McpToolRouter(new McpServerFactory(), [
      new NotionMcpServer(notion as never),
    ]);

    await router.invoke(
      'notion_create_database',
      {
        parentPageId: 'p1',
        title: 'My DB',
        columns: { Status: { type: 'select', options: ['open', 'closed'] } },
      },
      { orgId: 'org_1', executionMode: 'approved-execution' },
    );

    expect(notion.createDatabase).toHaveBeenCalledWith('org_1', {
      parentPageId: 'p1',
      title: 'My DB',
      properties: { Status: { type: 'select', options: ['open', 'closed'] } },
    });
  });
});
