import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

@Processor('analysis', { concurrency: 2 })
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  async process(job: Job<{ sessionId: string }>) {
    this.logger.log(
      `Processing analysis for session ${job.data.sessionId} (dummy — Phase 2)`,
    );
    // Phase 2: real AI analysis
  }
}
