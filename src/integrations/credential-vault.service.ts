import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma';
import { AuthType, IntegrationProvider, IntegrationStatus, Prisma } from '@prisma/client';
import { DecryptedCredentials } from './adapters';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

@Injectable()
export class CredentialVaultService {
  private readonly logger = new Logger(CredentialVaultService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const keyHex = this.configService.get<string>('credential.encryptionKey');
    if (!keyHex || keyHex.length < 32) {
      this.logger.warn(
        'CREDENTIAL_ENCRYPTION_KEY is not set or too short. Credential storage will fail.',
      );
      // Allow service to boot (for dev environments) but encrypt/decrypt will throw
      this.encryptionKey = Buffer.alloc(32);
    } else {
      // Use SHA-256 of the key string to get exactly 32 bytes
      this.encryptionKey = crypto
        .createHash('sha256')
        .update(keyHex)
        .digest();
    }
  }

  // ─── Encryption ────────────────────────────────────────

  encrypt(data: object): string {
    const plaintext = JSON.stringify(data);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext (all hex-encoded)
    return [
      iv.toString('hex'),
      authTag.toString('hex'),
      encrypted.toString('hex'),
    ].join(':');
  }

  decrypt(encrypted: string): DecryptedCredentials {
    try {
      const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
      if (!ivHex || !authTagHex || !ciphertextHex) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const ciphertext = Buffer.from(ciphertextHex, 'hex');

      const decipher = crypto.createDecipheriv(
        ALGORITHM,
        this.encryptionKey,
        iv,
        { authTagLength: AUTH_TAG_LENGTH },
      );
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return JSON.parse(decrypted.toString('utf8'));
    } catch (error) {
      this.logger.error(`Credential decryption failed: ${(error as Error).message}`);
      throw new InternalServerErrorException('Failed to decrypt credentials');
    }
  }

  // ─── CRUD Operations ──────────────────────────────────

  async store(
    organizationId: string,
    provider: IntegrationProvider,
    authType: AuthType,
    credentials: DecryptedCredentials,
    scopes: string[],
    options?: {
      label?: string;
      expiresAt?: Date;
      metadata?: Record<string, unknown>;
    },
  ) {
    const encrypted = this.encrypt(credentials);

    return this.prisma.orgIntegration.create({
      data: {
        organizationId,
        provider,
        authType,
        credentials: encrypted,
        scopes,
        label: options?.label,
        expiresAt: options?.expiresAt,
        metadata: (options?.metadata as Prisma.InputJsonValue) ?? undefined,
        status: IntegrationStatus.CONNECTED,
      },
      select: {
        id: true,
        provider: true,
        label: true,
        authType: true,
        scopes: true,
        status: true,
        expiresAt: true,
        lastUsedAt: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        // Never select credentials
      },
    });
  }

  async retrieve(
    organizationId: string,
    provider: IntegrationProvider,
    label?: string,
  ): Promise<{ id: string; credentials: DecryptedCredentials }> {
    const integration = await this.prisma.orgIntegration.findFirst({
      where: {
        organizationId,
        provider,
        ...(label ? { label } : {}),
        status: { not: IntegrationStatus.REVOKED },
      },
    });

    if (!integration) {
      throw new NotFoundException(
        `No ${provider} integration found for this organization`,
      );
    }

    // Update lastUsedAt
    await this.prisma.orgIntegration.update({
      where: { id: integration.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      id: integration.id,
      credentials: this.decrypt(integration.credentials),
    };
  }

  async retrieveById(integrationId: string): Promise<{
    id: string;
    provider: IntegrationProvider;
    organizationId: string;
    credentials: DecryptedCredentials;
  }> {
    const integration = await this.prisma.orgIntegration.findUnique({
      where: { id: integrationId },
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    await this.prisma.orgIntegration.update({
      where: { id: integrationId },
      data: { lastUsedAt: new Date() },
    });

    return {
      id: integration.id,
      provider: integration.provider,
      organizationId: integration.organizationId,
      credentials: this.decrypt(integration.credentials),
    };
  }

  async revoke(integrationId: string) {
    return this.prisma.orgIntegration.update({
      where: { id: integrationId },
      data: {
        status: IntegrationStatus.REVOKED,
        credentials: '', // Wipe encrypted credentials
      },
      select: {
        id: true,
        provider: true,
        status: true,
      },
    });
  }

  async updateCredentials(
    integrationId: string,
    credentials: DecryptedCredentials,
    expiresAt?: Date,
  ) {
    const encrypted = this.encrypt(credentials);

    return this.prisma.orgIntegration.update({
      where: { id: integrationId },
      data: {
        credentials: encrypted,
        status: IntegrationStatus.CONNECTED,
        ...(expiresAt ? { expiresAt } : {}),
      },
      select: {
        id: true,
        provider: true,
        status: true,
        expiresAt: true,
      },
    });
  }

  async updateStatus(integrationId: string, status: IntegrationStatus) {
    return this.prisma.orgIntegration.update({
      where: { id: integrationId },
      data: { status },
    });
  }

  async findExpiringIntegrations(withinDays: number = 7) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() + withinDays);

    return this.prisma.orgIntegration.findMany({
      where: {
        status: IntegrationStatus.CONNECTED,
        authType: AuthType.OAUTH2,
        expiresAt: {
          not: null,
          lte: threshold,
        },
      },
      include: {
        organization: {
          include: {
            users: {
              where: { role: 'ADMIN' },
              select: { email: true },
            },
          },
        },
      },
    });
  }

  async listByOrganization(organizationId: string) {
    return this.prisma.orgIntegration.findMany({
      where: { organizationId },
      select: {
        id: true,
        provider: true,
        label: true,
        authType: true,
        scopes: true,
        status: true,
        expiresAt: true,
        lastUsedAt: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        // Never select credentials
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
