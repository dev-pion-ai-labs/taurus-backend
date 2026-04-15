import type { DeploymentAdapter } from './base.adapter';
import type {
  DecryptedCredentials,
  ConnectionTestResult,
  Resource,
  DryRunResult,
  ExecutionResult,
  RollbackResult,
} from './types';
import { IntegrationProvider } from '@prisma/client';

/**
 * Adapter contract test suite.
 *
 * This verifies that the DeploymentAdapter interface is well-formed
 * and that a conforming implementation satisfies the contract.
 * When building a real adapter (e.g., SlackAdapter in Phase 1),
 * run these same assertions against it.
 */
describe('DeploymentAdapter contract', () => {
  const mockCredentials: DecryptedCredentials = {
    accessToken: 'test-token',
  };

  // Create a minimal mock adapter that conforms to the interface
  const createMockAdapter = (): DeploymentAdapter => ({
    provider: IntegrationProvider.SLACK,

    async testConnection(): Promise<ConnectionTestResult> {
      return { success: true, message: 'Connected to workspace' };
    },

    async listResources(
      _credentials: DecryptedCredentials,
      type: string,
    ): Promise<Resource[]> {
      return [{ id: '1', type, name: 'test-resource' }];
    },

    async getResource(
      _credentials: DecryptedCredentials,
      type: string,
      id: string,
    ): Promise<Resource> {
      return { id, type, name: 'test-resource' };
    },

    async dryRun(): Promise<DryRunResult> {
      return {
        valid: true,
        preview: 'Will create #test-channel',
        warnings: [],
      };
    },

    async execute(): Promise<ExecutionResult> {
      return {
        success: true,
        resourceId: 'C12345',
        rollbackData: { channelId: 'C12345' },
      };
    },

    async rollback(): Promise<RollbackResult> {
      return { success: true, message: 'Channel archived' };
    },
  });

  let adapter: DeploymentAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
  });

  it('should have a provider property', () => {
    expect(adapter.provider).toBeDefined();
    expect(
      Object.values(IntegrationProvider).includes(adapter.provider),
    ).toBe(true);
  });

  it('testConnection should return success boolean and message', async () => {
    const result = await adapter.testConnection(mockCredentials);
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.message).toBe('string');
  });

  it('listResources should return an array of Resource objects', async () => {
    const resources = await adapter.listResources(
      mockCredentials,
      'channels',
    );
    expect(Array.isArray(resources)).toBe(true);
    for (const r of resources) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('type');
      expect(r).toHaveProperty('name');
    }
  });

  it('getResource should return a single Resource', async () => {
    const resource = await adapter.getResource(
      mockCredentials,
      'channels',
      '1',
    );
    expect(resource).toHaveProperty('id', '1');
    expect(resource).toHaveProperty('type', 'channels');
    expect(resource).toHaveProperty('name');
  });

  it('dryRun should return valid boolean, preview, and warnings', async () => {
    const result = await adapter.dryRun(mockCredentials, {
      type: 'create_channel',
      provider: IntegrationProvider.SLACK,
      params: { name: 'test-channel' },
    });
    expect(typeof result.valid).toBe('boolean');
    expect(typeof result.preview).toBe('string');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('execute should return success boolean and rollbackData', async () => {
    const result = await adapter.execute(mockCredentials, {
      type: 'create_channel',
      provider: IntegrationProvider.SLACK,
      params: { name: 'test-channel' },
    });
    expect(typeof result.success).toBe('boolean');
    expect(result.rollbackData).toBeDefined();
    expect(typeof result.rollbackData).toBe('object');
  });

  it('rollback should return success boolean and message', async () => {
    const result = await adapter.rollback(
      mockCredentials,
      'audit-log-123',
      { channelId: 'C12345' },
    );
    expect(typeof result.success).toBe('boolean');
    expect(typeof result.message).toBe('string');
  });
});
