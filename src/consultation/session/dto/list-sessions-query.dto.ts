import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ConsultationScope } from '@prisma/client';
import { PaginationQueryDto } from '../../../common';

export class ListSessionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ConsultationScope })
  @IsOptional()
  @IsEnum(ConsultationScope)
  scope?: ConsultationScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workflowId?: string;
}
