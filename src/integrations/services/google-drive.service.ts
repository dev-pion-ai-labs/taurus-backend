import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { TokenManager, RefreshResult } from './token-manager';

@Injectable()
export class GoogleDriveService implements OnModuleInit {
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(
    private prisma: PrismaService,
    private tokenManager: TokenManager,
  ) {}

  onModuleInit() {
    this.tokenManager.registerStrategy('GOOGLE_DRIVE', async (refreshToken) => {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
      };

      const result: RefreshResult = {
        accessToken: data.access_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      };
      if (data.refresh_token) result.refreshToken = data.refresh_token;
      return result;
    });
  }

  /** Export a document to Google Drive as a Google Doc */
  async exportDocument(
    organizationId: string,
    title: string,
    content: string,
    mimeType: 'text/markdown' | 'text/html' | 'text/plain' = 'text/markdown',
  ) {
    const connection = await this.prisma.integrationConnection.findUnique({
      where: {
        organizationId_provider: { organizationId, provider: 'GOOGLE_DRIVE' },
      },
    });

    if (!connection || connection.status !== 'CONNECTED') {
      throw new BadRequestException(
        'Google Drive is not connected — connect it in Settings > Integrations',
      );
    }

    const boundary = 'taurus_export_boundary';
    const metadata = {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
    };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${mimeType}`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const result = await this.tokenManager.withFreshToken(
      connection,
      (token) =>
        fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body,
          },
        ),
      (res) => res.status === 401,
    );

    if (!result.ok) {
      const errorText = await result.text();
      this.logger.error(`Google Drive upload failed: ${result.status} ${errorText}`);

      if (result.status === 401) {
        await this.tokenManager.markExpired(connection.id);
        throw new BadRequestException(
          'Google Drive token expired — please reconnect in Settings',
        );
      }

      throw new BadRequestException('Failed to export to Google Drive');
    }

    const file = (await result.json()) as {
      id: string;
      name: string;
      webViewLink: string;
    };

    this.logger.log(
      `Exported "${title}" to Google Drive for org ${organizationId} — file ${file.id}`,
    );

    return {
      fileId: file.id,
      fileName: file.name,
      webViewLink: file.webViewLink,
    };
  }

  /** Export a transformation report to Google Drive */
  async exportReport(organizationId: string, reportId: string) {
    const report = await this.prisma.transformationReport.findFirst({
      where: { id: reportId, organizationId },
      include: { organization: true },
    });

    if (!report) {
      throw new BadRequestException('Report not found');
    }

    const content = this.formatReportAsMarkdown(report);
    const title = `Taurus AI Report — ${report.organization.name} — ${new Date().toLocaleDateString()}`;

    return this.exportDocument(organizationId, title, content);
  }

  /** Export a deployment artifact to Google Drive */
  async exportArtifact(organizationId: string, artifactId: string) {
    const artifact = await this.prisma.deploymentArtifact.findUnique({
      where: { id: artifactId },
      include: { plan: { select: { organizationId: true } } },
    });

    if (!artifact || artifact.plan.organizationId !== organizationId) {
      throw new BadRequestException('Artifact not found');
    }

    return this.exportDocument(organizationId, artifact.title, artifact.content);
  }

  // ── Report formatting ──────────────────────────────────

  private formatReportAsMarkdown(report: Record<string, unknown>): string {
    const r = report as any;
    const lines: string[] = [
      `# AI Transformation Report — ${r.organization?.name || 'Organization'}`,
      '',
      `**Generated:** ${new Date(r.generatedAt || r.createdAt).toLocaleDateString()}`,
      `**Overall Score:** ${r.overallScore}/100`,
      `**Maturity Level:** ${r.maturityLevel}`,
      '',
    ];

    if (r.executiveSummary?.summary) {
      lines.push('## Executive Summary', '', r.executiveSummary.summary, '');
    }

    if (r.executiveSummary?.keyFindings?.length) {
      lines.push('### Key Findings');
      for (const f of r.executiveSummary.keyFindings) {
        lines.push(`- ${f}`);
      }
      lines.push('');
    }

    lines.push('## Value Identified', '');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Efficiency Value | $${(r.totalEfficiencyValue || 0).toLocaleString()} |`);
    lines.push(`| Growth Value | $${(r.totalGrowthValue || 0).toLocaleString()} |`);
    lines.push(`| Total AI Value | $${(r.totalAiValue || 0).toLocaleString()} |`);
    lines.push('');

    if (r.recommendations?.length) {
      lines.push('## Recommendations', '');
      for (const rec of r.recommendations) {
        lines.push(
          `### ${rec.title}`,
          `- **Department:** ${rec.department}`,
          `- **Impact:** ${rec.impact} | **Effort:** ${rec.effort}`,
          `- **Annual Value:** $${(rec.annualValue || 0).toLocaleString()}`,
          `- **Category:** ${rec.category}`,
          '',
        );
      }
    }

    return lines.join('\n');
  }
}
