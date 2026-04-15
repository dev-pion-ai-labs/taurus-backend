import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefinePlanDto {
  @ApiProperty({ description: 'Follow-up message to refine the plan' })
  @IsString()
  @MinLength(1)
  message: string;
}
