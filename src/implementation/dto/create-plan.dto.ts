import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePlanDto {
  @ApiProperty({ description: 'ID of the transformation action to plan' })
  @IsUUID()
  actionId: string;
}
