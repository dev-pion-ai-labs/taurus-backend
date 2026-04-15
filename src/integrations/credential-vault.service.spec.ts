import { CredentialVaultService } from './credential-vault.service';
import type { DecryptedCredentials } from './adapters';

describe('CredentialVaultService', () => {
  let service: CredentialVaultService;

  beforeEach(() => {
    // Create service with a mock ConfigService and PrismaService
    const mockPrisma = {} as any;
    const mockConfig = {
      get: (key: string) => {
        if (key === 'credential.encryptionKey') {
          return 'test-encryption-key-that-is-long-enough-for-aes256';
        }
        return undefined;
      },
    } as any;

    service = new CredentialVaultService(mockPrisma, mockConfig);
  });

  describe('encrypt / decrypt round-trip', () => {
    it('should encrypt and decrypt OAuth2 credentials', () => {
      const original: DecryptedCredentials = {
        accessToken: 'xoxb-1234567890-abcdefghij',
        refreshToken: 'xoxr-refresh-token-value',
        extra: { team_id: 'T12345', team_name: 'Test Workspace' },
      };

      const encrypted = service.encrypt(original);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toEqual(original);
    });

    it('should encrypt and decrypt API key credentials', () => {
      const original: DecryptedCredentials = {
        apiKey: 'sk-test-api-key-1234567890',
      };

      const encrypted = service.encrypt(original);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toEqual(original);
    });

    it('should encrypt and decrypt bearer token credentials', () => {
      const original: DecryptedCredentials = {
        bearerToken: 'gho_ABCDEFghijklmnop1234567890',
        extra: { installation_id: 12345 },
      };

      const encrypted = service.encrypt(original);
      const decrypted = service.decrypt(encrypted);

      expect(decrypted).toEqual(original);
    });
  });

  describe('encryption output', () => {
    it('should produce different ciphertext for the same input (random IV)', () => {
      const data = { accessToken: 'same-token' };

      const encrypted1 = service.encrypt(data);
      const encrypted2 = service.encrypt(data);

      expect(encrypted1).not.toEqual(encrypted2);
    });

    it('should produce a string in iv:authTag:ciphertext hex format', () => {
      const data = { apiKey: 'test-key' };
      const encrypted = service.encrypt(data);
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3);
      // IV is 16 bytes = 32 hex chars
      expect(parts[0]).toHaveLength(32);
      // Auth tag is 16 bytes = 32 hex chars
      expect(parts[1]).toHaveLength(32);
      // Ciphertext length varies
      expect(parts[2].length).toBeGreaterThan(0);
    });

    it('should not contain any plaintext in the encrypted output', () => {
      const token = 'xoxb-super-secret-token-12345';
      const data = { accessToken: token };
      const encrypted = service.encrypt(data);

      expect(encrypted).not.toContain(token);
      expect(encrypted).not.toContain('accessToken');
    });
  });

  describe('decryption failures', () => {
    it('should throw on tampered ciphertext', () => {
      const data = { apiKey: 'test' };
      const encrypted = service.encrypt(data);
      const parts = encrypted.split(':');

      // Tamper with ciphertext
      const tampered = [parts[0], parts[1], 'ff'.repeat(parts[2].length / 2)].join(':');

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should throw on invalid format', () => {
      expect(() => service.decrypt('not-valid-encrypted-data')).toThrow();
    });

    it('should throw on empty string', () => {
      expect(() => service.decrypt('')).toThrow();
    });
  });

  describe('different keys produce different ciphertext', () => {
    it('should not decrypt with a different key', () => {
      const data = { apiKey: 'test-key' };
      const encrypted = service.encrypt(data);

      // Create a new service with a different key
      const otherService = new CredentialVaultService(
        {} as any,
        {
          get: (key: string) => {
            if (key === 'credential.encryptionKey') {
              return 'completely-different-encryption-key-for-test';
            }
            return undefined;
          },
        } as any,
      );

      expect(() => otherService.decrypt(encrypted)).toThrow();
    });
  });
});
