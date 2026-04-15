import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ example: 'We need OAuth setup before this can proceed.' })
  @IsString()
  @MinLength(1)
  content: string;
}
