import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { IntegrationStatus } from '@prisma/client';
import { CredentialVaultService } from '../integrations/credential-vault.service';
import { SlackAdapter } from '../integrations/adapters/slack';
import { GitHubAdapter } from '../integrations/adapters/github';
import { NotificationsService } from '../notifications';

@Processor('token-refresh')
export class TokenRefreshProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TokenRefreshProcessor.name);

  constructor(
    private credentialVault: CredentialVaultService,
    private slackAdapter: SlackAdapter,
    private githubAdapter: GitHubAdapter,
    private notifications: NotificationsService,
    @InjectQueue('token-refresh') private tokenRefreshQueue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.tokenRefreshQueue.add(
      'refresh-expiring-tokens',
      {},
      {
        repeat: { every: 86400000 }, // 24 hours
        jobId: 'daily-token-refresh',
      },
    );
    this.logger.log('Registered daily token refresh repeatable job');
  }

  async process(job: Job) {
    if (job.name !== 'refresh-expiring-tokens') {
      this.logger.warn(`Unknown job type: ${job.name}`);
      return;
    }

    const start = Date.now();
    this.logger.log('Starting daily token refresh check');

    const expiringIntegrations =
      await this.credentialVault.findExpiringIntegrations(7);

    let refreshed = 0;
    let failed = 0;

    for (const integration of expiringIntegrations) {
      try {
        // Attempt to refresh the token using the stored refresh_token
        const { credentials } = await this.credentialVault.retrieveById(
          integration.id,
        );

        if (!credentials.refreshToken) {
          this.logger.warn(
            `Integration ${integration.id} (${integration.provider}) has no refresh token — marking expired`,
          );
          await this.credentialVault.updateStatus(
            integration.id,
            IntegrationStatus.EXPIRED,
          );
          failed++;
          continue;
        }

        // Attempt provider-specific token refresh
        let refreshSuccess = false;

        // Try provider-specific refresh
        const adapter =
          integration.provider === 'SLACK'
            ? this.slackAdapter
            : integration.provider === 'GITHUB'
              ? this.githubAdapter
              : null;

        if (adapter) {
          try {
            const result = await adapter.refreshToken(
              credentials.refreshToken,
            );
            const newCredentials = {
              ...credentials,
              accessToken: result.accessToken,
              refreshToken: result.refreshToken ?? credentials.refreshToken,
            };
            const newExpiry = result.expiresIn
              ? new Date(Date.now() + result.expiresIn * 1000)
              : undefined;
            await this.credentialVault.updateCredentials(
              integration.id,
              newCredentials,
              newExpiry,
            );
            this.logger.log(
              `Refreshed ${integration.provider} token for integration ${integration.id}`,
            );
            refreshed++;
            refreshSuccess = true;
          } catch (refreshErr) {
            this.logger.error(
              `${integration.provider} token refresh failed for ${integration.id}: ${(refreshErr as Error).message}`,
            );
          }
        }

        if (refreshSuccess) continue;

        // No adapter or refresh failed — mark expired
        this.logger.warn(
          `Integration ${integration.id} (${integration.provider}) is expiring — marking expired`,
        );
        await this.credentialVault.updateStatus(
          integration.id,
          IntegrationStatus.EXPIRED,
        );
        failed++;

        // Notify org admins
        const adminEmails = integration.organization.users.map((u) => u.email);
        for (const email of adminEmails) {
          try {
            await this.notifications.sendEmail(
              email,
              `${integration.provider} integration expiring`,
              `
                <p>Your <strong>${integration.provider}</strong> integration is expiring soon.</p>
                <p>Please reconnect it from the Integrations settings page to avoid service disruption.</p>
              `,
            );
          } catch (emailErr) {
            this.logger.warn(
              `Failed to send expiry notification to ${email}: ${(emailErr as Error).message}`,
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `Failed to process integration ${integration.id}: ${(err as Error).message}`,
        );
        failed++;
      }
    }

    this.logger.log(
      `Token refresh check completed in ${Date.now() - start}ms — refreshed: ${refreshed}, failed: ${failed}`,
    );
  }
}
