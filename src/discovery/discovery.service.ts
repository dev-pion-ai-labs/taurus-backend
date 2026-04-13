import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma';
import { ScanUrlDto } from './dto/scan-url.dto';

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('analysis') private analysisQueue: Queue,
  ) {}

  async scan(dto: ScanUrlDto) {
    const normalizedUrl = dto.url.startsWith('http')
      ? dto.url
      : `https://${dto.url}`;
    const domain = new URL(normalizedUrl).hostname.replace(/^www\./, '');

    // Create the discovery report record
    const report = await this.prisma.discoveryReport.create({
      data: {
        url: normalizedUrl,
        domain,
        email: dto.email,
        industry: dto.industry,
        status: 'GENERATING',
      },
    });

    // Queue the scan job
    await this.analysisQueue.add(
      'discovery-scan',
      {
        reportId: report.id,
        url: normalizedUrl,
        email: dto.email,
        industry: dto.industry,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    this.logger.log(
      `Discovery scan queued for ${domain} (report: ${report.id})`,
    );

    return {
      id: report.id,
      status: report.status,
      url: normalizedUrl,
      domain,
    };
  }

  async getReport(id: string) {
    const report = await this.prisma.discoveryReport.findUnique({
      where: { id },
    });

    if (!report) {
      throw new NotFoundException('Discovery report not found');
    }

    return report;
  }

  async getByDomain(domain: string) {
    const normalizedDomain = domain.replace(/^www\./, '').toLowerCase();

    return this.prisma.discoveryReport.findMany({
      where: { domain: normalizedDomain, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  async getByOrg(organizationId: string) {
    return this.prisma.discoveryReport.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async linkToOrg(reportId: string, organizationId: string) {
    const report = await this.prisma.discoveryReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException('Discovery report not found');
    }

    return this.prisma.discoveryReport.update({
      where: { id: reportId },
      data: { organizationId },
    });
  }
}
