import { wrapEmailTemplate, emailStyles } from './email-base.template';

interface StallAlertData {
  userName?: string;
  actionTitle: string;
  daysSinceUpdate: number;
  trackerUrl: string;
}

export function stallAlertTemplate(data: StallAlertData): string {
  const content = `
    <div style="display: inline-block; padding: 4px 10px; background: #FFF1F2; border: 1px solid #FECACA; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 1px; color: #E11D48; text-transform: uppercase; margin-bottom: 14px;">Needs attention</div>
    <h2 style="${emailStyles.h2}">An action has stalled</h2>
    <p style="${emailStyles.p}">${data.userName ? `Hi ${data.userName},` : 'Hi,'}</p>
    <p style="${emailStyles.p}">A transformation action hasn&rsquo;t moved in <strong style="color: #1C1917;">${data.daysSinceUpdate} days</strong>:</p>

    <div style="${emailStyles.calloutRose}">
      <div style="font-size: 11px; font-weight: 600; letter-spacing: 1.2px; color: #E11D48; text-transform: uppercase; margin-bottom: 4px;">Stalled action</div>
      <div style="font-size: 16px; font-weight: 700; color: #1C1917; line-height: 1.4;">${data.actionTitle}</div>
    </div>

    <p style="${emailStyles.p}">This usually means a blocker, a missing owner, or a resource gap. A quick status update or a blocker note keeps the workstream honest.</p>

    <div style="text-align: center; margin: 28px 0 8px;">
      <a href="${data.trackerUrl}" class="btn" style="${emailStyles.btnPrimary}">Open in tracker &rarr;</a>
    </div>
  `;

  return wrapEmailTemplate(content, {
    preheader: `Action stalled ${data.daysSinceUpdate} days: ${data.actionTitle}`,
  });
}
