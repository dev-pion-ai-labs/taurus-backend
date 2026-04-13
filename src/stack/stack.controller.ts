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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { StackService } from './stack.service';
import { CreateToolDto } from './dto/create-tool.dto';
import { UpdateToolDto } from './dto/update-tool.dto';
import { CreateSpendDto } from './dto/create-spend.dto';

@Controller('organizations/:orgId/stack')
@UseGuards(AuthGuard('jwt'))
export class StackController {
  constructor(private stackService: StackService) {}

  @Get()
  async getInventory(
    @Param('orgId') orgId: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
  ) {
    return this.stackService.getInventory(orgId, {
      category,
      status,
      source,
    });
  }

  @Get('summary')
  async getSummary(@Param('orgId') orgId: string) {
    return this.stackService.getStackSummary(orgId);
  }

  @Get('recommendations')
  async getRecommendations(@Param('orgId') orgId: string) {
    return this.stackService.getRecommendations(orgId);
  }

  @Post()
  async addTool(
    @Param('orgId') orgId: string,
    @Body() dto: CreateToolDto,
  ) {
    return this.stackService.addTool(orgId, dto);
  }

  @Patch(':toolId')
  async updateTool(
    @Param('orgId') orgId: string,
    @Param('toolId') toolId: string,
    @Body() dto: UpdateToolDto,
  ) {
    return this.stackService.updateTool(toolId, orgId, dto);
  }

  @Delete(':toolId')
  async removeTool(
    @Param('orgId') orgId: string,
    @Param('toolId') toolId: string,
  ) {
    return this.stackService.removeTool(toolId, orgId);
  }

  @Post('sync')
  async syncAll(@Param('orgId') orgId: string) {
    return this.stackService.syncAll(orgId);
  }

  // ── Spend Tracking ─────────────────────────────────────

  @Post('spend')
  async addSpend(
    @Param('orgId') orgId: string,
    @Body() dto: CreateSpendDto,
  ) {
    return this.stackService.addSpendRecord(orgId, dto);
  }

  @Get('spend')
  async getSpendTrends(
    @Param('orgId') orgId: string,
    @Query('months') months?: string,
  ) {
    return this.stackService.getSpendTrends(
      orgId,
      months ? parseInt(months, 10) : 12,
    );
  }

  // ── ROI ────────────────────────────────────────────────

  @Get('roi')
  async getROI(@Param('orgId') orgId: string) {
    return this.stackService.getToolROI(orgId);
  }

  // ── Overlap Detection ──────────────────────────────────

  @Get('overlaps')
  async getOverlaps(@Param('orgId') orgId: string) {
    return this.stackService.detectOverlaps(orgId);
  }

  // ── Renewals ───────────────────────────────────────────

  @Get('renewals')
  async getRenewals(@Param('orgId') orgId: string) {
    return this.stackService.getUpcomingRenewals(orgId);
  }
}
