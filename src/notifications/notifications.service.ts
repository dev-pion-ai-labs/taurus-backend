import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { reportReadyTemplate } from './templates/report-ready.template';
import { sessionReminderTemplate } from './templates/session-reminder.template';
import { discoverySummaryTemplate } from './templates/discovery-summary.template';

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
    const html = `
      <h2>Your verification code</h2>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">${code}</p>
      <p>This code expires in 10 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `;
    await this.sendEmail(email, 'Your Taurus login code', html);
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
}
