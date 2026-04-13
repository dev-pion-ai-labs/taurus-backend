import { IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DeploymentPlanStatus } from '@prisma/client';

export class PlanQueryDto {
  @ApiPropertyOptional({ enum: DeploymentPlanStatus })
  @IsOptional()
  @IsEnum(DeploymentPlanStatus)
  status?: DeploymentPlanStatus;

  @ApiPropertyOptional({ description: 'Filter by action ID' })
  @IsOptional()
  @IsUUID()
  actionId?: string;
}
