import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrganizationDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  name: string;

  @ApiProperty({ description: 'Industry UUID from /industries list' })
  @IsUUID()
  industryId: string;

  @ApiPropertyOptional({ example: '51-200' })
  @IsOptional()
  @IsString()
  size?: string;
}
