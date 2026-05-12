import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { IntegrationConnection, IntegrationProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma';
import { decryptToken, encryptToken } from '../crypto.util';

/**
 * Result a per-provider refresh strategy must return so TokenManager can
 * persist the rotated material centrally (encrypted, with the right expiry).
 */
export interface RefreshResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  metadata?: Record<string, unknown>;
}

export type RefreshStrategy = (
  refreshToken: string,
  connection: IntegrationConnection,
) => Promise<RefreshResult>;

/**
 * Buffer applied before tokenExpiresAt — refresh kicks in this many ms early
 * so a request started just before nominal expiry doesn't fail mid-flight.
 */
const EXPIRY_BUFFER_MS = 60 * 1000;

/**
 * Single source of truth for "give me a usable access token for this
 * integration connection." Solves four problems the per-provider services
 * each had to half-solve:
 *
 *   1. Refresh fires with a 60s buffer, not at-or-after nominal expiry.
 *   2. Per-connection single-flight: parallel callers for the same
 *      connection share one refresh promise. Critical for HubSpot/Jira
 *      which rotate the refresh token — without this, the second concurrent
 *      refresh invalidates the first's rotated refresh_token.
 *   3. withFreshToken() retries once on auth-error, so clock skew or
 *      server-side revocation self-heals instead of hard-failing.
 *   4. Refresh writes go through one chokepoint that always encrypts and
 *      always sets a real expiry (no hardcoded 2h fallbacks).
 */
@Injectable()
export class TokenManager {
  private readonly logger = new Logger(TokenManager.name);
  private readonly inflight = new Map<string, Promise<string>>();
  private readonly strategies = new Map<IntegrationProvider, RefreshStrategy>();

  constructor(private prisma: PrismaService) {}

  registerStrategy(provider: IntegrationProvider, strategy: RefreshStrategy): void {
    this.strategies.set(provider, strategy);
  }

  /**
   * Return a decrypted access token that's safe to use right now. Refreshes
   * if the stored token is within EXPIRY_BUFFER_MS of expiry. Throws
   * BadRequestException if no refresh strategy is registered for a provider
   * whose token is expiring.
   */
  async getAccessToken(connection: IntegrationConnection): Promise<string> {
    if (!this.isNearExpiry(connection)) {
      return decryptToken(connection.accessToken) as string;
    }

    if (!connection.refreshToken) {
      throw new BadRequestException(
        `${connection.provider} token expired and no refresh token available — please reconnect`,
      );
    }

    return this.runRefresh(connection);
  }

  /**
   * Run `fn(token)` against the connection, and if the result indicates an
   * auth error (per isAuthError), force a refresh and retry exactly once.
   * The retry path bypasses the expiry-buffer check so server-side
   * revocation / clock skew also recovers.
   */
  async withFreshToken<T>(
    connection: IntegrationConnection,
    fn: (token: string) => Promise<T>,
    isAuthError: (result: T) => boolean,
  ): Promise<T> {
    const token = await this.getAccessToken(connection);
    const first = await fn(token);

    if (!isAuthError(first)) return first;

    if (!connection.refreshToken) {
      await this.markExpired(connection.id);
      return first;
    }

    this.logger.log(
      `${connection.provider} returned auth error for connection ${connection.id} — refreshing and retrying`,
    );

    let freshToken: string;
    try {
      freshToken = await this.forceRefresh(connection);
    } catch (error) {
      this.logger.error(
        `${connection.provider} refresh-after-401 failed for ${connection.id}: ${(error as Error).message}`,
      );
      return first;
    }

    return fn(freshToken);
  }

  /**
   * Mark a connection as EXPIRED. Provider services call this when a
   * non-recoverable auth state is detected (e.g. Slack invalid_auth on a
   * non-rotating token).
   */
  async markExpired(connectionId: string): Promise<void> {
    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: { status: 'EXPIRED' },
    });
  }

  private isNearExpiry(connection: IntegrationConnection): boolean {
    if (!connection.tokenExpiresAt) return false;
    return connection.tokenExpiresAt.getTime() <= Date.now() + EXPIRY_BUFFER_MS;
  }

  private async runRefresh(connection: IntegrationConnection): Promise<string> {
    const existing = this.inflight.get(connection.id);
    if (existing) return existing;

    const promise = this.doRefresh(connection).finally(() => {
      this.inflight.delete(connection.id);
    });
    this.inflight.set(connection.id, promise);
    return promise;
  }

  private async forceRefresh(connection: IntegrationConnection): Promise<string> {
    const fresh = await this.prisma.integrationConnection.findUnique({
      where: { id: connection.id },
    });
    if (!fresh) {
      throw new BadRequestException(
        `${connection.provider} connection ${connection.id} disappeared mid-refresh`,
      );
    }
    return this.runRefresh(fresh);
  }

  private async doRefresh(connection: IntegrationConnection): Promise<string> {
    const strategy = this.strategies.get(connection.provider);
    if (!strategy) {
      throw new BadRequestException(
        `No refresh strategy registered for ${connection.provider}`,
      );
    }

    const refreshTokenPlain = decryptToken(connection.refreshToken);
    if (!refreshTokenPlain) {
      throw new BadRequestException(
        `${connection.provider} has no refresh token — please reconnect`,
      );
    }

    let result: RefreshResult;
    try {
      result = await strategy(refreshTokenPlain, connection);
    } catch (error) {
      await this.markExpired(connection.id);
      this.logger.error(
        `${connection.provider} refresh failed for ${connection.id}: ${(error as Error).message}`,
      );
      throw new BadRequestException(
        `${connection.provider} token refresh failed — please reconnect`,
      );
    }

    await this.prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: encryptToken(result.accessToken) as string,
        ...(result.refreshToken && {
          refreshToken: encryptToken(result.refreshToken),
        }),
        tokenExpiresAt: result.expiresAt,
        ...(result.metadata && {
          metadata: {
            ...((connection.metadata as Prisma.JsonObject) ?? {}),
            ...result.metadata,
          } as Prisma.InputJsonValue,
        }),
        status: 'CONNECTED',
      },
    });

    this.logger.log(
      `Refreshed ${connection.provider} token for connection ${connection.id}`,
    );
    return result.accessToken;
  }
}
