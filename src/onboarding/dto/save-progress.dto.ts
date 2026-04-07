import { IsInt, Min, Max, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveProgressDto {
  @ApiProperty({ description: 'Current step number (1-7)', example: 3 })
  @IsInt()
  @Min(1)
  @Max(7)
  step: number;

  @ApiPropertyOptional({ description: 'Partial onboarding data for this step' })
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
