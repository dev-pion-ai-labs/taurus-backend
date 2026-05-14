import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationsModule } from '../integrations';
import { McpServerFactory } from './core/mcp-server-factory';
import { McpToolRouter, MCP_SERVERS } from './core/mcp-tool-router';
import { McpServerBase } from './core/mcp-server.base';
import { SlackMcpServer } from './servers/slack/slack-mcp.server';
import { JiraMcpServer } from './servers/jira/jira-mcp.server';
import { NotionMcpServer } from './servers/notion/notion-mcp.server';
import { GDriveMcpServer } from './servers/gdrive/gdrive-mcp.server';
import { GCalMcpServer } from './servers/gcal/gcal-mcp.server';
import { GmailMcpServer } from './servers/gmail/gmail-mcp.server';
import { HubSpotMcpServer } from './servers/hubspot/hubspot-mcp.server';
import { SalesforceMcpServer } from './servers/salesforce/salesforce-mcp.server';
import { TaurusMcpServer } from './servers/taurus/taurus-mcp.server';
import { TaurusContextService } from './servers/taurus/taurus-context.service';

/**
 * Phase 1c: all six providers are registered through MCP behind MCP_PROVIDERS.
 *
 * Provider servers are always constructed (cheap — closures + metadata), but
 * only those listed in MCP_PROVIDERS are registered with the router.
 * Unregistered providers continue to flow through the legacy
 * IntegrationToolExecutor.
 *
 * Use MCP_PROVIDERS=slack,jira to enable a subset, or MCP_PROVIDERS=* for all.
 */
const PROVIDER_REGISTRATIONS: ReadonlyArray<{
  namespace: string;
  token: new (...args: never[]) => McpServerBase;
}> = [
  { namespace: 'slack', token: SlackMcpServer },
  { namespace: 'jira', token: JiraMcpServer },
  { namespace: 'notion', token: NotionMcpServer },
  { namespace: 'gdrive', token: GDriveMcpServer },
  { namespace: 'gcal', token: GCalMcpServer },
  { namespace: 'gmail', token: GmailMcpServer },
  { namespace: 'hubspot', token: HubSpotMcpServer },
  { namespace: 'salesforce', token: SalesforceMcpServer },
  { namespace: 'taurus', token: TaurusMcpServer },
];

@Module({
  imports: [IntegrationsModule],
  providers: [
    McpServerFactory,
    TaurusContextService,
    SlackMcpServer,
    JiraMcpServer,
    NotionMcpServer,
    GDriveMcpServer,
    GCalMcpServer,
    GmailMcpServer,
    HubSpotMcpServer,
    SalesforceMcpServer,
    TaurusMcpServer,
    {
      provide: MCP_SERVERS,
      inject: [
        ConfigService,
        SlackMcpServer,
        JiraMcpServer,
        NotionMcpServer,
        GDriveMcpServer,
        GCalMcpServer,
        GmailMcpServer,
        HubSpotMcpServer,
        SalesforceMcpServer,
        TaurusMcpServer,
      ],
      useFactory: (
        config: ConfigService,
        slack: SlackMcpServer,
        jira: JiraMcpServer,
        notion: NotionMcpServer,
        gdrive: GDriveMcpServer,
        gcal: GCalMcpServer,
        gmail: GmailMcpServer,
        hubspot: HubSpotMcpServer,
        salesforce: SalesforceMcpServer,
        taurus: TaurusMcpServer,
      ): McpServerBase[] => {
        const enabled = config.get<string[]>('mcp.providers') ?? [];
        const wantsAll = enabled.includes('*');
        const isOn = (ns: string) => wantsAll || enabled.includes(ns);
        const instances: Record<string, McpServerBase> = {
          slack,
          jira,
          notion,
          gdrive,
          gcal,
          gmail,
          hubspot,
          salesforce,
          taurus,
        };
        return PROVIDER_REGISTRATIONS.filter((p) => isOn(p.namespace)).map(
          (p) => instances[p.namespace],
        );
      },
    },
    McpToolRouter,
  ],
  exports: [McpToolRouter, TaurusContextService],
})
export class McpModule {}
