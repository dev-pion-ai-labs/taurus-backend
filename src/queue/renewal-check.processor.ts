import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { PrismaService } from '../prisma';
import { NotificationsService } from '../notifications';

@Processor('renewal-alerts')
export class RenewalCheckProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(RenewalCheckProcessor.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    @InjectQueue('renewal-alerts') private renewalAlertsQueue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.renewalAlertsQueue.add(
      'check-renewals',
      {},
      {
        repeat: { every: 86400000 }, // 24 hours
        jobId: 'daily-renewal-check',
      },
    );
    this.logger.log('Registered daily renewal check repeatable job');
  }

  async process(job: Job) {
    if (job.name !== 'check-renewals') {
      this.logger.warn(`Unknown job type: ${job.name}`);
      return;
    }

    const start = Date.now();
    this.logger.log('Starting daily renewal check');

    const now = new Date();

    // Find tools with contractEndDate within their renewalAlertDays
    const tools = await this.prisma.toolEntry.findMany({
      where: {
        contractEndDate: { not: null },
      },
      include: {
        organization: {
          include: {
            users: {
              where: { role: 'ADMIN' },
              select: { email: true },
            },
          },
        },
      },
    });

    let sentCount = 0;
    for (const tool of tools) {
      if (!tool.contractEndDate) continue;

      const alertDays = tool.renewalAlertDays ?? 30;
      const alertDate = new Date(tool.contractEndDate);
      alertDate.setDate(alertDate.getDate() - alertDays);

      // Only alert if we're within the alert window and before the end date
      if (now >= alertDate && now <= tool.contractEndDate) {
        const adminEmails = tool.organization.users.map((u) => u.email);

        for (const email of adminEmails) {
          try {
            await this.notifications.sendRenewalAlert({
              email,
              toolName: tool.name,
              renewalDate: tool.contractEndDate.toISOString().split('T')[0],
              monthlyCost: tool.monthlyCost,
              utilizationPercent: tool.utilizationPercent,
              orgName: tool.organization.name,
            });
            sentCount++;
          } catch (error) {
            this.logger.warn(
              `Failed to send renewal alert for tool ${tool.id}: ${(error as Error).message}`,
            );
          }
        }
      }
    }

    this.logger.log(
      `Renewal check completed in ${Date.now() - start}ms — sent ${sentCount} alerts`,
    );
  }
}
