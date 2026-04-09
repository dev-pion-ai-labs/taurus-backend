import { IsEnum, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MoveActionDto {
  @ApiProperty({
    enum: ['BACKLOG', 'THIS_SPRINT', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'DEPLOYED', 'VERIFIED'],
  })
  @IsEnum(['BACKLOG', 'THIS_SPRINT', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'DEPLOYED', 'VERIFIED'])
  status: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  orderIndex: number;
}
