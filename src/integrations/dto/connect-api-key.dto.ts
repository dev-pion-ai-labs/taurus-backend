import { IsString, IsEnum, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IntegrationProvider } from '@prisma/client';

export class ConnectApiKeyDto {
  @ApiProperty({ enum: IntegrationProvider })
  @IsEnum(IntegrationProvider)
  provider: IntegrationProvider;

  @ApiProperty({ description: 'The API key or bearer token' })
  @IsString()
  apiKey: string;

  @ApiPropertyOptional({ description: 'Human-readable label for this connection' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ type: [String], description: 'Permission scopes' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];
}
