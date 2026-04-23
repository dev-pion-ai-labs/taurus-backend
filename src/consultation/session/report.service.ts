import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('analysis') private analysisQueue: Queue,
  ) {}

  async getReport(sessionId: string, organizationId: string) {
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.organizationId !== organizationId) {
      throw new ForbiddenException("Not your organization's session");
    }

    const report = await this.prisma.transformationReport.findUnique({
      where: { sessionId },
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  async regenerateReport(
    sessionId: string,
    userId: string,
    organizationId: string,
  ) {
    // Verify session
    const session = await this.prisma.consultationSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.organizationId !== organizationId) {
      throw new ForbiddenException("Not your organization's session");
    }
    if (session.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Session must be completed to regenerate report',
      );
    }

    // Verify user is ADMIN
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (user?.role !== 'ADMIN') {
      throw new ForbiddenException('Only admins can regenerate reports');
    }

    // Upsert report as GENERATING
    const report = await this.prisma.transformationReport.upsert({
      where: { sessionId },
      create: {
        sessionId,
        organizationId: session.organizationId,
        status: 'GENERATING',
      },
      update: {
        status: 'GENERATING',
        overallScore: null,
        maturityLevel: null,
        totalEfficiencyValue: null,
        totalGrowthValue: null,
        totalAiValue: null,
        executiveSummary: Prisma.DbNull,
        departmentScores: Prisma.DbNull,
        recommendations: Prisma.DbNull,
        implementationPlan: Prisma.DbNull,
        generatedAt: null,
      },
    });

    // Queue regeneration
    await this.analysisQueue.add('generate-report', {
      reportId: report.id,
      sessionId: session.id,
      organizationId: session.organizationId,
    });

    return { id: report.id, sessionId, status: report.status };
  }

  async exportReportPdf(
    sessionId: string,
    organizationId: string,
  ): Promise<Buffer> {
    const report = await this.getReport(sessionId, organizationId);

    if (report.status !== 'COMPLETED') {
      throw new BadRequestException('Report is not completed yet');
    }

    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { industry: true },
    });

    const departmentScores = (report.departmentScores as any[]) || [];
    const recommendations = (report.recommendations as any[]) || [];
    const implementationPlan = (report.implementationPlan as any[]) || [];
    const executiveSummary = (report.executiveSummary as any) || {};

    const formatCurrency = (value: number) =>
      value >= 1_000_000
        ? `$${(value / 1_000_000).toFixed(1)}M`
        : value >= 1_000
          ? `$${(value / 1_000).toFixed(0)}K`
          : `$${value}`;

    const scoreColor = (score: number) =>
      score >= 70 ? '#16a34a' : score >= 40 ? '#d97706' : '#dc2626';

    const deptRows = departmentScores
      .map((d: any) => {
        const bg =
          d.score >= 60
            ? '#dcfce7'
            : d.score >= 40
              ? '#fef9c3'
              : '#fecaca';
        return `<tr>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7;">${d.department}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; text-align: center;">
            <span style="background: ${bg}; padding: 2px 10px; border-radius: 4px; font-weight: 600;">${d.score}</span>
          </td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7;">${(d.maturityLevel || '').replace(/_/g, ' ')}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; text-align: right;">${formatCurrency(d.efficiencyValue || 0)}</td>
          <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; text-align: right;">${formatCurrency(d.growthValue || 0)}</td>
        </tr>`;
      })
      .join('');

    const recsRows = recommendations
      .sort((a: any, b: any) => (b.annualValue || 0) - (a.annualValue || 0))
      .slice(0, 10)
      .map(
        (r: any, i: number) =>
          `<tr>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7;">${i + 1}. ${r.title}</td>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7;">${r.department}</td>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7; text-align: center;">${r.impact}</td>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7; text-align: center;">${r.effort}</td>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7; text-align: right;">${formatCurrency(r.annualValue || 0)}</td>
        </tr>`,
      )
      .join('');

    const phaseRows = implementationPlan
      .map(
        (p: any) =>
          `<tr>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7; font-weight: 600;">Phase ${p.phase}: ${p.name}</td>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7;">${p.timeframe}</td>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7;">${p.focus}</td>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7; text-align: right;">${formatCurrency(p.totalValue || 0)}</td>
          <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7; text-align: center;">${(p.actions || []).length} actions</td>
        </tr>`,
      )
      .join('');

    const generatedDate = report.generatedAt
      ? new Date(report.generatedAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      : new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #18181b; margin: 0; padding: 40px; background: #fff; }
    .header { border-bottom: 3px solid #1C1917; padding-bottom: 16px; margin-bottom: 32px; }
    .logo { font-size: 28px; font-weight: 800; color: #1C1917; }
    .date { font-size: 14px; color: #71717a; margin-top: 4px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 16px; color: #1C1917; margin: 32px 0 12px; border-bottom: 1px solid #e4e4e7; padding-bottom: 8px; }
    .score-card { text-align: center; padding: 24px; background: #fafafa; border-radius: 12px; margin: 16px 0; }
    .score-big { font-size: 64px; font-weight: 800; color: ${scoreColor(report.overallScore ?? 0)}; }
    .stats-grid { display: flex; gap: 16px; margin: 16px 0; }
    .stat-box { flex: 1; background: #fafafa; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: 700; color: #1C1917; }
    .stat-label { font-size: 12px; color: #71717a; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; background: #fafafa; font-weight: 600; font-size: 12px; text-transform: uppercase; color: #71717a; }
    .summary-text { font-size: 14px; line-height: 1.7; color: #3f3f46; margin: 12px 0; }
    .finding { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0; font-size: 14px; color: #3f3f46; }
    .finding::before { content: "\\2713"; color: #16a34a; font-weight: bold; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e4e4e7; font-size: 12px; color: #a1a1aa; text-align: center; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">TAURUS</div>
    <h1>AI Transformation Report</h1>
    <div class="date">${org.name} &mdash; ${generatedDate}</div>
  </div>

  <div class="score-card">
    <div class="score-big">${report.overallScore ?? 'N/A'}<span style="font-size: 24px;">/100</span></div>
    <div style="font-size: 14px; color: #71717a;">AI Maturity Score${report.maturityLevel ? ` — ${(report.maturityLevel || '').replace(/_/g, ' ')}` : ''}</div>
  </div>

  <div class="stats-grid">
    <div class="stat-box">
      <div class="stat-value">${formatCurrency(report.totalAiValue ?? 0)}</div>
      <div class="stat-label">Total AI Value</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${formatCurrency(report.totalEfficiencyValue ?? 0)}</div>
      <div class="stat-label">Efficiency Value</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${formatCurrency(report.totalGrowthValue ?? 0)}</div>
      <div class="stat-label">Growth Value</div>
    </div>
  </div>

  ${executiveSummary.summary ? `
  <h2>Executive Summary</h2>
  <p class="summary-text">${executiveSummary.summary}</p>
  ${(executiveSummary.keyFindings || []).map((f: string) => `<div class="finding">${f}</div>`).join('')}
  ` : ''}

  <h2>Department Scores</h2>
  <table>
    <thead><tr><th>Department</th><th style="text-align:center;">Score</th><th>Maturity</th><th style="text-align:right;">Efficiency</th><th style="text-align:right;">Growth</th></tr></thead>
    <tbody>${deptRows || '<tr><td colspan="5" style="padding: 12px; color: #71717a;">No data</td></tr>'}</tbody>
  </table>

  <h2>Top Recommendations</h2>
  <table>
    <thead><tr><th>Recommendation</th><th>Department</th><th style="text-align:center;">Impact</th><th style="text-align:center;">Effort</th><th style="text-align:right;">Annual Value</th></tr></thead>
    <tbody>${recsRows || '<tr><td colspan="5" style="padding: 12px; color: #71717a;">No data</td></tr>'}</tbody>
  </table>

  <h2>Implementation Roadmap</h2>
  <table>
    <thead><tr><th>Phase</th><th>Timeframe</th><th>Focus</th><th style="text-align:right;">Value</th><th style="text-align:center;">Actions</th></tr></thead>
    <tbody>${phaseRows || '<tr><td colspan="5" style="padding: 12px; color: #71717a;">No data</td></tr>'}</tbody>
  </table>

  <div class="footer">
    <p>Confidential — Generated by Taurus AI Transformation OS — Powered by MARQAIT AI</p>
  </div>
</body>
</html>`;

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
      });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  }
}
