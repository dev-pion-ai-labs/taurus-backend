import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrgMemberGuard } from '../common/guards/org-member.guard';
import { CurrentUser } from '../common';
import { DeploymentOrchestratorService } from './deployment-orchestrator.service';
import { CreateDeploymentSessionDto } from './dto';

@ApiTags('Deployment')
@Controller('organizations/:orgId/deploy')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), OrgMemberGuard)
export class DeploymentController {
  constructor(private orchestrator: DeploymentOrchestratorService) {}

  /** Create a new multi-step deployment session */
  @Post()
  async createSession(
    @Param('orgId') orgId: string,
    @Body() dto: CreateDeploymentSessionDto,
  ) {
    return this.orchestrator.createSession({
      planId: dto.planId,
      organizationId: orgId,
      steps: dto.steps,
    });
  }

  /** List deployment sessions for the org (optionally filter by planId) */
  @Get()
  async listSessions(
    @Param('orgId') orgId: string,
    @Query('planId') planId?: string,
  ) {
    return this.orchestrator.listSessions(orgId, planId);
  }

  /** Get a deployment session with all steps */
  @Get(':sessionId')
  async getSession(@Param('sessionId') sessionId: string) {
    return this.orchestrator.getSession(sessionId);
  }

  /** Run dry-run on all steps */
  @Post(':sessionId/dry-run')
  async dryRunSession(@Param('sessionId') sessionId: string) {
    return this.orchestrator.dryRunSession(sessionId);
  }

  /** Approve a session after dry-run review */
  @Post(':sessionId/approve')
  async approveSession(@Param('sessionId') sessionId: string) {
    return this.orchestrator.approveSession(sessionId);
  }

  /** Execute an approved session */
  @Post(':sessionId/execute')
  async executeSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orchestrator.executeSession(sessionId, userId);
  }

  /** Rollback a completed or failed session */
  @Post(':sessionId/rollback')
  async rollbackSession(@Param('sessionId') sessionId: string) {
    return this.orchestrator.rollbackSession(sessionId);
  }
}
