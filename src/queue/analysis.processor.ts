import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma';
import { AiService } from '../ai';
import { WebsiteScraperService } from '../onboarding/website-scraper.service';
import { NotificationsService } from '../notifications';
import { SlackService } from '../integrations/services/slack.service';
import { TrackerService } from '../tracker/tracker.service';
import type { ReportGenerationContext } from '../ai/prompts/report-generation.prompt';

interface ReportGenerationJob {
  reportId: string;
  sessionId: string;
  organizationId: string;
}

interface WebsiteScrapingJob {
  organizationId: string;
  companyUrl: string;
}

interface DiscoveryScanJob {
  reportId: string;
  url: string;
  email?: string;
  industry?: string;
}

@Processor('analysis', { concurrency: 2 })
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private websiteScraper: WebsiteScraperService,
    private notifications: NotificationsService,
    private slack: SlackService,
    private tracker: TrackerService,
  ) {
    super();
  }

  async process(job: Job<ReportGenerationJob | WebsiteScrapingJob | DiscoveryScanJob>) {
    if (job.name === 'generate-report') {
      const { reportId, sessionId, organizationId } =
        job.data as ReportGenerationJob;
      const start = Date.now();
      this.logger.log(
        `[${reportId}] Starting report generation (session: ${sessionId}, attempt: ${job.attemptsMade + 1}/${job.opts.attempts ?? '?'})`,
      );

      try {
        // Gather all context
        const ctxStart = Date.now();
        const context = await this.gatherContext(sessionId, organizationId);
        this.logger.log(
          `[${reportId}] Context gathered in ${Date.now() - ctxStart}ms — ${context.departments.length} departments, ${context.consultationAnswers.length} answers`,
        );

        // Generate report via Claude
        const aiStart = Date.now();
        const reportData =
          await this.aiService.generateTransformationReport(context);
        this.logger.log(
          `[${reportId}] AI generation completed in ${((Date.now() - aiStart) / 1000).toFixed(1)}s — score: ${reportData.overallScore}, ${reportData.departmentScores.length} depts, ${reportData.recommendations.length} recs`,
        );

        // Legacy totals (derived from the projected department scores for
        // backward compatibility with the current dashboard)
        const totalEfficiencyValue = reportData.departmentScores.reduce(
          (sum, d) => sum + (d.efficiencyValue || 0),
          0,
        );
        const totalGrowthValue = reportData.departmentScores.reduce(
          (sum, d) => sum + (d.growthValue || 0),
          0,
        );

        // New briefing shape — these are the source of truth going forward
        const briefing = reportData.briefing;
        const valueSummary = briefing.executiveBrief.valueSummary;
        const totalAiValueLow = valueSummary.low;
        const totalAiValueHigh = valueSummary.high;
        const valueMidpoint = Math.round((totalAiValueLow + totalAiValueHigh) / 2);

        // Save report
        const saveStart = Date.now();
        await this.prisma.transformationReport.update({
          where: { id: reportId },
          data: {
            status: 'COMPLETED',
            // Legacy fields (kept populated for current frontend)
            overallScore: reportData.overallScore,
            maturityLevel: reportData.maturityLevel,
            totalEfficiencyValue,
            totalGrowthValue,
            totalAiValue: totalEfficiencyValue + totalGrowthValue,
            executiveSummary: reportData.executiveSummary as any,
            departmentScores: reportData.departmentScores as any,
            recommendations: reportData.recommendations as any,
            implementationPlan: reportData.implementationPlan as any,
            // New briefing fields
            companyType: briefing.companyType,
            primaryAudience: briefing.primaryAudience,
            reportGoal: briefing.reportGoal,
            thesis: briefing.executiveBrief.thesis,
            bigMove: briefing.executiveBrief.bigMove,
            totalAiValueLow,
            totalAiValueHigh,
            confidenceNote: valueSummary.confidenceNote,
            snapshot: briefing.snapshot as any,
            executiveBrief: briefing.executiveBrief as any,
            decisionBlocks: briefing.decisionBlocks as any,
            assumptionsAndLimits: briefing.assumptionsAndLimitations as any,
            peerContext: briefing.peerContext as any,
            generatedAt: new Date(),
          },
        });

        this.logger.log(
          `[${reportId}] Report saved in ${Date.now() - saveStart}ms. Total: ${((Date.now() - start) / 1000).toFixed(1)}s | Value range: $${totalAiValueLow.toLocaleString()}-$${totalAiValueHigh.toLocaleString()} (midpoint $${valueMidpoint.toLocaleString()}) | Audience: ${briefing.primaryAudience} | CompanyType: ${briefing.companyType}`,
        );

        // Auto-seed Tracker actions from the report's recommendations so the
        // user doesn't need to click "Import to Tracker" after the report
        // completes. The tracker's importFromReport is idempotent (dedupes by
        // sourceRecommendationId), so a later manual re-import is safe.
        try {
          const importResult = await this.tracker.importFromReport(
            sessionId,
            organizationId,
          );
          this.logger.log(
            `[${reportId}] Auto-seeded tracker — imported ${importResult.imported}, skipped ${importResult.skipped}`,
          );
        } catch (seedError) {
          this.logger.warn(
            `[${reportId}] Auto-seed failed (report still succeeded): ${(seedError as Error).message}`,
          );
        }

        // Send "report ready" notification
        try {
          const session = await this.prisma.consultationSession.findUnique({
            where: { id: sessionId },
            include: { user: true, organization: true },
          });
          if (session?.user?.email) {
            await this.notifications.sendReportReady({
              email: session.user.email,
              userName: session.user.firstName ?? undefined,
              orgName: session.organization.name,
              reportId,
              sessionId,
              overallScore: reportData.overallScore,
              maturityLevel: reportData.maturityLevel,
              totalValue: valueMidpoint,
            });
          }
        } catch (notifError) {
          this.logger.warn(
            `[${reportId}] Failed to send report-ready notification: ${(notifError as Error).message}`,
          );
        }

        // Slack notification
        this.slack
          .notifyReportReady(
            organizationId,
            reportData.overallScore,
            reportData.maturityLevel,
            valueMidpoint,
          )
          .catch(() => {});
      } catch (error) {
        this.logger.error(
          `[${reportId}] Report generation failed after ${((Date.now() - start) / 1000).toFixed(1)}s: ${(error as Error).message}`,
          (error as Error).stack,
        );

        await this.prisma.transformationReport.update({
          where: { id: reportId },
          data: { status: 'FAILED' },
        });

        throw error;
      }
    } else if (job.name === 'scrape-website') {
      const { organizationId, companyUrl } = job.data as WebsiteScrapingJob;
      const start = Date.now();
      this.logger.log(
        `[${organizationId}] Starting website scraping for ${companyUrl}`,
      );

      try {
        // Update status to IN_PROGRESS
        await this.prisma.onboarding.update({
          where: { organizationId },
          data: { scrapingStatus: 'IN_PROGRESS' },
        });

        const scrapedData = await this.websiteScraper.scrapeWebsite(companyUrl);

        // If scraper returned an error object (graceful failure), treat as failed
        if (scrapedData.error && !scrapedData.title) {
          throw new Error(`Scraping failed: ${scrapedData.error}`);
        }

        // Update with completed data
        await this.prisma.onboarding.update({
          where: { organizationId },
          data: {
            scrapingStatus: 'COMPLETED',
            scrapedContent: scrapedData as any,
            scrapedAt: new Date(),
          },
        });

        this.logger.log(
          `[${organizationId}] Website scraping completed in ${((Date.now() - start) / 1000).toFixed(1)}s`,
        );
      } catch (error) {
        // Update status to FAILED
        await this.prisma.onboarding.update({
          where: { organizationId },
          data: { scrapingStatus: 'FAILED' },
        });

        this.logger.error(
          `[${organizationId}] Website scraping failed after ${((Date.now() - start) / 1000).toFixed(1)}s: ${(error as Error).message}`,
          (error as Error).stack,
        );
        throw error;
      }
    } else if (job.name === 'discovery-scan') {
      const { reportId, url, email, industry } =
        job.data as DiscoveryScanJob;
      const start = Date.now();
      this.logger.log(
        `[${reportId}] Starting discovery scan for ${url}`,
      );

      try {
        // Scrape the website
        const scrapedData = await this.websiteScraper.scrapeWebsite(url);

        if (scrapedData.error && !scrapedData.title) {
          throw new Error(`Scraping failed: ${scrapedData.error}`);
        }

        // Run AI analysis on scraped data
        const analysisResult = await this.aiService.analyzeDiscoveryScan({
          url,
          industry,
          scrapedData: {
            title: scrapedData.title,
            description: scrapedData.description,
            mainContent: scrapedData.mainContent,
            techStack: scrapedData.businessData?.technologies,
            aiSignals: scrapedData.businessData?.aiMentions,
            automationSignals: scrapedData.businessData?.automationMentions,
            products: scrapedData.businessData?.products,
            services: scrapedData.businessData?.services,
            companyInfo: scrapedData.businessData?.companyInfo,
          },
        });

        // Save results
        await this.prisma.discoveryReport.update({
          where: { id: reportId },
          data: {
            status: 'COMPLETED',
            score: analysisResult.score,
            maturityLevel: analysisResult.maturityLevel,
            industry: analysisResult.industry,
            companySize: analysisResult.companySize,
            techStack: analysisResult.techStack as any,
            aiSignals: analysisResult.aiSignals as any,
            summary: analysisResult.summary,
            recommendations: analysisResult.recommendations as any,
            scrapedData: scrapedData as any,
          },
        });

        this.logger.log(
          `[${reportId}] Discovery scan completed in ${((Date.now() - start) / 1000).toFixed(1)}s — score: ${analysisResult.score}`,
        );

        // Send email if provided
        if (email) {
          await this.notifications.sendDiscoverySummary({
            email,
            url,
            score: analysisResult.score,
            maturityLevel: analysisResult.maturityLevel,
            summary: analysisResult.summary,
          });
        }
      } catch (error) {
        this.logger.error(
          `[${reportId}] Discovery scan failed after ${((Date.now() - start) / 1000).toFixed(1)}s: ${(error as Error).message}`,
          (error as Error).stack,
        );

        await this.prisma.discoveryReport.update({
          where: { id: reportId },
          data: { status: 'FAILED' },
        });

        throw error;
      }
    } else {
      this.logger.error(`Unknown job type: ${job.name}`);
      throw new Error(`Unknown job type: ${job.name}`);
    }
  }

  private async gatherContext(
    sessionId: string,
    organizationId: string,
  ): Promise<ReportGenerationContext> {
    const [session, org, onboarding, allDepartments, sessionQuestions] =
      await Promise.all([
        this.prisma.consultationSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: {
            scope: true,
            departmentId: true,
            workflowId: true,
            department: { select: { id: true, name: true } },
            workflow: {
              select: {
                id: true,
                name: true,
                departmentId: true,
                department: { select: { id: true, name: true } },
              },
            },
          },
        }),
        this.prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          include: { industry: true },
        }),
        this.prisma.onboarding.findUnique({
          where: { organizationId },
          select: {
            businessDescription: true,
            revenueStreams: true,
            selectedChallenges: true,
            customChallenges: true,
            selectedTools: true,
            customTools: true,
            selectedGoals: true,
            customGoals: true,
            availableData: true,
            customDataSources: true,
            scrapedContent: true,
          },
        }),
        this.prisma.department.findMany({
          where: { organizationId },
          include: { workflows: true },
        }),
        this.prisma.sessionQuestion.findMany({
          where: { sessionId, answeredAt: { not: null } },
          include: { question: true },
          orderBy: { orderIndex: 'asc' },
        }),
      ]);

    // Narrow departments/workflows to the scoped entity. Org-scoped sessions
    // get the full set; department-scoped sessions get just that department;
    // workflow-scoped sessions get the parent department with only that workflow.
    let departments = allDepartments;
    if (session.scope === 'DEPARTMENT' && session.departmentId) {
      departments = allDepartments.filter((d) => d.id === session.departmentId);
    } else if (
      session.scope === 'WORKFLOW' &&
      session.workflowId &&
      session.workflow
    ) {
      departments = allDepartments
        .filter((d) => d.id === session.workflow!.departmentId)
        .map((d) => ({
          ...d,
          workflows: d.workflows.filter((w) => w.id === session.workflowId),
        }));
    }

    const scopeContext =
      session.scope === 'DEPARTMENT' && session.department
        ? {
            scope: 'DEPARTMENT' as const,
            departmentName: session.department.name,
          }
        : session.scope === 'WORKFLOW' && session.workflow
          ? {
              scope: 'WORKFLOW' as const,
              workflowName: session.workflow.name,
              departmentName: session.workflow.department?.name,
            }
          : { scope: 'ORG' as const };

    // Extract scraped website intelligence if available
    const scraped = onboarding?.scrapedContent as Record<string, any> | null;
    const scrapedInsights = scraped?.businessData
      ? {
          title: scraped.title || null,
          description: scraped.description || null,
          products: (scraped.businessData.products || []).map((p: any) => p.name || p).filter(Boolean),
          services: (scraped.businessData.services || []).map((s: any) => s.name || s).filter(Boolean),
          technologies: scraped.businessData.technologies || [],
          aiDetected: !!scraped.businessData.aiDetected,
          aiMentions: scraped.businessData.aiMentions || [],
          automationDetected: !!scraped.businessData.automationDetected,
          automationMentions: scraped.businessData.automationMentions || [],
          companyInfo: scraped.businessData.companyInfo || {},
          businessModel: scraped.businessData.businessModel || null,
        }
      : undefined;

    return {
      scopeContext,
      organization: {
        name: org.name,
        industry: org.industry.name,
        size: org.size,
      },
      scrapedInsights,
      onboarding: {
        businessDescription: onboarding?.businessDescription || '',
        revenueStreams: onboarding?.revenueStreams || '',
        challenges: onboarding?.selectedChallenges || [],
        customChallenges: onboarding?.customChallenges || '',
        tools: onboarding?.selectedTools || [],
        customTools: onboarding?.customTools || '',
        goals: onboarding?.selectedGoals || [],
        customGoals: onboarding?.customGoals || '',
        dataSources: onboarding?.availableData || [],
        customDataSources: onboarding?.customDataSources || '',
      },
      departments: departments.map((d) => ({
        name: d.name,
        headcount: d.headcount,
        avgSalary: d.avgSalary,
        workflows: d.workflows.map((w) => ({
          name: w.name,
          description: w.description,
          weeklyHours: w.weeklyHours,
          peopleInvolved: w.peopleInvolved,
          automationLevel: w.automationLevel,
          painPoints: w.painPoints,
          priority: w.priority,
        })),
      })),
      consultationAnswers: sessionQuestions.map((sq) => ({
        section: sq.section,
        question: sq.isAdaptive
          ? sq.adaptiveText!
          : sq.question!.questionText,
        questionType: sq.isAdaptive
          ? sq.adaptiveType!
          : sq.question!.questionType,
        answer: (sq.answer as any)?.value ?? sq.answer,
      })),
    };
  }
}
