import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser } from '../common';
import { ImplementationService } from './implementation.service';
import {
  CreatePlanDto,
  RefinePlanDto,
  RejectPlanDto,
  PlanQueryDto,
  UpdateChecklistDto,
} from './dto';

@ApiTags('Implementation Engine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('implementation')
export class ImplementationController {
  constructor(private implementationService: ImplementationService) {}

  // ── Plans ──────────────────────────────────────────────

  @Post('plans')
  createPlan(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Body() dto: CreatePlanDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.createPlan(
      user.organizationId,
      user.id,
      dto,
    );
  }

  @Get('plans')
  listPlans(
    @CurrentUser() user: { organizationId: string | null },
    @Query() query: PlanQueryDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.listPlans(user.organizationId, query);
  }

  @Get('plans/:id')
  getPlan(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.getPlan(id, user.organizationId);
  }

  @Post('plans/:id/refine')
  refinePlan(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefinePlanDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.refinePlan(
      id,
      user.organizationId,
      dto,
    );
  }

  @Post('plans/:id/approve')
  approvePlan(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.approvePlan(
      id,
      user.organizationId,
      user.id,
    );
  }

  @Post('plans/:id/reject')
  rejectPlan(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPlanDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.rejectPlan(
      id,
      user.organizationId,
      dto,
    );
  }

  // ── Artifacts ──────────────────────────────────────────

  @Get('plans/:id/artifacts')
  listArtifacts(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.listArtifacts(id, user.organizationId);
  }

  @Get('artifacts/:id')
  getArtifact(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.getArtifact(id, user.organizationId);
  }

  // ── Checklist ──────────────────────────────────────────

  @Patch('artifacts/:id/checklist')
  updateChecklist(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChecklistDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.updateChecklist(
      id,
      user.organizationId,
      dto,
    );
  }

  // ── Deploy (retry) ────────────────────────────────────
  // Approval triggers execution automatically. This endpoint re-runs the
  // executor for FAILED plans or COMPLETED plans with partial-failure steps.

  @Post('plans/:id/deploy')
  deployPlan(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.deployPlan(
      id,
      user.organizationId,
      user.id,
    );
  }

  // ── Delete ─────────────────────────────────────────────

  @Delete('plans/:id')
  deletePlan(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.implementationService.deletePlan(id, user.organizationId);
  }

  // ── Helper ─────────────────────────────────────────────

  private requireOrg(orgId: string | null): asserts orgId is string {
    if (!orgId) {
      throw new BadRequestException('User must belong to an organization');
    }
  }
}
