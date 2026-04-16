import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(private prisma: PrismaService) {}

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

    let accessToken = connection.accessToken;

    // Refresh token if expired
    if (connection.tokenExpiresAt && new Date() >= connection.tokenExpiresAt) {
      accessToken = await this.refreshToken(connection.id, connection.refreshToken);
    }

    try {
      // Create file metadata
      const metadata = {
        name: title,
        mimeType: 'application/vnd.google-apps.document', // Convert to Google Doc
      };

      // Use multipart upload
      const boundary = 'taurus_export_boundary';
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

      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Google Drive upload failed: ${error}`);

        if (response.status === 401) {
          await this.prisma.integrationConnection.update({
            where: { id: connection.id },
            data: { status: 'EXPIRED' },
          });
          throw new BadRequestException(
            'Google Drive token expired — please reconnect in Settings',
          );
        }

        throw new BadRequestException('Failed to export to Google Drive');
      }

      const file = (await response.json()) as {
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
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`Google Drive export failed: ${(error as Error).message}`);
      throw new BadRequestException('Failed to export to Google Drive');
    }
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

  // ── Token refresh ──────────────────────────────────────

  private async refreshToken(
    connectionId: string,
    refreshToken: string | null,
  ): Promise<string> {
    if (!refreshToken) {
      throw new BadRequestException(
        'Google Drive token expired and no refresh token available — please reconnect',
      );
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId || '',
        client_secret: clientSecret || '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      throw new BadRequestException(
        'Failed to refresh Google Drive token — please reconnect',
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    await this.prisma.integrationConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: data.access_token,
        tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
      },
    });

    return data.access_token;
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
    lines.push(`| FTE Redeployable | ${r.fteRedeployable || 0} |`);
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
