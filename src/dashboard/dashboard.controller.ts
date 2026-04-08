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
}
