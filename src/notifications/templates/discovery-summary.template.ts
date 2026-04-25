import { wrapEmailTemplate, emailStyles } from './email-base.template';

interface DiscoverySummaryData {
  url: string;
  score: number;
  maturityLevel: string;
  summary: string;
  consultationUrl: string;
}

export function discoverySummaryTemplate(
  data: DiscoverySummaryData,
): string {
  const maturityLabel = data.maturityLevel
    .replace(/_/g, ' ')
    .replace(/\bAI\b/g, 'AI')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

  const content = `
    <div style="display: inline-block; padding: 4px 10px; background: #FFF7ED; border: 1px solid #FED7AA; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 1px; color: #EA580C; text-transform: uppercase; margin-bottom: 14px;">Snapshot</div>
    <h2 style="${emailStyles.h2}">Your AI Readiness Snapshot</h2>
    <p style="${emailStyles.p}">Here&rsquo;s what we found scanning <strong style="color: #1C1917;">${data.url}</strong>:</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="${emailStyles.statsRow}">
      <tr class="stat-row">
        <td class="stat" align="center" width="50%" style="padding: 4px;">
          <div style="${emailStyles.statValue}">${data.score}<span style="font-size: 16px; color: #A8A29E; font-weight: 600;">/100</span></div>
          <div style="${emailStyles.statLabel}">Estimated score</div>
        </td>
        <td class="stat" align="center" width="50%" style="padding: 4px; border-left: 1px solid #E7E5E4;">
          <div style="${emailStyles.statValue}; font-size: 18px;">${maturityLabel}</div>
          <div style="${emailStyles.statLabel}">Maturity level</div>
        </td>
      </tr>
    </table>

    <div style="${emailStyles.calloutAmber}">
      <div style="font-size: 11px; font-weight: 600; letter-spacing: 1.2px; color: #B45309; text-transform: uppercase; margin-bottom: 6px;">Summary</div>
      <div style="font-size: 14px; line-height: 1.6; color: #1C1917;">${data.summary}</div>
    </div>

    <p style="${emailStyles.pMuted}">This is a preliminary estimate from publicly available signals. A full consultation gives you department-level scoring, opportunity quantification, and a dollar-weighted roadmap.</p>

    <div style="text-align: center; margin: 28px 0 8px;">
      <a href="${data.consultationUrl}" class="btn" style="${emailStyles.btnGradient}">Get full analysis &rarr;</a>
    </div>
  `;

  return wrapEmailTemplate(content, {
    preheader: `${data.url}: ${data.score}/100 readiness, ${maturityLabel}.`,
  });
}
