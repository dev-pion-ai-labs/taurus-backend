import { IsString, IsOptional, IsEmail, IsUrl } from 'class-validator';

export class ScanUrlDto {
  @IsString()
  @IsUrl({}, { message: 'Please provide a valid URL' })
  url: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  industry?: string;
}
