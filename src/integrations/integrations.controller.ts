import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IntegrationProvider } from '@prisma/client';
import { JwtAuthGuard, CurrentUser } from '../common';
import { IntegrationsService } from './integrations.service';
import { GoogleDriveService } from './services/google-drive.service';
import { ConnectIntegrationDto } from './dto';

@ApiTags('Integrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('integrations')
export class IntegrationsController {
  constructor(
    private integrationsService: IntegrationsService,
    private googleDrive: GoogleDriveService,
  ) {}

  // ── List connected integrations ────────────────────────

  @Get()
  listConnections(
    @CurrentUser() user: { organizationId: string | null },
  ) {
    this.requireOrg(user.organizationId);
    return this.integrationsService.listConnections(user.organizationId);
  }

  // ── Get OAuth authorize URL ────────────────────────────

  @Get(':provider/authorize')
  getAuthorizeUrl(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Param('provider') providerRaw: string,
    @Query('redirectUri') redirectUri: string,
  ) {
    this.requireOrg(user.organizationId);
    const provider = this.parseProvider(providerRaw);

    if (!redirectUri) {
      throw new BadRequestException('redirectUri query param is required');
    }

    // State encodes org + user for the callback
    const state = Buffer.from(
      JSON.stringify({
        orgId: user.organizationId,
        userId: user.id,
        provider: providerRaw,
      }),
    ).toString('base64url');

    const url = this.integrationsService.getAuthorizeUrl(
      provider,
      redirectUri,
      state,
    );

    return { url };
  }

  // ── OAuth callback (exchange code) ─────────────────────

  @Post(':provider/callback')
  connect(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Param('provider') providerRaw: string,
    @Body() dto: ConnectIntegrationDto,
  ) {
    this.requireOrg(user.organizationId);
    const provider = this.parseProvider(providerRaw);

    // Verify state if present — defends against another tab/session swapping
    // a foreign `code` into this user's callback. Tolerant for now (state is
    // optional) so existing in-flight callbacks don't break; the frontend
    // always forwards it.
    if (dto.state) {
      this.verifyState(dto.state, user.id, user.organizationId, providerRaw);
    }

    const redirectUri =
      dto.redirectUri || `${process.env.CORS_ORIGIN || 'http://localhost:3001'}/settings?tab=integrations`;

    return this.integrationsService.connect(
      provider,
      dto.code,
      redirectUri,
      user.organizationId,
      user.id,
    );
  }

  // ── Disconnect ─────────────────────────────────────────

  @Delete(':id')
  disconnect(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.integrationsService.disconnect(id, user.organizationId);
  }

  // ── Google Drive Exports ────────────────────────────────

  @Post('google-drive/export/report/:reportId')
  exportReport(
    @CurrentUser() user: { organizationId: string | null },
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.googleDrive.exportReport(user.organizationId, reportId);
  }

  @Post('google-drive/export/artifact/:artifactId')
  exportArtifact(
    @CurrentUser() user: { organizationId: string | null },
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.googleDrive.exportArtifact(user.organizationId, artifactId);
  }

  // ── Helpers ────────────────────────────────────────────

  private requireOrg(orgId: string | null): asserts orgId is string {
    if (!orgId) {
      throw new BadRequestException('User must belong to an organization');
    }
  }

  private parseProvider(raw: string): IntegrationProvider {
    const upper = raw.toUpperCase().replace(/-/g, '_') as IntegrationProvider;
    const valid: Set<string> = new Set(Object.values(IntegrationProvider));
    if (!valid.has(upper)) {
      throw new BadRequestException(
        `Invalid provider "${raw}". Valid: ${[...valid].join(', ')}`,
      );
    }
    return upper;
  }

  private verifyState(
    rawState: string,
    expectedUserId: string,
    expectedOrgId: string,
    expectedProvider: string,
  ): void {
    let decoded: { orgId?: string; userId?: string; provider?: string };
    try {
      decoded = JSON.parse(
        Buffer.from(rawState, 'base64url').toString('utf-8'),
      );
    } catch {
      throw new ForbiddenException('OAuth state is malformed');
    }

    if (
      decoded.userId !== expectedUserId ||
      decoded.orgId !== expectedOrgId ||
      decoded.provider !== expectedProvider
    ) {
      throw new ForbiddenException(
        'OAuth state mismatch — this callback does not belong to the current session',
      );
    }
  }
}
