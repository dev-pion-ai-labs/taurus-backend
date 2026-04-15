import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma';
import { AiService } from '../ai';
import { WebsiteScraperService } from '../onboarding/website-scraper.service';
import { NotificationsService } from '../notifications';
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

        // Calculate financial totals
        const totalEfficiencyValue = reportData.departmentScores.reduce(
          (sum, d) => sum + (d.efficiencyValue || 0),
          0,
        );
        const totalGrowthValue = reportData.departmentScores.reduce(
          (sum, d) => sum + (d.growthValue || 0),
          0,
        );

        // Save report
        const saveStart = Date.now();
        await this.prisma.transformationReport.update({
          where: { id: reportId },
          data: {
            status: 'COMPLETED',
            overallScore: reportData.overallScore,
            maturityLevel: reportData.maturityLevel,
            totalEfficiencyValue,
            totalGrowthValue,
            totalAiValue: totalEfficiencyValue + totalGrowthValue,
            fteRedeployable: reportData.fteRedeployable,
            executiveSummary: reportData.executiveSummary as any,
            departmentScores: reportData.departmentScores as any,
            recommendations: reportData.recommendations as any,
            implementationPlan: reportData.implementationPlan as any,
            generatedAt: new Date(),
          },
        });

        this.logger.log(
          `[${reportId}] Report saved in ${Date.now() - saveStart}ms. Total: ${((Date.now() - start) / 1000).toFixed(1)}s | Value: $${(totalEfficiencyValue + totalGrowthValue).toLocaleString()}`,
        );

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
              totalValue: totalEfficiencyValue + totalGrowthValue,
            });
          }
        } catch (notifError) {
          this.logger.warn(
            `[${reportId}] Failed to send report-ready notification: ${(notifError as Error).message}`,
          );
        }
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
    const [org, onboarding, departments, sessionQuestions] = await Promise.all([
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
