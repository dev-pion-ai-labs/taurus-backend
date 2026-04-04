import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(configService: ConfigService) {
    const url = configService.get<string>('redis.url');
    if (url) {
      super(url, { maxRetriesPerRequest: null });
    } else {
      super({
        host: configService.get<string>('redis.host'),
        port: configService.get<number>('redis.port'),
        password: configService.get<string>('redis.password') || undefined,
        maxRetriesPerRequest: null,
      });
    }
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
