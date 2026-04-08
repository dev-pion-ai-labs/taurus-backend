import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import {
  CreateDepartmentDto,
  UpdateDepartmentDto,
  CreateWorkflowDto,
  UpdateWorkflowDto,
} from './dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  // ── Departments ──────────────────────────────────────────

  async listDepartments(organizationId: string) {
    const departments = await this.prisma.department.findMany({
      where: { organizationId },
      include: {
        workflows: {
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { workflows: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return departments;
  }

  async createDepartment(organizationId: string, dto: CreateDepartmentDto) {
    return this.prisma.department.create({
      data: {
        organizationId,
        name: dto.name,
        headcount: dto.headcount,
        avgSalary: dto.avgSalary,
        notes: dto.notes,
      },
      include: { workflows: true },
    });
  }

  async updateDepartment(
    departmentId: string,
    organizationId: string,
    dto: UpdateDepartmentDto,
  ) {
    const dept = await this.findDepartmentOrFail(departmentId, organizationId);

    return this.prisma.department.update({
      where: { id: dept.id },
      data: dto,
      include: { workflows: true },
    });
  }

  async deleteDepartment(departmentId: string, organizationId: string) {
    await this.findDepartmentOrFail(departmentId, organizationId);

    await this.prisma.department.delete({
      where: { id: departmentId },
    });

    return { success: true };
  }

  // ── Workflows ────────────────────────────────────────────

  async createWorkflow(organizationId: string, dto: CreateWorkflowDto) {
    // Verify department belongs to org
    await this.findDepartmentOrFail(dto.departmentId, organizationId);

    return this.prisma.workflow.create({
      data: {
        departmentId: dto.departmentId,
        name: dto.name,
        description: dto.description,
        weeklyHours: dto.weeklyHours,
        peopleInvolved: dto.peopleInvolved,
        automationLevel: (dto.automationLevel as any) || 'NONE',
        painPoints: dto.painPoints,
        priority: (dto.priority as any) || 'MEDIUM',
      },
    });
  }

  async updateWorkflow(
    workflowId: string,
    organizationId: string,
    dto: UpdateWorkflowDto,
  ) {
    const workflow = await this.findWorkflowOrFail(workflowId, organizationId);

    return this.prisma.workflow.update({
      where: { id: workflow.id },
      data: dto as any,
    });
  }

  async deleteWorkflow(workflowId: string, organizationId: string) {
    await this.findWorkflowOrFail(workflowId, organizationId);

    await this.prisma.workflow.delete({
      where: { id: workflowId },
    });

    return { success: true };
  }

  // ── Summary (for Phase 2 consumption) ────────────────────

  async getSummary(organizationId: string) {
    const departments = await this.prisma.department.findMany({
      where: { organizationId },
      include: {
        workflows: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const totalHeadcount = departments.reduce(
      (sum, d) => sum + (d.headcount || 0),
      0,
    );

    const totalWorkflows = departments.reduce(
      (sum, d) => sum + d.workflows.length,
      0,
    );

    const totalWeeklyHours = departments.reduce(
      (sum, d) =>
        sum + d.workflows.reduce((ws, w) => ws + (w.weeklyHours || 0), 0),
      0,
    );

    const automationBreakdown = {
      NONE: 0,
      LOW: 0,
      MODERATE: 0,
      HIGH: 0,
      FULL: 0,
    };
    departments.forEach((d) =>
      d.workflows.forEach((w) => {
        automationBreakdown[w.automationLevel]++;
      }),
    );

    return {
      departmentCount: departments.length,
      totalHeadcount,
      totalWorkflows,
      totalWeeklyHours,
      automationBreakdown,
      departments: departments.map((d) => ({
        id: d.id,
        name: d.name,
        headcount: d.headcount,
        avgSalary: d.avgSalary,
        workflowCount: d.workflows.length,
        weeklyHours: d.workflows.reduce(
          (sum, w) => sum + (w.weeklyHours || 0),
          0,
        ),
        workflows: d.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          description: w.description,
          weeklyHours: w.weeklyHours,
          peopleInvolved: w.peopleInvolved,
          automationLevel: w.automationLevel,
          painPoints: w.painPoints,
          priority: w.priority,
        })),
      })),
    };
  }

  // ── Helpers ──────────────────────────────────────────────

  private async findDepartmentOrFail(
    departmentId: string,
    organizationId: string,
  ) {
    const dept = await this.prisma.department.findUnique({
      where: { id: departmentId },
    });

    if (!dept) throw new NotFoundException('Department not found');
    if (dept.organizationId !== organizationId) {
      throw new ForbiddenException(
        'Department does not belong to your organization',
      );
    }

    return dept;
  }

  private async findWorkflowOrFail(workflowId: string, organizationId: string) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
      include: { department: true },
    });

    if (!workflow) throw new NotFoundException('Workflow not found');
    if (workflow.department.organizationId !== organizationId) {
      throw new ForbiddenException(
        'Workflow does not belong to your organization',
      );
    }

    return workflow;
  }
}
