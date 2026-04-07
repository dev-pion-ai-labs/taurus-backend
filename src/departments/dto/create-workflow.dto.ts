import {
  IsString,
  IsOptional,
  IsInt,
  IsNumber,
  IsEnum,
  Min,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWorkflowDto {
  @ApiProperty()
  @IsUUID()
  departmentId: string;

  @ApiProperty({ example: 'Lead qualification' })
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'SDRs manually qualify inbound leads...' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 20, description: 'Hours per week spent on this workflow' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weeklyHours?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(0)
  peopleInvolved?: number;

  @ApiPropertyOptional({ enum: ['NONE', 'LOW', 'MODERATE', 'HIGH', 'FULL'] })
  @IsOptional()
  @IsEnum(['NONE', 'LOW', 'MODERATE', 'HIGH', 'FULL'])
  automationLevel?: string;

  @ApiPropertyOptional({ example: 'Slow, inconsistent criteria, missed leads' })
  @IsOptional()
  @IsString()
  painPoints?: string;

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: string;
}
