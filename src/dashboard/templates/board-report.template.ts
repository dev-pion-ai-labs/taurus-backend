interface BoardReportData {
  companyName: string;
  date: string;
  currentScore: number | null;
  previousScore: number | null;
  maturityLevel: string | null;
  valueRealized: number;
  valueIdentified: number;
  departmentScores: {
    department: string;
    score: number;
    maturityLevel: string;
  }[];
  topRecommendations: {
    title: string;
    department: string;
    annualValue: number;
  }[];
  sprintVelocity: {
    sprints: { sprint: string; completedActions: number; valueDelivered: number }[];
    averageVelocity: number;
  };
  stackOverview: {
    totalTools: number;
    monthlySpend: number;
    activeTools: number;
  };
}

export function boardReportTemplate(data: BoardReportData): string {
  const scoreColor =
    (data.currentScore ?? 0) >= 60
      ? '#22c55e'
      : (data.currentScore ?? 0) >= 40
        ? '#f59e0b'
        : '#ef4444';

  const trendArrow =
    data.previousScore != null && data.currentScore != null
      ? data.currentScore > data.previousScore
        ? '&#9650;'
        : data.currentScore < data.previousScore
          ? '&#9660;'
          : '&#9644;'
      : '';

  const trendColor =
    data.previousScore != null && data.currentScore != null
      ? data.currentScore > data.previousScore
        ? '#22c55e'
        : data.currentScore < data.previousScore
          ? '#ef4444'
          : '#71717a'
      : '#71717a';

  const formatCurrency = (value: number) =>
    value >= 1_000_000
      ? `$${(value / 1_000_000).toFixed(1)}M`
      : value >= 1_000
        ? `$${(value / 1_000).toFixed(0)}K`
        : `$${value}`;

  const deptRows = data.departmentScores
    .map((d) => {
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
        <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7;">${d.maturityLevel.replace(/_/g, ' ')}</td>
      </tr>`;
    })
    .join('');

  const recsRows = data.topRecommendations
    .slice(0, 5)
    .map(
      (r, i) =>
        `<tr>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7;">${i + 1}. ${r.title}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7;">${r.department}</td>
        <td style="padding: 8px 12px; border-bottom: 1px solid #e4e4e7; text-align: right;">${formatCurrency(r.annualValue)}</td>
      </tr>`,
    )
    .join('');

  const velocityRows = data.sprintVelocity.sprints
    .slice(-5)
    .map(
      (s) =>
        `<tr>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7;">${s.sprint}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7; text-align: center;">${s.completedActions}</td>
        <td style="padding: 6px 12px; border-bottom: 1px solid #e4e4e7; text-align: right;">${formatCurrency(s.valueDelivered)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #18181b; margin: 0; padding: 40px; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #7c3aed; padding-bottom: 16px; margin-bottom: 32px; }
    .logo { font-size: 28px; font-weight: 800; color: #7c3aed; }
    .date { font-size: 14px; color: #71717a; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 16px; color: #7c3aed; margin: 32px 0 12px; border-bottom: 1px solid #e4e4e7; padding-bottom: 8px; }
    .score-card { text-align: center; padding: 24px; background: #f5f3ff; border-radius: 12px; margin: 16px 0; }
    .score-big { font-size: 64px; font-weight: 800; color: ${scoreColor}; }
    .score-label { font-size: 14px; color: #71717a; }
    .trend { font-size: 20px; color: ${trendColor}; margin-left: 8px; }
    .stats-grid { display: flex; gap: 16px; margin: 16px 0; }
    .stat-box { flex: 1; background: #fafafa; border-radius: 8px; padding: 16px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: 700; color: #7c3aed; }
    .stat-label { font-size: 12px; color: #71717a; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 8px 12px; background: #f5f3ff; font-weight: 600; font-size: 12px; text-transform: uppercase; color: #7c3aed; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e4e4e7; font-size: 12px; color: #a1a1aa; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">TAURUS</div>
      <h1>AI Transformation Board Report</h1>
      <div class="date">${data.companyName} &mdash; ${data.date}</div>
    </div>
  </div>

  <div class="score-card">
    <div class="score-big">${data.currentScore ?? 'N/A'}<span style="font-size: 24px;">/100</span><span class="trend">${trendArrow}</span></div>
    <div class="score-label">AI Maturity Score${data.maturityLevel ? ` — ${data.maturityLevel.replace(/_/g, ' ')}` : ''}</div>
  </div>

  <div class="stats-grid">
    <div class="stat-box">
      <div class="stat-value">${formatCurrency(data.valueRealized)}</div>
      <div class="stat-label">Value Realized</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${formatCurrency(data.valueIdentified)}</div>
      <div class="stat-label">Value Identified</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${data.stackOverview.totalTools}</div>
      <div class="stat-label">Tools in Stack</div>
    </div>
    <div class="stat-box">
      <div class="stat-value">${formatCurrency(data.stackOverview.monthlySpend)}/mo</div>
      <div class="stat-label">Stack Spend</div>
    </div>
  </div>

  <h2>Department Heatmap</h2>
  <table>
    <thead><tr><th>Department</th><th style="text-align:center;">Score</th><th>Maturity Level</th></tr></thead>
    <tbody>${deptRows || '<tr><td colspan="3" style="padding: 12px; color: #71717a;">No department data available</td></tr>'}</tbody>
  </table>

  <h2>Top 5 Recommendations</h2>
  <table>
    <thead><tr><th>Recommendation</th><th>Department</th><th style="text-align:right;">Annual Value</th></tr></thead>
    <tbody>${recsRows || '<tr><td colspan="3" style="padding: 12px; color: #71717a;">No recommendations available</td></tr>'}</tbody>
  </table>

  <h2>Sprint Velocity</h2>
  <table>
    <thead><tr><th>Sprint</th><th style="text-align:center;">Completed</th><th style="text-align:right;">Value Delivered</th></tr></thead>
    <tbody>${velocityRows || '<tr><td colspan="3" style="padding: 12px; color: #71717a;">No sprint data available</td></tr>'}</tbody>
  </table>
  <p style="font-size: 13px; color: #71717a;">Average velocity: ${data.sprintVelocity.averageVelocity} actions/sprint</p>

  <div class="footer">
    <p>Generated by Taurus AI Transformation OS &mdash; Powered by MARQAIT AI</p>
  </div>
</body>
</html>`;
}
