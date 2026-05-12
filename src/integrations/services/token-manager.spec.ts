import { BadRequestException } from '@nestjs/common';
import { IntegrationConnection } from '@prisma/client';
import { TokenManager, RefreshResult } from './token-manager';

type PrismaMock = {
  integrationConnection: {
    update: jest.Mock;
    findUnique: jest.Mock;
  };
};

const baseConnection = (
  overrides: Partial<IntegrationConnection> = {},
): IntegrationConnection =>
  ({
    id: 'conn-1',
    organizationId: 'org-1',
    provider: 'JIRA',
    status: 'CONNECTED',
    accessToken: 'access-old',
    refreshToken: 'refresh-token',
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h away
    scope: null,
    externalTeamId: null,
    externalTeamName: null,
    metadata: null,
    connectedBy: 'user-1',
    connectedAt: new Date(),
    disconnectedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as IntegrationConnection;

describe('TokenManager', () => {
  let prisma: PrismaMock;
  let manager: TokenManager;

  beforeEach(() => {
    prisma = {
      integrationConnection: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
    };
    manager = new TokenManager(prisma as unknown as never);
  });

  describe('getAccessToken', () => {
    it('returns the stored token when not near expiry', async () => {
      const strategy = jest.fn();
      manager.registerStrategy('JIRA', strategy);

      const token = await manager.getAccessToken(baseConnection());

      expect(token).toBe('access-old');
      expect(strategy).not.toHaveBeenCalled();
      expect(prisma.integrationConnection.update).not.toHaveBeenCalled();
    });

    it('refreshes when within the 60s expiry buffer', async () => {
      const strategy = jest.fn(
        async (): Promise<RefreshResult> => ({
          accessToken: 'access-new',
          refreshToken: 'refresh-new',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        }),
      );
      manager.registerStrategy('JIRA', strategy);

      const conn = baseConnection({
        tokenExpiresAt: new Date(Date.now() + 30 * 1000), // 30s — inside buffer
      });
      const token = await manager.getAccessToken(conn);

      expect(strategy).toHaveBeenCalledTimes(1);
      expect(token).toBe('access-new');
      expect(prisma.integrationConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conn-1' },
          data: expect.objectContaining({
            accessToken: 'access-new',
            refreshToken: 'refresh-new',
            status: 'CONNECTED',
          }),
        }),
      );
    });

    it('deduplicates concurrent refreshes for the same connection', async () => {
      let resolveStrategy!: (r: RefreshResult) => void;
      const strategy = jest.fn(
        () =>
          new Promise<RefreshResult>((resolve) => {
            resolveStrategy = resolve;
          }),
      );
      manager.registerStrategy('JIRA', strategy);

      const conn = baseConnection({
        tokenExpiresAt: new Date(Date.now() - 1000), // already expired
      });

      const p1 = manager.getAccessToken(conn);
      const p2 = manager.getAccessToken(conn);

      resolveStrategy({
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const [t1, t2] = await Promise.all([p1, p2]);
      expect(t1).toBe('access-new');
      expect(t2).toBe('access-new');
      expect(strategy).toHaveBeenCalledTimes(1);
    });

    it('throws and marks EXPIRED when refresh strategy fails', async () => {
      const strategy = jest
        .fn<Promise<RefreshResult>, [string, IntegrationConnection]>()
        .mockRejectedValue(new Error('boom'));
      manager.registerStrategy('JIRA', strategy);

      const conn = baseConnection({
        tokenExpiresAt: new Date(Date.now() - 1000),
      });

      await expect(manager.getAccessToken(conn)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.integrationConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { status: 'EXPIRED' },
      });
    });

    it('throws if no refresh token is available', async () => {
      manager.registerStrategy('JIRA', jest.fn());

      const conn = baseConnection({
        tokenExpiresAt: new Date(Date.now() - 1000),
        refreshToken: null,
      });

      await expect(manager.getAccessToken(conn)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('withFreshToken', () => {
    it('returns the first result when it is not an auth error', async () => {
      const fn = jest.fn().mockResolvedValue({ ok: true });
      const result = await manager.withFreshToken(
        baseConnection(),
        fn,
        () => false,
      );

      expect(result).toEqual({ ok: true });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('refreshes and retries once on auth error', async () => {
      manager.registerStrategy('JIRA', async () => ({
        accessToken: 'access-new',
        refreshToken: 'refresh-new',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      }));

      const conn = baseConnection();
      prisma.integrationConnection.findUnique.mockResolvedValue(conn);

      const fn = jest
        .fn()
        .mockResolvedValueOnce({ status: 401 })
        .mockResolvedValueOnce({ status: 200, ok: true });

      const result = await manager.withFreshToken(
        conn,
        fn,
        (r) => (r as { status: number }).status === 401,
      );

      expect(result).toEqual({ status: 200, ok: true });
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenNthCalledWith(1, 'access-old');
      expect(fn).toHaveBeenNthCalledWith(2, 'access-new');
    });

    it('returns the original auth-error result if refresh also fails', async () => {
      manager.registerStrategy('JIRA', async () => {
        throw new Error('refresh failed');
      });

      const conn = baseConnection();
      prisma.integrationConnection.findUnique.mockResolvedValue(conn);

      const fn = jest.fn().mockResolvedValue({ status: 401 });

      const result = await manager.withFreshToken(
        conn,
        fn,
        (r) => (r as { status: number }).status === 401,
      );

      expect(result).toEqual({ status: 401 });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(prisma.integrationConnection.update).toHaveBeenCalledWith({
        where: { id: 'conn-1' },
        data: { status: 'EXPIRED' },
      });
    });
  });
});
