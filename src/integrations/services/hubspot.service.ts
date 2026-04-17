import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class HubSpotService {
  private readonly logger = new Logger(HubSpotService.name);
  private readonly API = 'https://api.hubapi.com';

  constructor(private prisma: PrismaService) {}

  // ── Contacts ───────────────────────────────────────────

  async createContact(
    organizationId: string,
    opts: {
      email: string;
      firstName?: string;
      lastName?: string;
      company?: string;
      phone?: string;
      jobTitle?: string;
      properties?: Record<string, string>;
    },
  ) {
    const token = await this.getToken(organizationId);

    const properties: Record<string, string> = {
      email: opts.email,
      ...(opts.firstName && { firstname: opts.firstName }),
      ...(opts.lastName && { lastname: opts.lastName }),
      ...(opts.company && { company: opts.company }),
      ...(opts.phone && { phone: opts.phone }),
      ...(opts.jobTitle && { jobtitle: opts.jobTitle }),
      ...opts.properties,
    };

    const response = await this.request(token, 'POST', '/crm/v3/objects/contacts', { properties });
    this.logger.log(`Created HubSpot contact ${opts.email} for org ${organizationId}`);
    return { id: response.id, properties: response.properties };
  }

  async searchContacts(organizationId: string, query: string) {
    const token = await this.getToken(organizationId);

    const response = await this.request(token, 'POST', '/crm/v3/objects/contacts/search', {
      query,
      limit: 10,
      properties: ['email', 'firstname', 'lastname', 'company', 'jobtitle'],
    });

    return (response.results as { id: string; properties: Record<string, string> }[]).map((c) => ({
      id: c.id,
      ...c.properties,
    }));
  }

  // ── Deals ──────────────────────────────────────────────

  async createDeal(
    organizationId: string,
    opts: {
      name: string;
      stage?: string;
      amount?: number;
      pipeline?: string;
      contactIds?: string[];
      properties?: Record<string, string>;
    },
  ) {
    const token = await this.getToken(organizationId);

    const properties: Record<string, string> = {
      dealname: opts.name,
      ...(opts.stage && { dealstage: opts.stage }),
      ...(opts.amount !== undefined && { amount: String(opts.amount) }),
      ...(opts.pipeline && { pipeline: opts.pipeline }),
      ...opts.properties,
    };

    const response = await this.request(token, 'POST', '/crm/v3/objects/deals', { properties });

    // Associate contacts if provided
    if (opts.contactIds?.length) {
      for (const contactId of opts.contactIds) {
        await this.request(
          token, 'PUT',
          `/crm/v3/objects/deals/${response.id}/associations/contacts/${contactId}/deal_to_contact`,
        );
      }
    }

    this.logger.log(`Created HubSpot deal "${opts.name}" for org ${organizationId}`);
    return { id: response.id, properties: response.properties };
  }

  /** List deal pipelines and stages */
  async listPipelines(organizationId: string) {
    const token = await this.getToken(organizationId);

    const response = await this.request(token, 'GET', '/crm/v3/pipelines/deals');
    return (response.results as {
      id: string;
      label: string;
      stages: { id: string; label: string }[];
    }[]).map((p) => ({
      id: p.id,
      label: p.label,
      stages: p.stages.map((s) => ({ id: s.id, label: s.label })),
    }));
  }

  // ── Companies ──────────────────────────────────────────

  async createCompany(
    organizationId: string,
    opts: {
      name: string;
      domain?: string;
      industry?: string;
      properties?: Record<string, string>;
    },
  ) {
    const token = await this.getToken(organizationId);

    const properties: Record<string, string> = {
      name: opts.name,
      ...(opts.domain && { domain: opts.domain }),
      ...(opts.industry && { industry: opts.industry }),
      ...opts.properties,
    };

    const response = await this.request(token, 'POST', '/crm/v3/objects/companies', { properties });
    this.logger.log(`Created HubSpot company "${opts.name}" for org ${organizationId}`);
    return { id: response.id, properties: response.properties };
  }

  // ── Generic Update ─────────────────────────────────────

  async updateObject(
    organizationId: string,
    objectType: 'contacts' | 'deals' | 'companies',
    objectId: string,
    properties: Record<string, string>,
  ) {
    const token = await this.getToken(organizationId);
    const response = await this.request(token, 'PATCH', `/crm/v3/objects/${objectType}/${objectId}`, {
      properties,
    });
    return { id: response.id, properties: response.properties };
  }

  // ── Connection + Request ───────────────────────────────

  private async getToken(organizationId: string): Promise<string> {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: { organizationId_provider: { organizationId, provider: 'HUBSPOT' } },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException('HubSpot is not connected');
    }

    // Check token expiry and refresh if needed
    if (connection.tokenExpiresAt && new Date() >= connection.tokenExpiresAt && connection.refreshToken) {
      return this.refreshToken(connection.id, connection.refreshToken);
    }

    return connection.accessToken;
  }

  private async refreshToken(connectionId: string, refreshToken: string): Promise<string> {
    const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.HUBSPOT_CLIENT_ID || '',
        client_secret: process.env.HUBSPOT_CLIENT_SECRET || '',
        refresh_token: refreshToken,
      }).toString(),
    });

    if (!response.ok) throw new BadRequestException('HubSpot token refresh failed — reconnect');

    const data = (await response.json()) as { access_token: string; expires_in: number; refresh_token: string };

    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
    });

    return data.access_token;
  }

  private async request(token: string, method: string, path: string, body?: unknown) {
    const response = await fetch(`${this.API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`HubSpot API error (${method} ${path}): ${response.status} ${error}`);
      throw new BadRequestException(`HubSpot API error: ${response.status}`);
    }

    if (response.status === 204) return {};
    return response.json();
  }
}
