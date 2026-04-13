import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsInt,
  IsArray,
  Min,
  Max,
} from 'class-validator';

enum ToolCategory {
  AI_PLATFORM = 'AI_PLATFORM',
  AUTOMATION = 'AUTOMATION',
  ANALYTICS = 'ANALYTICS',
  CRM = 'CRM',
  COMMUNICATION = 'COMMUNICATION',
  DEVELOPMENT = 'DEVELOPMENT',
  SECURITY = 'SECURITY',
  INDUSTRY_SPECIFIC = 'INDUSTRY_SPECIFIC',
  OTHER = 'OTHER',
}

enum ToolStatus {
  IDENTIFIED = 'IDENTIFIED',
  EVALUATING = 'EVALUATING',
  ACTIVE = 'ACTIVE',
  DEPRECATED = 'DEPRECATED',
}

export class CreateToolDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(ToolCategory)
  category?: ToolCategory;

  @IsOptional()
  @IsEnum(ToolStatus)
  status?: ToolStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departmentIds?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyCost?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  userCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
