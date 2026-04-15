import { wrapEmailTemplate } from './email-base.template';

interface RenewalAlertData {
  toolName: string;
  renewalDate: string;
  monthlyCost: number | null;
  utilizationPercent: number | null;
  orgName: string;
}

export function renewalAlertTemplate(data: RenewalAlertData): string {
  const costDisplay = data.monthlyCost != null
    ? `$${data.monthlyCost.toLocaleString()}/mo`
    : 'Not tracked';
  const utilizationDisplay = data.utilizationPercent != null
    ? `${data.utilizationPercent}%`
    : 'Not measured';

  return wrapEmailTemplate(`
    <h2>Upcoming Contract Renewal</h2>
    <p>A tool contract in <strong>${data.orgName}</strong> is coming up for renewal:</p>

    <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 4px; margin: 16px 0;">
      <strong style="font-size: 16px;">${data.toolName}</strong>
      <div style="margin-top: 8px; font-size: 14px; color: #3f3f46;">
        <div>Renewal Date: <strong>${data.renewalDate}</strong></div>
        <div>Monthly Cost: <strong>${costDisplay}</strong></div>
        <div>Feature Utilization: <strong>${utilizationDisplay}</strong></div>
      </div>
    </div>

    <p>Review the tool's ROI and utilization before renewal to determine whether to renew, renegotiate, or replace.</p>
  `);
}
