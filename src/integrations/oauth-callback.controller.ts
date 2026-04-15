import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import * as express from 'express';
import { IntegrationProvider } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { IntegrationsService } from './integrations.service';

@ApiTags('OAuth Callbacks')
@Controller('integrations/callback')
export class OAuthCallbackController {
  private readonly logger = new Logger(OAuthCallbackController.name);

  constructor(
    private integrationsService: IntegrationsService,
    private configService: ConfigService,
  ) {}

  /** Handle OAuth callback from provider — no auth guard (called by external redirect) */
  @Get(':provider')
  @ApiExcludeEndpoint()
  async handleCallback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error?: string,
    @Res() res?: express.Response,
  ) {
    const frontendUrl = this.configService.get<string>('app.corsOrigin');

    if (error) {
      this.logger.warn(`OAuth error for ${provider}: ${error}`);
      return res!.redirect(
        `${frontendUrl}/settings?tab=integrations&error=${encodeURIComponent(error)}`,
      );
    }

    if (!code || !state) {
      throw new BadRequestException('Missing code or state parameter');
    }

    const providerEnum = provider.toUpperCase() as IntegrationProvider;
    if (!Object.values(IntegrationProvider).includes(providerEnum)) {
      throw new BadRequestException(`Unknown provider: ${provider}`);
    }

    try {
      await this.integrationsService.handleOAuthCallback(
        providerEnum,
        code,
        state,
      );

      // Redirect back to frontend settings page on success
      return res!.redirect(
        `${frontendUrl}/settings?tab=integrations&connected=${provider}`,
      );
    } catch (err) {
      this.logger.error(`OAuth callback failed for ${provider}: ${(err as Error).message}`);
      return res!.redirect(
        `${frontendUrl}/settings?tab=integrations&error=connection_failed`,
      );
    }
  }
}
