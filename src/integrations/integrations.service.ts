import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import { getProviderConfig } from './oauth-providers';

/**
 * Translate provider error strings (or raw error bodies) into user-actionable
 * messages. Most common case: an OAuth app is in development / single-workspace
 * mode in the provider's developer dashboard, so end users can't install it
 * into their own workspace. Falls back to null for callers to show a generic
 * message.
 */
function translateOAuthError(
  provider: IntegrationProvider,
  raw: string,
): string | null {
  const text = raw.toLowerCase();
  // Provider-specific "app is not distributed / not approved for your workspace"
  if (
    text.includes('invalid_team_for_non_distributed_app') ||
    text.includes('access_denied') ||
    text.includes('not_distributed')
  ) {
    return `${provider} hasn't been published for installation in other workspaces yet — the workspace admin needs to enable distribution in the ${provider} app settings.`;
  }
  if (provider === 'NOTION' && text.includes('unauthorized')) {
    return 'This Notion integration is set to "Internal" — switch it to "Public" in your Notion integration settings so other workspaces can install it.';
  }
  if (
    provider === 'GOOGLE_DRIVE' &&
    (text.includes('access_denied') || text.includes('admin_policy_enforced'))
  ) {
    return 'Google blocked this connection — either the OAuth consent screen is still in "Testing" mode or your domain admin disallows third-party apps.';
  }
  if (text.includes('invalid_grant')) {
    return `Authorization code was already used or expired — please retry connecting ${provider}.`;
  }
  return null;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  // ── List connections ───────────────────────────────────

  async listConnections(organizationId: string) {
    return this.prisma.integrationConnection.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        status: true,
        externalTeamName: true,
        scope: true,
        connectedAt: true,
        connectedBy: true,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { connectedAt: 'desc' },
    });
  }

  // ── Get authorize URL ──────────────────────────────────

  getAuthorizeUrl(
    provider: IntegrationProvider,
    redirectUri: string,
    state: string,
  ): string {
    const providerConfig = getProviderConfig(provider);
    if (!providerConfig) {
      throw new BadRequestException(
        `OAuth not supported for provider: ${provider}`,
      );
    }

    const clientId = this.config.get<string>(
      `integrations.${provider.toLowerCase()}.clientId`,
    );

    if (!clientId) {
      throw new BadRequestException(
        `${provider} integration is not configured — missing client ID`,
      );
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });

    // Provider-specific params
    if (provider === 'SLACK') {
      params.set('scope', providerConfig.scopes.join(','));
    } else if (provider === 'GOOGLE_DRIVE') {
      params.set('scope', providerConfig.scopes.join(' '));
      params.set('access_type', 'offline');
      params.set('prompt', 'consent');
    } else if (provider === 'JIRA') {
      params.set('scope', providerConfig.scopes.join(' '));
      params.set('audience', 'api.atlassian.com');
      params.set('prompt', 'consent');
    } else {
      params.set('scope', providerConfig.scopes.join(' '));
    }

    return `${providerConfig.authorizeUrl}?${params.toString()}`;
  }

  // ── Exchange code for tokens ───────────────────────────

  async connect(
    provider: IntegrationProvider,
    code: string,
    redirectUri: string,
    organizationId: string,
    userId: string,
  ) {
    const providerConfig = getProviderConfig(provider);
    if (!providerConfig) {
      throw new BadRequestException(
        `OAuth not supported for provider: ${provider}`,
      );
    }

    const clientId = this.config.get<string>(
      `integrations.${provider.toLowerCase()}.clientId`,
    );
    const clientSecret = this.config.get<string>(
      `integrations.${provider.toLowerCase()}.clientSecret`,
    );

    if (!clientId || !clientSecret) {
      throw new BadRequestException(
        `${provider} integration is not configured`,
      );
    }

    // Exchange code for tokens
    const tokenData = await this.exchangeCode(
      provider,
      providerConfig.tokenUrl,
      code,
      clientId,
      clientSecret,
      redirectUri,
    );

    // Guard against silent failures (e.g. Slack returns HTTP 200 with ok:false
    // and no access_token, which would otherwise persist a broken CONNECTED row).
    if (!tokenData.accessToken) {
      throw new BadRequestException(
        `${provider} connection failed — provider returned no access token. Please retry.`,
      );
    }

    // Upsert the connection (one per org per provider)
    const connection = await this.prisma.integrationConnection.upsert({
      where: {
        organizationId_provider: { organizationId, provider },
      },
      update: {
        status: 'CONNECTED',
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken ?? null,
        tokenExpiresAt: tokenData.expiresAt ?? null,
        scope: tokenData.scope ?? null,
        externalTeamId: tokenData.teamId ?? null,
        externalTeamName: tokenData.teamName ?? null,
        metadata: (tokenData.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        connectedBy: userId,
        connectedAt: new Date(),
        disconnectedAt: null,
      },
      create: {
        organizationId,
        provider,
        status: 'CONNECTED',
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken ?? null,
        tokenExpiresAt: tokenData.expiresAt ?? null,
        scope: tokenData.scope ?? null,
        externalTeamId: tokenData.teamId ?? null,
        externalTeamName: tokenData.teamName ?? null,
        metadata: (tokenData.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        connectedBy: userId,
      },
    });

    this.logger.log(
      `${provider} connected for org ${organizationId} by user ${userId}`,
    );

    return {
      id: connection.id,
      provider: connection.provider,
      status: connection.status,
      externalTeamName: connection.externalTeamName,
      connectedAt: connection.connectedAt,
    };
  }

  // ── Disconnect ─────────────────────────────────────────

  async disconnect(
    id: string,
    organizationId: string,
  ) {
    const connection = await this.prisma.integrationConnection.findFirst({
      where: { id, organizationId },
    });

    if (!connection) {
      throw new NotFoundException('Integration connection not found');
    }

    await this.prisma.integrationConnection.update({
      where: { id },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        accessToken: '',
        refreshToken: null,
      },
    });

    this.logger.log(
      `${connection.provider} disconnected for org ${organizationId}`,
    );

    return { id, disconnected: true };
  }

  // ── Token exchange per provider ────────────────────────

  private async exchangeCode(
    provider: IntegrationProvider,
    tokenUrl: string,
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    scope?: string;
    teamId?: string;
    teamName?: string;
    metadata?: Record<string, unknown>;
  }> {
    let body: string;
    const headers: Record<string, string> = {};

    if (provider === 'NOTION') {
      // Notion uses Basic Auth for token exchange
      const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString();
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `Token exchange failed for ${provider}: ${response.status} ${errorText}`,
      );
      throw new BadRequestException(
        translateOAuthError(provider, errorText) ??
          `Failed to connect ${provider} — invalid or expired authorization code`,
      );
    }

    const data = await response.json();

    // Normalize the response per provider
    return this.normalizeTokenResponse(provider, data);
  }

  private normalizeTokenResponse(
    provider: IntegrationProvider,
    data: Record<string, unknown>,
  ) {
    switch (provider) {
      case 'SLACK': {
        // Slack always returns HTTP 200; errors surface as { ok: false, error }.
        if (data.ok === false) {
          this.logger.error(
            `Slack OAuth returned ok:false: ${JSON.stringify(data).slice(0, 300)}`,
          );
          const code = (data.error as string) || 'unknown error';
          throw new BadRequestException(
            translateOAuthError('SLACK', code) ?? `Slack OAuth failed: ${code}`,
          );
        }
        const authedUser = data.authed_user as Record<string, unknown> | undefined;
        const accessToken =
          (data.access_token as string) || (authedUser?.access_token as string) || '';
        if (!accessToken) {
          this.logger.error(
            `Slack OAuth response missing access_token. Keys present: ${Object.keys(data).join(', ')}. authed_user keys: ${
              authedUser ? Object.keys(authedUser).join(', ') : '(none)'
            }`,
          );
        }
        return {
          accessToken,
          refreshToken: data.refresh_token as string | undefined,
          scope: data.scope as string | undefined,
          teamId: (data.team as Record<string, unknown>)?.id as string | undefined,
          teamName: (data.team as Record<string, unknown>)?.name as string | undefined,
          metadata: { botUserId: data.bot_user_id, appId: data.app_id },
        };
      }

      case 'GOOGLE_DRIVE': {
        const expiresIn = data.expires_in as number | undefined;
        return {
          accessToken: data.access_token as string,
          refreshToken: data.refresh_token as string | undefined,
          expiresAt: expiresIn
            ? new Date(Date.now() + expiresIn * 1000)
            : undefined,
          scope: data.scope as string | undefined,
        };
      }

      case 'NOTION': {
        return {
          accessToken: data.access_token as string,
          teamId: (data.workspace_id as string) || undefined,
          teamName: (data.workspace_name as string) || undefined,
          metadata: { botId: data.bot_id, owner: data.owner },
        };
      }

      default: {
        const expiresIn = data.expires_in as number | undefined;
        return {
          accessToken: data.access_token as string,
          refreshToken: data.refresh_token as string | undefined,
          expiresAt: expiresIn
            ? new Date(Date.now() + expiresIn * 1000)
            : undefined,
          scope: data.scope as string | undefined,
        };
      }
    }
  }
}
