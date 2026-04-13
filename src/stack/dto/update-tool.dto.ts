import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsInt, IsDateString, Min, Max } from 'class-validator';
import { CreateToolDto } from './create-tool.dto';

export class UpdateToolDto extends PartialType(CreateToolDto) {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  utilizationPercent?: number;

  @IsOptional()
  @IsDateString()
  contractStartDate?: string;

  @IsOptional()
  @IsDateString()
  contractEndDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  renewalAlertDays?: number;
}
