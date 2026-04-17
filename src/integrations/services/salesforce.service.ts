import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class SalesforceService {
  private readonly logger = new Logger(SalesforceService.name);

  constructor(private prisma: PrismaService) {}

  // ── Records ────────────────────────────────────────────

  /** Create any Salesforce object (Account, Contact, Lead, Opportunity, etc.) */
  async createRecord(
    organizationId: string,
    objectType: string,
    fields: Record<string, unknown>,
  ) {
    const { token, instanceUrl } = await this.getConnection(organizationId);

    const response = await this.request(
      token, instanceUrl, 'POST', `/services/data/v59.0/sobjects/${objectType}`, fields,
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
    const { token, instanceUrl } = await this.getConnection(organizationId);

    await this.request(
      token, instanceUrl, 'PATCH',
      `/services/data/v59.0/sobjects/${objectType}/${recordId}`, fields,
    );

    return { id: recordId, updated: true };
  }

  /** Query records using SOQL */
  async query(organizationId: string, soql: string) {
    const { token, instanceUrl } = await this.getConnection(organizationId);

    const response = await this.request(
      token, instanceUrl, 'GET',
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

  private async getConnection(organizationId: string) {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'SALESFORCE' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('Salesforce is not connected');
    }

    // Instance URL is stored in metadata during OAuth
    const metadata = connection.metadata as { instance_url?: string } | null;
    const instanceUrl = metadata?.instance_url || 'https://login.salesforce.com';

    // Refresh if expired
    if (connection.tokenExpiresAt && new Date() >= connection.tokenExpiresAt && connection.refreshToken) {
      const newToken = await this.refreshToken(connection.id, connection.refreshToken, instanceUrl);
      return { token: newToken, instanceUrl };
    }

    return { token: connection.accessToken, instanceUrl };
  }

  private async refreshToken(connectionId: string, refreshToken: string, instanceUrl: string): Promise<string> {
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

    if (!response.ok) throw new BadRequestException('Salesforce token refresh failed — reconnect');

    const data = (await response.json()) as { access_token: string };

    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt: new Date(Date.now() + 7200 * 1000), // SF tokens ~2hr
      },
    });

    return data.access_token;
  }

  private async request(token: string, instanceUrl: string, method: string, path: string, body?: unknown) {
    const response = await fetch(`${instanceUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

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
