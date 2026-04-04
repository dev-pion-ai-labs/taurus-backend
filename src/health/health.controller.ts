import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma';
import { RedisService } from '../redis';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Get()
  async check() {
    const checks: Record<string, string> = { status: 'ok' };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = 'connected';
    } catch {
      checks.db = 'disconnected';
      checks.status = 'degraded';
    }

    try {
      await this.redis.ping();
      checks.redis = 'connected';
    } catch {
      checks.redis = 'disconnected';
      checks.status = 'degraded';
    }

    return checks;
  }
}
