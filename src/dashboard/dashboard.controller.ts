import {
  Controller,
  Get,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser } from '../common';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private dashboardService: DashboardService) {}

  @Get('executive')
  getExecutive(@CurrentUser() user: { organizationId: string | null }) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.dashboardService.getExecutiveDashboard(user.organizationId);
  }

  @Get('maturity-trend')
  getMaturityTrend(@CurrentUser() user: { organizationId: string | null }) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.dashboardService.getMaturityTrend(user.organizationId);
  }

  @Get('department-heatmap')
  getDepartmentHeatmap(@CurrentUser() user: { organizationId: string | null }) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.dashboardService.getDepartmentHeatmap(user.organizationId);
  }

  @Get('roadmap-progress')
  getRoadmapProgress(@CurrentUser() user: { organizationId: string | null }) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.dashboardService.getRoadmapProgress(user.organizationId);
  }

  @Get('value-realization')
  getValueRealization(@CurrentUser() user: { organizationId: string | null }) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.dashboardService.getValueRealization(user.organizationId);
  }

  @Get('sprint-velocity')
  getSprintVelocity(@CurrentUser() user: { organizationId: string | null }) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.dashboardService.getSprintVelocity(user.organizationId);
  }

  @Get('stack-overview')
  getStackOverview(@CurrentUser() user: { organizationId: string | null }) {
    if (!user.organizationId) {
      throw new BadRequestException('User must belong to an organization');
    }
    return this.dashboardService.getStackOverview(user.organizationId);
  }
}
