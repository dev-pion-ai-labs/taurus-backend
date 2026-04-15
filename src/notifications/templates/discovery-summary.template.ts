import { wrapEmailTemplate } from './email-base.template';

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

  return wrapEmailTemplate(`
    <h2>Your AI Readiness Snapshot</h2>
    <p>Here are the results from scanning <strong>${data.url}</strong>:</p>

    <div style="text-align: center; padding: 20px 0; border-top: 1px solid #e4e4e7; border-bottom: 1px solid #e4e4e7; margin: 20px 0;">
      <div class="stat">
        <div class="stat-value">${data.score}/100</div>
        <div class="stat-label">Estimated Score</div>
      </div>
      <div class="stat">
        <div class="stat-value">${maturityLabel}</div>
        <div class="stat-label">Level</div>
      </div>
    </div>

    <p>${data.summary}</p>

    <p>This is a preliminary estimate based on publicly available information. For a comprehensive analysis with department-level scoring and a dollar-quantified roadmap, start a full consultation.</p>

    <div style="text-align: center;">
      <a href="${data.consultationUrl}" class="btn">Get Full Analysis</a>
    </div>
  `);
}
