import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto';
import {
  JwtAuthGuard,
  RolesGuard,
  OrgMemberGuard,
  CurrentUser,
  Roles,
  PaginationQueryDto,
} from '../common';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(private orgsService: OrganizationsService) {}

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.orgsService.create(userId, dto);
  }

  @Get(':id')
  @UseGuards(OrgMemberGuard)
  findOne(@Param('id') id: string) {
    return this.orgsService.findById(id);
  }

  @Patch(':id')
  @UseGuards(OrgMemberGuard, RolesGuard)
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.orgsService.update(id, dto);
  }

  @Get(':id/members')
  @UseGuards(OrgMemberGuard)
  getMembers(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.orgsService.getMembers(id, query);
  }
}
