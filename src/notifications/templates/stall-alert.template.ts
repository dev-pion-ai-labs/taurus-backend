import { wrapEmailTemplate } from './email-base.template';

interface StallAlertData {
  userName?: string;
  actionTitle: string;
  daysSinceUpdate: number;
  trackerUrl: string;
}

export function stallAlertTemplate(data: StallAlertData): string {
  return wrapEmailTemplate(`
    <h2>Action Stalled: Needs Attention</h2>
    <p>${data.userName ? `Hi ${data.userName},` : 'Hi,'}</p>
    <p>The following transformation action has not been updated in <strong>${data.daysSinceUpdate} days</strong>:</p>

    <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin: 16px 0;">
      <strong>${data.actionTitle}</strong>
    </div>

    <p>This may indicate a blocker or resource issue. Please review and update the action status, or add a blocker note if there's an impediment.</p>

    <div style="text-align: center;">
      <a href="${data.trackerUrl}" class="btn">View in Tracker</a>
    </div>
  `);
}
