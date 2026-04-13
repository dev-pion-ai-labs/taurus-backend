import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { AiModule } from '../ai';
import { OnboardingModule } from '../onboarding';
import { AnalysisProcessor } from './analysis.processor';
import { TrackerStallProcessor } from './tracker-stall.processor';
import { RenewalCheckProcessor } from './renewal-check.processor';

@Module({
  imports: [
    AiModule,
    OnboardingModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('redis.url');
        if (url) {
          const parsed = new URL(url);
          return {
            connection: {
              host: parsed.hostname,
              port: parseInt(parsed.port, 10),
              username: parsed.username || undefined,
              password: parsed.password || undefined,
              maxRetriesPerRequest: null,
            },
          };
        }
        return {
          connection: {
            host: configService.get<string>('redis.host'),
            port: configService.get<number>('redis.port'),
            password: configService.get<string>('redis.password') || undefined,
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    BullModule.registerQueue(
      {
        name: 'template-generation',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      },
      {
        name: 'analysis',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      },
      {
        name: 'tracker-alerts',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      },
      {
        name: 'renewal-alerts',
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      },
    ),
  ],
  providers: [AnalysisProcessor, TrackerStallProcessor, RenewalCheckProcessor],
  exports: [BullModule],
})
export class QueueModule {}
