import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { PrismaService } from '../prisma';
import { NotificationsService } from '../notifications';

@Processor('tracker-alerts')
export class TrackerStallProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(TrackerStallProcessor.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    @InjectQueue('tracker-alerts') private trackerAlertsQueue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.trackerAlertsQueue.add(
      'check-stalled-actions',
      {},
      {
        repeat: { every: 86400000 }, // 24 hours
        jobId: 'daily-stall-check',
      },
    );
    this.logger.log('Registered daily stall check repeatable job');
  }

  async process(job: Job) {
    if (job.name !== 'check-stalled-actions') {
      this.logger.warn(`Unknown job type: ${job.name}`);
      return;
    }

    const start = Date.now();
    this.logger.log('Starting daily stall check across all organizations');

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const stalledActions = await this.prisma.transformationAction.findMany({
      where: {
        status: { in: ['IN_PROGRESS', 'AWAITING_APPROVAL'] },
        updatedAt: { lt: fiveDaysAgo },
      },
      include: {
        assignee: { select: { email: true, firstName: true } },
        organization: { select: { id: true, name: true } },
      },
    });

    this.logger.log(`Found ${stalledActions.length} stalled actions`);

    let sentCount = 0;
    for (const action of stalledActions) {
      if (!action.assignee?.email) continue;

      const daysSinceUpdate = Math.floor(
        (Date.now() - action.updatedAt.getTime()) / (1000 * 60 * 60 * 24),
      );

      try {
        await this.notifications.sendStallAlert({
          email: action.assignee.email,
          userName: action.assignee.firstName ?? undefined,
          actionTitle: action.title,
          daysSinceUpdate,
          trackerUrl: `${process.env.CORS_ORIGIN || 'http://localhost:3001'}/tracker`,
        });
        sentCount++;
      } catch (error) {
        this.logger.warn(
          `Failed to send stall alert for action ${action.id}: ${(error as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Stall check completed in ${Date.now() - start}ms — sent ${sentCount} alerts`,
    );
  }
}
