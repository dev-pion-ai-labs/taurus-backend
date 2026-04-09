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
import { TrackerService } from './tracker.service';
import {
  CreateActionDto,
  UpdateActionDto,
  MoveActionDto,
  CreateSprintDto,
  UpdateSprintDto,
  CreateCommentDto,
  BoardQueryDto,
} from './dto';

@ApiTags('Transformation Tracker')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tracker')
export class TrackerController {
  constructor(private trackerService: TrackerService) {}

  // ── Board ───────────────────────────────────────────────

  @Get('board')
  getBoard(
    @CurrentUser() user: { organizationId: string | null },
    @Query() query: BoardQueryDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.getBoardData(user.organizationId, query);
  }

  // ── Actions ─────────────────────────────────────────────

  @Post('actions')
  createAction(
    @CurrentUser() user: { organizationId: string | null },
    @Body() dto: CreateActionDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.createAction(user.organizationId, dto);
  }

  @Get('actions/:id')
  getAction(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.getAction(id, user.organizationId);
  }

  @Patch('actions/:id')
  updateAction(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActionDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.updateAction(id, user.organizationId, dto);
  }

  @Patch('actions/:id/move')
  moveAction(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveActionDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.moveAction(id, user.organizationId, dto);
  }

  @Delete('actions/:id')
  deleteAction(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.deleteAction(id, user.organizationId);
  }

  // ── Import ──────────────────────────────────────────────

  @Post('import/:sessionId')
  importFromReport(
    @CurrentUser() user: { organizationId: string | null },
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.importFromReport(sessionId, user.organizationId);
  }

  // ── Sprints ─────────────────────────────────────────────

  @Get('sprints')
  listSprints(
    @CurrentUser() user: { organizationId: string | null },
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.listSprints(user.organizationId);
  }

  @Post('sprints')
  createSprint(
    @CurrentUser() user: { organizationId: string | null },
    @Body() dto: CreateSprintDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.createSprint(user.organizationId, dto);
  }

  @Patch('sprints/:id')
  updateSprint(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSprintDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.updateSprint(id, user.organizationId, dto);
  }

  // ── Comments ────────────────────────────────────────────

  @Get('actions/:id/comments')
  listComments(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.listComments(id, user.organizationId);
  }

  @Post('actions/:id/comments')
  addComment(
    @CurrentUser() user: { id: string; organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.addComment(
      id,
      user.id,
      user.organizationId,
      dto,
    );
  }

  // ── Stats ───────────────────────────────────────────────

  @Get('stats')
  getStats(
    @CurrentUser() user: { organizationId: string | null },
  ) {
    this.requireOrg(user.organizationId);
    return this.trackerService.getStats(user.organizationId);
  }

  // ── Helper ──────────────────────────────────────────────

  private requireOrg(orgId: string | null): asserts orgId is string {
    if (!orgId) {
      throw new BadRequestException('User must belong to an organization');
    }
  }
}
