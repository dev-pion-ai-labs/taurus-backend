import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { otpTemplate } from './templates/otp.template';
import { reportReadyTemplate } from './templates/report-ready.template';
import { sessionReminderTemplate } from './templates/session-reminder.template';
import { discoverySummaryTemplate } from './templates/discovery-summary.template';
import { stallAlertTemplate } from './templates/stall-alert.template';
import { renewalAlertTemplate } from './templates/renewal-alert.template';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly resend: Resend;
  private readonly fromEmail: string;
  private readonly appUrl: string;

  constructor(private configService: ConfigService) {
    this.resend = new Resend(
      this.configService.get<string>('resend.apiKey'),
    );
    this.fromEmail = this.configService.get<string>('resend.fromEmail')!;
    this.appUrl =
      this.configService.get<string>('app.corsOrigin') ||
      'http://localhost:3001';
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: this.fromEmail,
        to,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${to}: ${(error as Error).message}`,
      );
      // Don't throw — notifications should not break the calling flow
    }
  }

  async sendOtp(email: string, code: string): Promise<void> {
    const html = otpTemplate({ code, expiresInMinutes: 10 });
    await this.sendEmail(email, `Your Taurus sign-in code: ${code}`, html);
  }

  async sendReportReady(params: {
    email: string;
    userName?: string;
    orgName: string;
    reportId: string;
    sessionId: string;
    overallScore: number;
    maturityLevel: string;
    totalValue: number;
  }): Promise<void> {
    const html = reportReadyTemplate({
      userName: params.userName,
      orgName: params.orgName,
      overallScore: params.overallScore,
      maturityLevel: params.maturityLevel,
      totalValue: params.totalValue,
      reportUrl: `${this.appUrl}/consultation/${params.sessionId}`,
    });
    await this.sendEmail(
      params.email,
      'Your AI Transformation Report is Ready',
      html,
    );
  }

  async sendSessionReminder(params: {
    email: string;
    userName?: string;
    orgName: string;
    sessionId: string;
    questionsAnswered: number;
    totalQuestions: number;
  }): Promise<void> {
    const html = sessionReminderTemplate({
      userName: params.userName,
      orgName: params.orgName,
      questionsAnswered: params.questionsAnswered,
      totalQuestions: params.totalQuestions,
      resumeUrl: `${this.appUrl}/consultation/${params.sessionId}`,
    });
    await this.sendEmail(
      params.email,
      'Resume Your AI Consultation',
      html,
    );
  }

  async sendDiscoverySummary(params: {
    email: string;
    url: string;
    score: number;
    maturityLevel: string;
    summary: string;
  }): Promise<void> {
    const html = discoverySummaryTemplate({
      url: params.url,
      score: params.score,
      maturityLevel: params.maturityLevel,
      summary: params.summary,
      consultationUrl: `${this.appUrl}/login`,
    });
    await this.sendEmail(
      params.email,
      `AI Readiness Snapshot for ${params.url}`,
      html,
    );
  }

  async sendStallAlert(params: {
    email: string;
    userName?: string;
    actionTitle: string;
    daysSinceUpdate: number;
    trackerUrl: string;
  }): Promise<void> {
    const html = stallAlertTemplate({
      userName: params.userName,
      actionTitle: params.actionTitle,
      daysSinceUpdate: params.daysSinceUpdate,
      trackerUrl: params.trackerUrl,
    });
    await this.sendEmail(
      params.email,
      `Action Stalled: ${params.actionTitle}`,
      html,
    );
  }

  async sendRenewalAlert(params: {
    email: string;
    toolName: string;
    renewalDate: string;
    monthlyCost: number | null;
    utilizationPercent: number | null;
    orgName: string;
  }): Promise<void> {
    const html = renewalAlertTemplate({
      toolName: params.toolName,
      renewalDate: params.renewalDate,
      monthlyCost: params.monthlyCost,
      utilizationPercent: params.utilizationPercent,
      orgName: params.orgName,
    });
    await this.sendEmail(
      params.email,
      `Contract Renewal Coming: ${params.toolName}`,
      html,
    );
  }
}
