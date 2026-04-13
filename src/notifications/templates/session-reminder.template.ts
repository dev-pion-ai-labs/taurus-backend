import { wrapEmailTemplate } from './email-base.template';

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

  return wrapEmailTemplate(`
    <h2>Resume Your AI Consultation</h2>
    <p>${data.userName ? `Hi ${data.userName},` : 'Hi,'}</p>
    <p>You have an incomplete AI transformation consultation for <strong>${data.orgName}</strong>.</p>

    <div style="text-align: center; padding: 20px 0; border-top: 1px solid #e4e4e7; border-bottom: 1px solid #e4e4e7; margin: 20px 0;">
      <div class="stat">
        <div class="stat-value">${progress}%</div>
        <div class="stat-label">Complete</div>
      </div>
      <div class="stat">
        <div class="stat-value">${data.totalQuestions - data.questionsAnswered}</div>
        <div class="stat-label">Questions Left</div>
      </div>
    </div>

    <p>Pick up right where you left off. Completing the consultation unlocks your full AI transformation report with maturity scoring and a dollar-quantified roadmap.</p>

    <div style="text-align: center;">
      <a href="${data.resumeUrl}" class="btn">Continue Consultation</a>
    </div>
  `);
}
