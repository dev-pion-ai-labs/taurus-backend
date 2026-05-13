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
