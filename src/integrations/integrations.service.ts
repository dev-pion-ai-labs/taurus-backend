import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma';
import { CredentialVaultService } from './credential-vault.service';
import { AuditLogService } from './audit-log.service';
import { AuthType, IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { ConnectApiKeyDto } from './dto';
import { DeploymentAdapter } from './adapters/base.adapter';
import { DEPLOYMENT_ADAPTERS } from './adapters/base.adapter';

/** Per-provider OAuth config. Populated when provider adapters register. */
export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  callbackPath: string;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  /** Registered OAuth configs, keyed by provider */
  private oauthConfigs = new Map<IntegrationProvider, OAuthProviderConfig>();

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private credentialVault: CredentialVaultService,
    private auditLog: AuditLogService,
    @Inject(DEPLOYMENT_ADAPTERS)
    private adapters: Map<IntegrationProvider, DeploymentAdapter>,
  ) {}

  // ─── OAuth Config Registry ────────────────────────────

  registerOAuthProvider(provider: IntegrationProvider, config: OAuthProviderConfig) {
    this.oauthConfigs.set(provider, config);
    this.logger.log(`Registered OAuth config for ${provider}`);
  }

  // ─── OAuth Flow ───────────────────────────────────────

  getOAuthRedirectUrl(provider: IntegrationProvider, orgId: string): string {
    const config = this.oauthConfigs.get(provider);
    if (!config) {
      throw new BadRequestException(
        `OAuth is not configured for provider: ${provider}`,
      );
    }

    const appUrl = this.configService.get<string>('app.corsOrigin');
    const backendPort = this.configService.get<number>('app.port');
    const callbackUrl = `http://localhost:${backendPort}/api/v1${config.callbackPath}`;

    // State contains orgId so we can associate on callback
    const state = Buffer.from(JSON.stringify({ orgId })).toString('base64url');

    const params = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scopes.join(' '),
      redirect_uri: callbackUrl,
      response_type: 'code',
      state,
    });

    return `${config.authorizeUrl}?${params.toString()}`;
  }

  async handleOAuthCallback(
    provider: IntegrationProvider,
    code: string,
    state: string,
  ) {
    const config = this.oauthConfigs.get(provider);
    if (!config) {
      throw new BadRequestException(
        `OAuth is not configured for provider: ${provider}`,
      );
    }

    // Decode state to get orgId
    let orgId: string;
    try {
      const parsed = JSON.parse(
        Buffer.from(state, 'base64url').toString('utf8'),
      );
      orgId = parsed.orgId;
    } catch {
      throw new BadRequestException('Invalid OAuth state parameter');
    }

    // Exchange authorization code for tokens
    const backendPort = this.configService.get<number>('app.port');
    const callbackUrl = `http://localhost:${backendPort}/api/v1${config.callbackPath}`;

    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text();
      this.logger.error(`OAuth token exchange failed for ${provider}: ${errorBody}`);
      throw new BadRequestException('OAuth token exchange failed');
    }

    const tokenData = await tokenResponse.json();

    // Store encrypted credentials
    const credentials = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      extra: tokenData,
    };

    // Calculate expiry
    let expiresAt: Date | undefined;
    if (tokenData.expires_in) {
      expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    }

    const integration = await this.credentialVault.store(
      orgId,
      provider,
      AuthType.OAUTH2,
      credentials,
      config.scopes,
      {
        expiresAt,
        metadata: {
          team_id: tokenData.team?.id,
          team_name: tokenData.team?.name,
          bot_user_id: tokenData.bot_user_id,
        },
      },
    );

    this.logger.log(`OAuth connection stored for ${provider}, org ${orgId}`);
    return integration;
  }

  // ─── API Key Connection ───────────────────────────────

  async connectApiKey(orgId: string, dto: ConnectApiKeyDto) {
    const credentials = { apiKey: dto.apiKey };

    return this.credentialVault.store(
      orgId,
      dto.provider,
      AuthType.API_KEY,
      credentials,
      dto.scopes ?? [],
      { label: dto.label },
    );
  }

  // ─── CRUD ─────────────────────────────────────────────

  async listIntegrations(orgId: string) {
    return this.credentialVault.listByOrganization(orgId);
  }

  async testConnection(integrationId: string) {
    try {
      const { provider, credentials } =
        await this.credentialVault.retrieveById(integrationId);

      // Use provider adapter if available for a real connection test
      const adapter = this.adapters.get(provider);
      if (adapter) {
        return adapter.testConnection(credentials);
      }

      // Fallback: just verify credentials are readable
      const hasToken = !!(
        credentials.accessToken ||
        credentials.apiKey ||
        credentials.bearerToken
      );

      return {
        success: hasToken,
        message: hasToken
          ? 'Credentials are readable and present'
          : 'No valid credentials found',
      };
    } catch {
      return {
        success: false,
        message: 'Failed to read credentials',
      };
    }
  }

  async disconnect(integrationId: string, orgId: string) {
    // Verify it belongs to the org
    const integration = await this.prisma.orgIntegration.findFirst({
      where: { id: integrationId, organizationId: orgId },
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    return this.credentialVault.revoke(integrationId);
  }

  // ─── Audit Logs ───────────────────────────────────────

  async getAuditLogs(orgId: string) {
    return this.auditLog.getByOrganization(orgId);
  }

  async getIntegrationAuditLogs(integrationId: string) {
    return this.auditLog.getByIntegration(integrationId);
  }
}
