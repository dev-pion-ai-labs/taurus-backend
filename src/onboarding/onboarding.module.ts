import { Module } from '@nestjs/common';
import { AiModule } from '../ai';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { WebsiteScraperService } from './website-scraper.service';

@Module({
  imports: [AiModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, WebsiteScraperService],
  exports: [OnboardingService, WebsiteScraperService],
})
export class OnboardingModule {}
