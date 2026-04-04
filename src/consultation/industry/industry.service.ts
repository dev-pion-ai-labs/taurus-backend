import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { SearchIndustryDto } from './dto/search-industry.dto';
import { PaginatedResponseDto } from '../../common';

@Injectable()
export class IndustryService {
  constructor(private prisma: PrismaService) {}

  async list(query: SearchIndustryDto) {
    const where = query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { aliases: { has: query.search.toLowerCase() } },
          ],
        }
      : {};

    const [industries, total] = await Promise.all([
      this.prisma.industry.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.industry.count({ where }),
    ]);

    return new PaginatedResponseDto(industries, total, query);
  }

  async findById(id: string) {
    const industry = await this.prisma.industry.findUnique({ where: { id } });
    if (!industry) throw new NotFoundException('Industry not found');
    return industry;
  }

  normalizeKey(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }

  async resolve(input: string) {
    const key = this.normalizeKey(input);

    // Try exact match
    let industry = await this.prisma.industry.findUnique({
      where: { normalizedKey: key },
    });
    if (industry) return industry;

    // Try alias match
    industry = await this.prisma.industry.findFirst({
      where: { aliases: { has: key } },
    });
    if (industry) return industry;

    // Create new
    return this.prisma.industry.create({
      data: {
        name: input,
        normalizedKey: key,
      },
    });
  }
}
