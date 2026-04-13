import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppConfigModule } from './config';
import { PrismaModule } from './prisma';
import { RedisModule } from './redis';
import { QueueModule } from './queue';
import { UsersModule } from './users';
import { AuthModule } from './auth';
import { OrganizationsModule } from './organizations';
import { ConsultationModule } from './consultation';
import { OnboardingModule } from './onboarding';
import { DepartmentsModule } from './departments';
import { DashboardModule } from './dashboard';
import { TrackerModule } from './tracker/tracker.module';
import { StorageModule } from './storage';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications';
import { DiscoveryModule } from './discovery';
import { StackModule } from './stack';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('throttle.ttl')! * 1000,
            limit: config.get<number>('throttle.limit')!,
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    NotificationsModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    ConsultationModule,
    StorageModule,
    OnboardingModule,
    DepartmentsModule,
    DashboardModule,
    TrackerModule,
    DiscoveryModule,
    StackModule,
    HealthModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
