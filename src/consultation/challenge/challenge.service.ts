import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class ChallengeService {
  constructor(private prisma: PrismaService) {}

  async list() {
    return this.prisma.challengeArea.findMany({ orderBy: { name: 'asc' } });
  }

  async findByKeys(keys: string[]) {
    return this.prisma.challengeArea.findMany({
      where: { normalizedKey: { in: keys } },
    });
  }

  normalizeKey(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '_')
      .trim();
  }
}
