import { IsString, IsArray, ValidateNested, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { IntegrationProvider } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeploymentStepDto {
  @ApiProperty({ enum: IntegrationProvider })
  @IsEnum(IntegrationProvider)
  provider!: IntegrationProvider;

  @ApiProperty({ example: 'create_channel' })
  @IsString()
  action!: string;

  @ApiProperty({ example: { name: 'ops-alerts', topic: 'Automated alerts' } })
  params!: Record<string, unknown>;

  @ApiPropertyOptional({ example: [] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependsOn?: string[];
}

export class CreateDeploymentSessionDto {
  @ApiProperty()
  @IsString()
  planId!: string;

  @ApiProperty({ type: [DeploymentStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeploymentStepDto)
  steps!: DeploymentStepDto[];
}
