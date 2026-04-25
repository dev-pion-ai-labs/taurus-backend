import { wrapEmailTemplate, emailStyles } from './email-base.template';

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

  const content = `
    <div style="display: inline-block; padding: 4px 10px; background: #FFF1F2; border: 1px solid #FECACA; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 1px; color: #E11D48; text-transform: uppercase; margin-bottom: 14px;">Report ready</div>
    <h2 style="${emailStyles.h2}">Your AI Transformation Report is ready</h2>
    <p style="${emailStyles.p}">${data.userName ? `Hi ${data.userName},` : 'Hi,'}</p>
    <p style="${emailStyles.p}">The AI transformation analysis for <strong style="color: #1C1917;">${data.orgName}</strong> is complete. Here&rsquo;s the headline:</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${emailStyles.statsRow}">
      <tr class="stat-row">
        <td class="stat" align="center" width="33%" style="padding: 4px;">
          <div style="${emailStyles.statValue}">${data.overallScore}<span style="font-size: 16px; color: #A8A29E; font-weight: 600;">/100</span></div>
          <div style="${emailStyles.statLabel}">Maturity score</div>
        </td>
        <td class="stat" align="center" width="34%" style="padding: 4px; border-left: 1px solid #E7E5E4; border-right: 1px solid #E7E5E4;">
          <div style="${emailStyles.statValue}; font-size: 18px;">${maturityLabel}</div>
          <div style="${emailStyles.statLabel}">Level</div>
        </td>
        <td class="stat" align="center" width="33%" style="padding: 4px;">
          <div style="${emailStyles.statValue}; background: linear-gradient(135deg, #E11D48 0%, #F59E0B 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">${formattedValue}</div>
          <div style="${emailStyles.statLabel}">Potential value</div>
        </td>
      </tr>
    </table>

    <p style="${emailStyles.p}">The full report includes department-level scoring, a quantified opportunity stack, and a phased implementation roadmap with dollar-weighted recommendations.</p>

    <div style="text-align: center; margin: 28px 0 8px;">
      <a href="${data.reportUrl}" class="btn" style="${emailStyles.btnGradient}">View full report &rarr;</a>
    </div>
  `;

  return wrapEmailTemplate(content, {
    preheader: `${data.orgName}: ${data.overallScore}/100 maturity, ${formattedValue} potential value identified.`,
  });
}
