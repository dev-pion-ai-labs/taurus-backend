import { IsString } from 'class-validator';

export class LinkOrgDto {
  @IsString()
  organizationId: string;
}
