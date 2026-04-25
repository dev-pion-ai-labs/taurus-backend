import { wrapEmailTemplate, emailStyles } from './email-base.template';

interface SessionReminderData {
  userName?: string;
  orgName: string;
  questionsAnswered: number;
  totalQuestions: number;
  resumeUrl: string;
}

export function sessionReminderTemplate(data: SessionReminderData): string {
  const progress = Math.round(
    (data.questionsAnswered / data.totalQuestions) * 100,
  );
  const remaining = data.totalQuestions - data.questionsAnswered;

  const content = `
    <div style="display: inline-block; padding: 4px 10px; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 1px; color: #B45309; text-transform: uppercase; margin-bottom: 14px;">Pick up where you left off</div>
    <h2 style="${emailStyles.h2}">Your consultation is waiting</h2>
    <p style="${emailStyles.p}">${data.userName ? `Hi ${data.userName},` : 'Hi,'}</p>
    <p style="${emailStyles.p}">You&rsquo;ve started an AI transformation consultation for <strong style="color: #1C1917;">${data.orgName}</strong>. A few more questions and you&rsquo;ll unlock the full report.</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 22px 0;">
      <tr>
        <td style="background: #FAFAF9; border: 1px solid #E7E5E4; border-radius: 12px; padding: 22px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td>
                <div style="font-size: 11px; font-weight: 600; letter-spacing: 1.2px; color: #78716C; text-transform: uppercase;">Progress</div>
                <div style="font-size: 28px; font-weight: 800; color: #1C1917; letter-spacing: -0.02em; margin-top: 2px;">${progress}<span style="font-size: 16px; color: #A8A29E; font-weight: 600;">%</span></div>
              </td>
              <td align="right">
                <div style="font-size: 11px; font-weight: 600; letter-spacing: 1.2px; color: #78716C; text-transform: uppercase;">Questions left</div>
                <div style="font-size: 28px; font-weight: 800; color: #E11D48; letter-spacing: -0.02em; margin-top: 2px;">${remaining}</div>
              </td>
            </tr>
          </table>
          <div style="height: 8px; background: #E7E5E4; border-radius: 999px; margin-top: 14px; overflow: hidden;">
            <div style="height: 8px; width: ${progress}%; background-color: #E11D48; background-image: linear-gradient(90deg, #E11D48 0%, #F59E0B 100%); border-radius: 999px;"></div>
          </div>
        </td>
      </tr>
    </table>

    <p style="${emailStyles.p}">Finishing unlocks maturity scoring, department-level opportunities, and a dollar-quantified roadmap.</p>

    <div style="text-align: center; margin: 28px 0 8px;">
      <a href="${data.resumeUrl}" class="btn" style="${emailStyles.btnPrimary}">Continue consultation &rarr;</a>
    </div>
  `;

  return wrapEmailTemplate(content, {
    preheader: `${progress}% complete &mdash; ${remaining} question${remaining === 1 ? '' : 's'} left to unlock your report.`,
  });
}
