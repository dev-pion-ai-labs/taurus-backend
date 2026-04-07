import {
  IsString,
  IsUUID,
  IsOptional,
  IsArray,
  MinLength,
  ValidateIf,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitOnboardingDto {
  // Step 1: Basic Info
  @ApiProperty()
  @IsString()
  @MinLength(1)
  companyName: string;

  @ApiPropertyOptional({ example: 'https://example.com' })
  @IsOptional()
  @IsString()
  companyUrl?: string;

  @ApiProperty()
  @IsUUID()
  industryId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customIndustry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  companySize?: string;

  // Step 2: Business Context
  @ApiProperty()
  @IsString()
  @MinLength(10)
  businessDescription: string;

  @ApiProperty()
  @IsString()
  @MinLength(10)
  revenueStreams: string;

  // Step 3: Challenges (at least one of selectedChallenges or customChallenges)
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedChallenges?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customChallenges?: string;

  // Step 4: Data Availability (at least one of availableData or customDataSources)
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableData?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customDataSources?: string;

  // Step 6: Tools/Tech Stack (at least one of selectedTools or customTools)
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedTools?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customTools?: string;

  // Step 7: Goals (at least one of selectedGoals or customGoals)
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selectedGoals?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customGoals?: string;
}
