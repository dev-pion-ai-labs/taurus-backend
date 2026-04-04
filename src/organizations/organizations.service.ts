import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto';
import { PaginationQueryDto, PaginatedResponseDto } from '../common';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrganizationDto) {
    // Verify industry exists
    const industry = await this.prisma.industry.findUnique({
      where: { id: dto.industryId },
    });
    if (!industry) throw new BadRequestException('Invalid industry');

    // Create org and assign user as ADMIN
    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        industryId: dto.industryId,
        size: dto.size,
      },
      include: { industry: true },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { organizationId: org.id, role: 'ADMIN' },
    });

    return org;
  }

  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: { industry: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(id: string, dto: UpdateOrganizationDto) {
    return this.prisma.organization.update({
      where: { id },
      data: dto,
      include: { industry: true },
    });
  }

  async getMembers(orgId: string, query: PaginationQueryDto) {
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { organizationId: orgId },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where: { organizationId: orgId } }),
    ]);

    return new PaginatedResponseDto(users, total, query);
  }
}
