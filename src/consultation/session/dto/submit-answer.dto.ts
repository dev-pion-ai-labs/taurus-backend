import { IsUUID, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubmitAnswerDto {
  @ApiProperty()
  @IsUUID()
  questionId: string;

  @ApiProperty({ description: 'Answer value — string, string[], or number depending on question type' })
  @IsNotEmpty()
  value: string | string[] | number;
}
