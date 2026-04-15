import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations';
import { DeploymentController } from './deployment.controller';
import { DeploymentOrchestratorService } from './deployment-orchestrator.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [DeploymentController],
  providers: [DeploymentOrchestratorService],
  exports: [DeploymentOrchestratorService],
})
export class DeploymentModule {}
