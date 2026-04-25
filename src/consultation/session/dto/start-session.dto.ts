import { IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ConsultationScope } from '@prisma/client';

export class StartSessionDto {
  @ApiPropertyOptional({
    enum: ConsultationScope,
    default: ConsultationScope.ORG,
    description: 'Consultation scope. Defaults to ORG.',
  })
  @IsOptional()
  @IsEnum(ConsultationScope)
  scope?: ConsultationScope;

  @ApiPropertyOptional({
    description: 'Required when scope is DEPARTMENT or WORKFLOW.',
  })
  @ValidateIf((o) => o.scope === ConsultationScope.DEPARTMENT || o.scope === ConsultationScope.WORKFLOW)
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({
    description: 'Required when scope is WORKFLOW.',
  })
  @ValidateIf((o) => o.scope === ConsultationScope.WORKFLOW)
  @IsUUID()
  workflowId?: string;
}
