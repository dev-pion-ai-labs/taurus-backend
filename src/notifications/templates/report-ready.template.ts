import { wrapEmailTemplate } from './email-base.template';

interface ReportReadyData {
  userName?: string;
  orgName: string;
  overallScore: number;
  maturityLevel: string;
  totalValue: number;
  reportUrl: string;
}

export function reportReadyTemplate(data: ReportReadyData): string {
  const maturityLabel = data.maturityLevel
    .replace(/_/g, ' ')
    .replace(/\bAI\b/g, 'AI')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

  const formattedValue =
    data.totalValue >= 1_000_000
      ? `$${(data.totalValue / 1_000_000).toFixed(1)}M`
      : `$${(data.totalValue / 1_000).toFixed(0)}K`;

  return wrapEmailTemplate(`
    <h2>Your AI Transformation Report is Ready</h2>
    <p>${data.userName ? `Hi ${data.userName},` : 'Hi,'}</p>
    <p>Great news! The AI transformation analysis for <strong>${data.orgName}</strong> is complete.</p>

    <div style="text-align: center; padding: 20px 0; border-top: 1px solid #e4e4e7; border-bottom: 1px solid #e4e4e7; margin: 20px 0;">
      <div class="stat">
        <div class="stat-value">${data.overallScore}/100</div>
        <div class="stat-label">Maturity Score</div>
      </div>
      <div class="stat">
        <div class="stat-value">${maturityLabel}</div>
        <div class="stat-label">Level</div>
      </div>
      <div class="stat">
        <div class="stat-value">${formattedValue}</div>
        <div class="stat-label">Potential Value</div>
      </div>
    </div>

    <p>Your report includes department-level scoring, identified opportunities, and a phased implementation roadmap with dollar-quantified recommendations.</p>

    <div style="text-align: center;">
      <a href="${data.reportUrl}" class="btn">View Full Report</a>
    </div>
  `);
}
