import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { TokenManager, RefreshResult } from './token-manager';

@Injectable()
export class SalesforceService implements OnModuleInit {
  private readonly logger = new Logger(SalesforceService.name);

  constructor(
    private prisma: PrismaService,
    private tokenManager: TokenManager,
  ) {}

  onModuleInit() {
    this.tokenManager.registerStrategy('SALESFORCE', async (refreshToken, connection) => {
      const metadata = (connection.metadata as { instance_url?: string } | null) ?? null;
      const instanceUrl = metadata?.instance_url;
      if (!instanceUrl) {
        throw new Error('Salesforce connection is missing instance_url');
      }

      const response = await fetch(`${instanceUrl}/services/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.SALESFORCE_CLIENT_ID || '',
          client_secret: process.env.SALESFORCE_CLIENT_SECRET || '',
          refresh_token: refreshToken,
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        instance_url?: string;
        id?: string;
        issued_at?: string;
        expires_in?: number;
        refresh_token?: string;
      };

      // Real session timeout: prefer the rare expires_in in the response,
      // else the org's configured session_timeout_seconds via the identity
      // endpoint (data.id), else fall back to 2h. The hardcoded 7200s in the
      // old code broke any org with a shorter (or longer) configured timeout.
      let expiresInSeconds = data.expires_in;
      let sessionTimeoutSeconds: number | undefined;
      if (!expiresInSeconds && data.id) {
        sessionTimeoutSeconds = await this.fetchSessionTimeout(
          data.id,
          data.access_token,
        );
        if (sessionTimeoutSeconds) expiresInSeconds = sessionTimeoutSeconds;
      }
      if (!expiresInSeconds) expiresInSeconds = 7200;

      const result: RefreshResult = {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      };
      if (data.refresh_token) result.refreshToken = data.refresh_token;

      const metaUpdates: Record<string, unknown> = {};
      if (data.instance_url) metaUpdates.instance_url = data.instance_url;
      if (sessionTimeoutSeconds) metaUpdates.session_timeout_seconds = sessionTimeoutSeconds;
      if (Object.keys(metaUpdates).length) result.metadata = metaUpdates;

      return result;
    });
  }

  /**
   * Call the Salesforce identity endpoint (returned as `id` in the refresh
   * response) to read the org's configured session_timeout_seconds. Returns
   * undefined on any error so the caller can fall back to its default.
   */
  private async fetchSessionTimeout(
    identityUrl: string,
    accessToken: string,
  ): Promise<number | undefined> {
    try {
      const response = await fetch(`${identityUrl}?version=latest`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return undefined;
      const data = (await response.json()) as { session_timeout_seconds?: number };
      return typeof data.session_timeout_seconds === 'number'
        ? data.session_timeout_seconds
        : undefined;
    } catch (error) {
      this.logger.warn(
        `Salesforce identity-endpoint lookup failed: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  // ── Records ────────────────────────────────────────────

  /** Create any Salesforce object (Account, Contact, Lead, Opportunity, etc.) */
  async createRecord(
    organizationId: string,
    objectType: string,
    fields: Record<string, unknown>,
  ) {
    const response = await this.callSf(
      organizationId, 'POST', `/services/data/v59.0/sobjects/${objectType}`, fields,
    );

    this.logger.log(`Created Salesforce ${objectType} ${response.id} for org ${organizationId}`);
    return { id: response.id, success: response.success };
  }

  /** Update a Salesforce record */
  async updateRecord(
    organizationId: string,
    objectType: string,
    recordId: string,
    fields: Record<string, unknown>,
  ) {
    await this.callSf(
      organizationId, 'PATCH',
      `/services/data/v59.0/sobjects/${objectType}/${recordId}`, fields,
    );

    return { id: recordId, updated: true };
  }

  /** Query records using SOQL */
  async query(organizationId: string, soql: string) {
    const response = await this.callSf(
      organizationId, 'GET',
      `/services/data/v59.0/query?q=${encodeURIComponent(soql)}`,
    );

    return {
      totalSize: response.totalSize,
      records: response.records,
    };
  }

  // ── Common Shortcuts ───────────────────────────────────

  async createAccount(
    organizationId: string,
    opts: { name: string; website?: string; industry?: string; phone?: string },
  ) {
    return this.createRecord(organizationId, 'Account', {
      Name: opts.name,
      ...(opts.website && { Website: opts.website }),
      ...(opts.industry && { Industry: opts.industry }),
      ...(opts.phone && { Phone: opts.phone }),
    });
  }

  async createContact(
    organizationId: string,
    opts: { firstName: string; lastName: string; email: string; accountId?: string; title?: string },
  ) {
    return this.createRecord(organizationId, 'Contact', {
      FirstName: opts.firstName,
      LastName: opts.lastName,
      Email: opts.email,
      ...(opts.accountId && { AccountId: opts.accountId }),
      ...(opts.title && { Title: opts.title }),
    });
  }

  async createOpportunity(
    organizationId: string,
    opts: { name: string; stageName: string; closeDate: string; amount?: number; accountId?: string },
  ) {
    return this.createRecord(organizationId, 'Opportunity', {
      Name: opts.name,
      StageName: opts.stageName,
      CloseDate: opts.closeDate,
      ...(opts.amount !== undefined && { Amount: opts.amount }),
      ...(opts.accountId && { AccountId: opts.accountId }),
    });
  }

  async createLead(
    organizationId: string,
    opts: { firstName: string; lastName: string; company: string; email?: string; status?: string },
  ) {
    return this.createRecord(organizationId, 'Lead', {
      FirstName: opts.firstName,
      LastName: opts.lastName,
      Company: opts.company,
      ...(opts.email && { Email: opts.email }),
      Status: opts.status || 'Open - Not Contacted',
    });
  }

  // ── Connection + Request ───────────────────────────────

  private async callSf(
    organizationId: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'SALESFORCE' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('Salesforce is not connected');
    }

    const metadata = connection.metadata as { instance_url?: string } | null;
    const instanceUrl = metadata?.instance_url;
    if (!instanceUrl) {
      throw new BadRequestException(
        'Salesforce connection is missing instance_url — please disconnect and reconnect',
      );
    }

    const response = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch(`${instanceUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
      (res) => res.status === 401,
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Salesforce API error (${method} ${path}): ${response.status} ${error}`);
      throw new BadRequestException(`Salesforce API error: ${response.status}`);
    }

    if (response.status === 204 || response.status === 201) {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }
    return response.json();
  }
}
