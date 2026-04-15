import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsUUID,
  IsInt,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateActionDto {
  @ApiProperty({ example: 'Deploy automated ticket categorization' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Support' })
  @IsOptional()
  @IsString()
  department?: string;

  @ApiPropertyOptional({ enum: ['EFFICIENCY', 'GROWTH', 'EXPERIENCE', 'INTELLIGENCE'] })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  @IsOptional()
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority?: string;

  @ApiPropertyOptional({ example: 43000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedValue?: number;

  @ApiPropertyOptional({ enum: ['HOURS', 'DAYS', 'WEEKS', 'MONTHS'] })
  @IsOptional()
  @IsEnum(['HOURS', 'DAYS', 'WEEKS', 'MONTHS'])
  estimatedEffort?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  phase?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sprintId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}
