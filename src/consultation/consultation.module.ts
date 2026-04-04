import { Module } from '@nestjs/common';
import { AiModule } from '../ai';
import { QueueModule } from '../queue';
import { IndustryService } from './industry/industry.service';
import { IndustryController } from './industry/industry.controller';
import { ChallengeService } from './challenge/challenge.service';
import { TemplateService } from './template/template.service';
import { TemplateGeneratorService } from './template/template-generator.service';
import { TemplateGeneratorProcessor } from './template/template-generator.processor';
import { TemplateController } from './template/template.controller';
import { SessionService } from './session/session.service';
import { SessionController } from './session/session.controller';

@Module({
  imports: [AiModule, QueueModule],
  controllers: [IndustryController, TemplateController, SessionController],
  providers: [
    IndustryService,
    ChallengeService,
    TemplateService,
    TemplateGeneratorService,
    TemplateGeneratorProcessor,
    SessionService,
  ],
  exports: [IndustryService, TemplateService, TemplateGeneratorService],
})
export class ConsultationModule {}
