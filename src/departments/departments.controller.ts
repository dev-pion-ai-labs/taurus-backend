import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser } from '../common';
import { DepartmentsService } from './departments.service';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreateWorkflowDto,
  UpdateWorkflowDto,
} from './dto';

@ApiTags('Departments & Workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('departments')
export class DepartmentsController {
  constructor(private departmentsService: DepartmentsService) {}

  // ── Departments ──────────────────────────────────────────

  @Get()
  list(@CurrentUser() user: { organizationId: string | null }) {
    this.requireOrg(user.organizationId);
    return this.departmentsService.listDepartments(user.organizationId!);
  }

  @Get('summary')
  summary(@CurrentUser() user: { organizationId: string | null }) {
    this.requireOrg(user.organizationId);
    return this.departmentsService.getSummary(user.organizationId!);
  }

  @Post()
  createDepartment(
    @CurrentUser() user: { organizationId: string | null },
    @Body() dto: CreateDepartmentDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.departmentsService.createDepartment(user.organizationId!, dto);
  }

  @Patch(':id')
  updateDepartment(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.departmentsService.updateDepartment(id, user.organizationId!, dto);
  }

  @Delete(':id')
  deleteDepartment(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.departmentsService.deleteDepartment(id, user.organizationId!);
  }

  // ── Workflows ────────────────────────────────────────────

  @Post('workflows')
  createWorkflow(
    @CurrentUser() user: { organizationId: string | null },
    @Body() dto: CreateWorkflowDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.departmentsService.createWorkflow(user.organizationId!, dto);
  }

  @Patch('workflows/:id')
  updateWorkflow(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDto,
  ) {
    this.requireOrg(user.organizationId);
    return this.departmentsService.updateWorkflow(id, user.organizationId!, dto);
  }

  @Delete('workflows/:id')
  deleteWorkflow(
    @CurrentUser() user: { organizationId: string | null },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    this.requireOrg(user.organizationId);
    return this.departmentsService.deleteWorkflow(id, user.organizationId!);
  }

  // ── Helper ───────────────────────────────────────────────

  private requireOrg(orgId: string | null): asserts orgId is string {
    if (!orgId) {
      throw new BadRequestException('User must belong to an organization');
    }
  }
}
