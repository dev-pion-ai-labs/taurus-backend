import { IsInt, IsBoolean, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateChecklistDto {
  @ApiProperty({ description: 'Zero-based line index of the checklist item' })
  @IsInt()
  @Min(0)
  lineIndex: number;

  @ApiProperty({ description: 'Whether the item is checked' })
  @IsBoolean()
  checked: boolean;
}
