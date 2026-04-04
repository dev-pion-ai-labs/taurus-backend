import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { PaginationQueryDto, PaginatedResponseDto } from '../../common';

@Injectable()
export class TemplateService {
  constructor(private prisma: PrismaService) {}

  async getBaseTemplate() {
    const template = await this.prisma.consultationTemplate.findFirst({
      where: { type: 'BASE', status: 'ACTIVE' },
      include: {
        questions: { orderBy: { orderIndex: 'asc' } },
      },
    });
    if (!template) throw new NotFoundException('Base template not found');
    return template;
  }

  async getIndustryTemplate(industryId: string) {
    return this.prisma.consultationTemplate.findFirst({
      where: {
        type: 'INDUSTRY',
        industryId,
        status: 'ACTIVE',
      },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { challengeAreas: { include: { challengeArea: true } } },
        },
      },
    });
  }

  async findById(id: string) {
    const template = await this.prisma.consultationTemplate.findUnique({
      where: { id },
      include: {
        questions: { orderBy: { orderIndex: 'asc' } },
        industry: true,
      },
    });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  async list(query: PaginationQueryDto) {
    const [templates, total] = await Promise.all([
      this.prisma.consultationTemplate.findMany({
        skip: query.skip,
        take: query.limit,
        include: {
          industry: true,
          _count: { select: { questions: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.consultationTemplate.count(),
    ]);

    return new PaginatedResponseDto(templates, total, query);
  }
}
