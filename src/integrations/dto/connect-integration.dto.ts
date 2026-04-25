import { IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConnectIntegrationDto {
  @ApiProperty({ description: 'OAuth authorization code from provider callback' })
  @IsString()
  @MinLength(1)
  code: string;

  @ApiPropertyOptional({ description: 'OAuth redirect URI used in the authorize step' })
  @IsOptional()
  @IsString()
  redirectUri?: string;

  @ApiPropertyOptional({
    description:
      'Opaque state value returned by the provider — base64url-encoded JSON of {orgId, userId, provider}. Verified server-side to prevent cross-user code injection.',
  })
  @IsOptional()
  @IsString()
  state?: string;
}
