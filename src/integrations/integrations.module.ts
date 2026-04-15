import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IntegrationProvider } from '@prisma/client';
import { IntegrationsController } from './integrations.controller';
import { OAuthCallbackController } from './oauth-callback.controller';
import { IntegrationsService } from './integrations.service';
import { CredentialVaultService } from './credential-vault.service';
import { AuditLogService } from './audit-log.service';
import { DeploymentAdapter } from './adapters/base.adapter';
import { DEPLOYMENT_ADAPTERS } from './adapters/base.adapter';
import {
  SlackAdapter,
  SLACK_OAUTH_AUTHORIZE_URL,
  SLACK_OAUTH_TOKEN_URL,
  SLACK_SCOPES,
  SLACK_CALLBACK_PATH,
} from './adapters/slack';
import {
  GitHubAdapter,
  GITHUB_OAUTH_AUTHORIZE_URL,
  GITHUB_OAUTH_TOKEN_URL,
  GITHUB_OAUTH_SCOPES,
  GITHUB_CALLBACK_PATH,
} from './adapters/github';
import { MakeAdapter } from './adapters/make';
import { NotionAdapter } from './adapters/notion';

@Module({
  controllers: [IntegrationsController, OAuthCallbackController],
  providers: [
    IntegrationsService,
    CredentialVaultService,
    AuditLogService,
    SlackAdapter,
    GitHubAdapter,
    MakeAdapter,
    NotionAdapter,
    {
      provide: DEPLOYMENT_ADAPTERS,
      useFactory: (slack: SlackAdapter, github: GitHubAdapter, make: MakeAdapter, notion: NotionAdapter) => {
        const map = new Map<IntegrationProvider, DeploymentAdapter>();
        map.set(IntegrationProvider.SLACK, slack);
        map.set(IntegrationProvider.GITHUB, github);
        map.set(IntegrationProvider.MAKE, make);
        map.set(IntegrationProvider.NOTION, notion);
        return map;
      },
      inject: [SlackAdapter, GitHubAdapter, MakeAdapter, NotionAdapter],
    },
  ],
  exports: [
    IntegrationsService,
    CredentialVaultService,
    AuditLogService,
    SlackAdapter,
    GitHubAdapter,
    MakeAdapter,
    NotionAdapter,
    DEPLOYMENT_ADAPTERS,
  ],
})
export class IntegrationsModule implements OnModuleInit {
  constructor(
    private integrationsService: IntegrationsService,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    // Register Slack OAuth
    const slackClientId = this.configService.get<string>('slack.clientId');
    const slackClientSecret = this.configService.get<string>('slack.clientSecret');

    if (slackClientId && slackClientSecret) {
      this.integrationsService.registerOAuthProvider(IntegrationProvider.SLACK, {
        clientId: slackClientId,
        clientSecret: slackClientSecret,
        authorizeUrl: SLACK_OAUTH_AUTHORIZE_URL,
        tokenUrl: SLACK_OAUTH_TOKEN_URL,
        scopes: SLACK_SCOPES,
        callbackPath: SLACK_CALLBACK_PATH,
      });
    }

    // Register GitHub OAuth
    const githubClientId = this.configService.get<string>('github.clientId');
    const githubClientSecret = this.configService.get<string>('github.clientSecret');

    if (githubClientId && githubClientSecret) {
      this.integrationsService.registerOAuthProvider(IntegrationProvider.GITHUB, {
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        authorizeUrl: GITHUB_OAUTH_AUTHORIZE_URL,
        tokenUrl: GITHUB_OAUTH_TOKEN_URL,
        scopes: GITHUB_OAUTH_SCOPES,
        callbackPath: GITHUB_CALLBACK_PATH,
      });
    }
  }
}
