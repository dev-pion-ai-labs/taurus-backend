import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DiscoveryService } from './discovery.service';
import { ScanUrlDto } from './dto/scan-url.dto';
import { LinkOrgDto } from './dto/link-org.dto';

@Controller('discovery')
export class DiscoveryController {
  constructor(private discoveryService: DiscoveryService) {}

  @Post('scan')
  async scan(@Body() dto: ScanUrlDto) {
    return this.discoveryService.scan(dto);
  }

  @Get(':id')
  async getReport(@Param('id') id: string) {
    return this.discoveryService.getReport(id);
  }

  @Get('domain/:domain')
  @UseGuards(AuthGuard('jwt'))
  async getByDomain(@Param('domain') domain: string) {
    return this.discoveryService.getByDomain(domain);
  }

  @Post(':id/link')
  @UseGuards(AuthGuard('jwt'))
  async linkToOrg(
    @Param('id') id: string,
    @Request() req: any,
    @Body() dto: LinkOrgDto,
  ) {
    return this.discoveryService.linkToOrg(id, dto.organizationId);
  }
}
