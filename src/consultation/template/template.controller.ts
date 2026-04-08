import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { TemplateService } from './template.service';
import { TemplateGeneratorService } from './template-generator.service';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  PaginationQueryDto,
} from '../../common';

@ApiTags('Consultation Templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('consultation/templates')
export class TemplateController {
  constructor(
    private templateService: TemplateService,
    private templateGeneratorService: TemplateGeneratorService,
  ) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  list(@Query() query: PaginationQueryDto) {
    return this.templateService.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templateService.findById(id);
  }

  @Post(':id/regenerate')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  regenerate(@Param('id') id: string) {
    return this.templateGeneratorService.regenerate(id);
  }
}
