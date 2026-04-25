import { wrapEmailTemplate, emailStyles } from './email-base.template';

interface RenewalAlertData {
  toolName: string;
  renewalDate: string;
  monthlyCost: number | null;
  utilizationPercent: number | null;
  orgName: string;
}

export function renewalAlertTemplate(data: RenewalAlertData): string {
  const costDisplay =
    data.monthlyCost != null
      ? `$${data.monthlyCost.toLocaleString()}/mo`
      : 'Not tracked';
  const utilizationDisplay =
    data.utilizationPercent != null
      ? `${data.utilizationPercent}%`
      : 'Not measured';

  const content = `
    <div style="display: inline-block; padding: 4px 10px; background: #FEF3C7; border: 1px solid #FDE68A; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 1px; color: #B45309; text-transform: uppercase; margin-bottom: 14px;">Renewal coming up</div>
    <h2 style="${emailStyles.h2}">Contract renewal coming up</h2>
    <p style="${emailStyles.p}">A tool contract in <strong style="color: #1C1917;">${data.orgName}</strong> is approaching its renewal window:</p>

    <div style="${emailStyles.calloutAmber}">
      <div style="font-size: 11px; font-weight: 600; letter-spacing: 1.2px; color: #B45309; text-transform: uppercase; margin-bottom: 4px;">Tool</div>
      <div style="font-size: 17px; font-weight: 700; color: #1C1917; line-height: 1.3; margin-bottom: 14px;">${data.toolName}</div>

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top: 1px solid #FDE68A; padding-top: 10px;">
        <tr>
          <td style="padding: 4px 0; font-size: 13px; color: #78716C; width: 45%;">Renewal date</td>
          <td style="padding: 4px 0; font-size: 13px; color: #1C1917; font-weight: 600; text-align: right;">${data.renewalDate}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; font-size: 13px; color: #78716C;">Monthly cost</td>
          <td style="padding: 4px 0; font-size: 13px; color: #1C1917; font-weight: 600; text-align: right;">${costDisplay}</td>
        </tr>
        <tr>
          <td style="padding: 4px 0; font-size: 13px; color: #78716C;">Feature utilisation</td>
          <td style="padding: 4px 0; font-size: 13px; color: #1C1917; font-weight: 600; text-align: right;">${utilizationDisplay}</td>
        </tr>
      </table>
    </div>

    <p style="${emailStyles.p}">Review ROI and utilisation before the date so you have time to renew, renegotiate, or replace.</p>
  `;

  return wrapEmailTemplate(content, {
    preheader: `${data.toolName} renews ${data.renewalDate} &mdash; ${costDisplay}, ${utilizationDisplay} utilisation.`,
  });
}
