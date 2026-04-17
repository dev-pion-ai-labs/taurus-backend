import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectIntegrationDto {
  @ApiProperty({ description: 'OAuth authorization code from provider callback' })
  @IsString()
  @MinLength(1)
  code: string;

  @ApiProperty({ description: 'OAuth redirect URI used in the authorize step', required: false })
  @IsString()
  redirectUri?: string;
}
