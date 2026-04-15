import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import * as express from 'express';
import { IntegrationProvider } from '@prisma/client';
import { IntegrationsService } from './integrations.service';
import { ConnectApiKeyDto } from './dto';
import { OrgMemberGuard } from '../common/guards/org-member.guard';

@ApiTags('Integrations')
@Controller('organizations/:orgId/integrations')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), OrgMemberGuard)
export class IntegrationsController {
  constructor(private integrationsService: IntegrationsService) {}

  /** List all connected integrations for the organization */
  @Get()
  async listIntegrations(@Param('orgId') orgId: string) {
    return this.integrationsService.listIntegrations(orgId);
  }

  /** Redirect to provider's OAuth consent screen */
  @Get('connect/:provider')
  async connectOAuth(
    @Param('orgId') orgId: string,
    @Param('provider') provider: string,
    @Res() res: express.Response,
  ) {
    const providerEnum = this.parseProvider(provider);
    const redirectUrl = this.integrationsService.getOAuthRedirectUrl(
      providerEnum,
      orgId,
    );
    return res.redirect(redirectUrl);
  }

  /** Manually connect via API key (for providers without OAuth) */
  @Post('connect-api-key')
  async connectApiKey(
    @Param('orgId') orgId: string,
    @Body() dto: ConnectApiKeyDto,
  ) {
    return this.integrationsService.connectApiKey(orgId, dto);
  }

  /** Test an existing connection */
  @Post(':integrationId/test')
  async testConnection(@Param('integrationId') integrationId: string) {
    return this.integrationsService.testConnection(integrationId);
  }

  /** Disconnect and revoke an integration */
  @Delete(':integrationId')
  async disconnect(
    @Param('orgId') orgId: string,
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrationsService.disconnect(integrationId, orgId);
  }

  /** Get audit logs for this organization's deployments */
  @Get('audit-logs')
  async getAuditLogs(@Param('orgId') orgId: string) {
    return this.integrationsService.getAuditLogs(orgId);
  }

  /** Get audit logs for a specific integration */
  @Get(':integrationId/audit-logs')
  async getIntegrationAuditLogs(
    @Param('integrationId') integrationId: string,
  ) {
    return this.integrationsService.getIntegrationAuditLogs(integrationId);
  }

  private parseProvider(provider: string): IntegrationProvider {
    const upper = provider.toUpperCase() as IntegrationProvider;
    if (!Object.values(IntegrationProvider).includes(upper)) {
      throw new BadRequestException(`Unknown provider: ${provider}`);
    }
    return upper;
  }
}
