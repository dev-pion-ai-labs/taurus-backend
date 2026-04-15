import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { AuditStatus, IntegrationProvider, Prisma } from '@prisma/client';

export interface CreateAuditLogInput {
  organizationId: string;
  planId?: string;
  integrationId: string;
  action: string;
  provider: IntegrationProvider;
  request: Record<string, unknown>;
  executedBy: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private prisma: PrismaService) {}

  /** Sanitize request data to ensure no secrets leak into logs */
  private sanitize(data: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = [
      'token',
      'access_token',
      'refresh_token',
      'api_key',
      'apiKey',
      'secret',
      'password',
      'authorization',
      'bearer',
      'credentials',
      'webhook_url',
    ];

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = this.sanitize(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  async logAction(input: CreateAuditLogInput) {
    return this.prisma.deploymentAuditLog.create({
      data: {
        organizationId: input.organizationId,
        planId: input.planId,
        integrationId: input.integrationId,
        action: input.action,
        provider: input.provider,
        request: this.sanitize(input.request) as unknown as Prisma.InputJsonValue,
        executedBy: input.executedBy,
        status: AuditStatus.PENDING,
      },
    });
  }

  async markSuccess(
    auditLogId: string,
    response: Record<string, unknown>,
    rollbackData: Record<string, unknown>,
  ) {
    return this.prisma.deploymentAuditLog.update({
      where: { id: auditLogId },
      data: {
        status: AuditStatus.SUCCESS,
        response: this.sanitize(response) as unknown as Prisma.InputJsonValue,
        rollbackData: rollbackData as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async markFailed(auditLogId: string, response: Record<string, unknown>) {
    return this.prisma.deploymentAuditLog.update({
      where: { id: auditLogId },
      data: {
        status: AuditStatus.FAILED,
        response: this.sanitize(response) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async markRolledBack(auditLogId: string) {
    return this.prisma.deploymentAuditLog.update({
      where: { id: auditLogId },
      data: {
        status: AuditStatus.ROLLED_BACK,
        rolledBackAt: new Date(),
      },
    });
  }

  async getByPlan(planId: string) {
    return this.prisma.deploymentAuditLog.findMany({
      where: { planId },
      orderBy: { executedAt: 'asc' },
    });
  }

  async getByOrganization(organizationId: string, limit: number = 50) {
    return this.prisma.deploymentAuditLog.findMany({
      where: { organizationId },
      orderBy: { executedAt: 'desc' },
      take: limit,
    });
  }

  async getByIntegration(integrationId: string) {
    return this.prisma.deploymentAuditLog.findMany({
      where: { integrationId },
      orderBy: { executedAt: 'desc' },
    });
  }
}
