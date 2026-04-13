import { IsUUID, IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSpendDto {
  @IsUUID()
  toolEntryId: string;

  @IsDateString()
  month: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
