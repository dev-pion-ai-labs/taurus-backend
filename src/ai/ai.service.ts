import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { buildQuestionGenerationPrompt } from './prompts/question-generation.prompt';
import {
  buildReportGenerationPrompt,
  type ReportGenerationContext,
} from './prompts/report-generation.prompt';
import {
  buildInitialQuestionsPrompt,
  buildAdaptiveFollowUpPrompt,
  type AdaptiveQuestionContext,
  type GeneratedAdaptiveQuestion,
} from './prompts/adaptive-question.prompt';
import {
  buildDiscoveryScanPrompt,
  type DiscoveryScanContext,
  type DiscoveryScanResult,
} from './prompts/discovery-scan.prompt';

export interface GeneratedQuestion {
  questionText: string;
  questionType: 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE';
  options: string[] | null;
  challengeAreaTags: string[];
  rationale: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(private configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ai.anthropicApiKey')!,
    });
    this.model = this.configService.get<string>('ai.anthropicModel')!;
  }

  async generateIndustryQuestions(
    industryName: string,
    challengeAreas: string[],
  ): Promise<GeneratedQuestion[]> {
    const { system, user } = buildQuestionGenerationPrompt(
      industryName,
      challengeAreas,
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const raw =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const text = raw
          .replace(/```json?\s*\n?/gi, '')
          .replace(/```\s*/gi, '')
          .trim();
        const questions: GeneratedQuestion[] = JSON.parse(text);

        if (!Array.isArray(questions) || questions.length < 5) {
          throw new Error(
            `Expected array of 5+ questions, got ${questions.length}`,
          );
        }

        return questions;
      } catch (error) {
        this.logger.warn(
          `AI question generation attempt ${attempt + 1} failed: ${error.message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to generate questions after retries');
  }

  async generateOnboardingInsights(profile: {
    companyName: string;
    industry: string;
    companySize: string | null;
    businessDescription: string;
    revenueStreams: string;
    challenges: string[];
    dataAvailability: string[];
    tools: string[];
    goals: string[];
  }): Promise<OnboardingInsights> {
    const system = `You are a senior AI transformation strategist. Analyze the company profile and return a JSON object with actionable insights. Be specific to the company's industry, size, and stated challenges. Keep each insight concise (1-2 sentences). Return ONLY valid JSON, no markdown.`;

    const user = `Analyze this company profile and provide strategic AI transformation insights:

Company: ${profile.companyName}
Industry: ${profile.industry}
Size: ${profile.companySize || 'Not specified'}
Business: ${profile.businessDescription}
Revenue Streams: ${profile.revenueStreams}
Key Challenges: ${profile.challenges.join(', ')}
Available Data: ${profile.dataAvailability.join(', ')}
Current Tools: ${profile.tools.join(', ')}
AI Goals: ${profile.goals.join(', ')}

Return a JSON object with this exact structure:
{
  "summary": "A 2-3 sentence executive summary of the company's AI readiness and biggest opportunity",
  "readinessScore": <number 1-100 based on data availability, tool maturity, and clarity of goals>,
  "topOpportunities": [
    { "title": "short title", "description": "1-2 sentence description of the opportunity", "impact": "HIGH" | "MEDIUM" | "LOW", "timeframe": "SHORT" | "MEDIUM" | "LONG" }
  ],
  "quickWins": ["3-5 specific quick wins they can achieve in 30 days based on their tools and data"],
  "risks": ["2-3 key risks or gaps to address before scaling AI initiatives"],
  "recommendedNextSteps": ["3-4 ordered next steps for their AI transformation journey"]
}`;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const raw =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const text = raw
          .replace(/```json?\s*\n?/gi, '')
          .replace(/```\s*$/gi, '')
          .trim();
        const insights: OnboardingInsights = JSON.parse(text);
        return insights;
      } catch (error) {
        this.logger.warn(
          `AI insights generation attempt ${attempt + 1} failed: ${error.message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to generate insights after retries');
  }

  async generateTransformationReport(
    context: ReportGenerationContext,
  ): Promise<TransformationReportData> {
    const { system, user } = buildReportGenerationPrompt(context);

    this.logger.log(
      `Report generation starting — model: ${this.model}, max_tokens: 16384`,
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      const attemptStart = Date.now();
      try {
        this.logger.log(
          `Report attempt ${attempt + 1}/3 — calling Claude API...`,
        );

        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 16384,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(1);
        this.logger.log(
          `Report attempt ${attempt + 1}/3 — API responded in ${elapsed}s, stop_reason: ${response.stop_reason}, usage: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
        );

        if (response.stop_reason === 'max_tokens') {
          throw new Error(
            `Response truncated at ${response.usage.output_tokens} output tokens — increase max_tokens`,
          );
        }

        const text =
          response.content[0].type === 'text' ? response.content[0].text : '';

        // Strip potential markdown code fences
        const cleaned = text
          .replace(/```json?\s*\n?/gi, '')
          .replace(/```\s*/gi, '')
          .trim();

        const report: TransformationReportData = JSON.parse(cleaned);

        // Basic validation
        if (
          typeof report.overallScore !== 'number' ||
          !report.maturityLevel ||
          !Array.isArray(report.departmentScores) ||
          !Array.isArray(report.recommendations) ||
          !Array.isArray(report.implementationPlan)
        ) {
          throw new Error('Report JSON missing required fields');
        }

        return report;
      } catch (error) {
        const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(1);
        this.logger.warn(
          `Report attempt ${attempt + 1}/3 failed after ${elapsed}s: ${error.message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to generate report after retries');
  }

  async generateInitialPersonalizedQuestions(
    ctx: AdaptiveQuestionContext,
  ): Promise<GeneratedAdaptiveQuestion[]> {
    const { system, user } = buildInitialQuestionsPrompt(ctx);
    return this.callForQuestions(system, user, 5, 'initial personalized');
  }

  async generateAdaptiveFollowUps(
    ctx: AdaptiveQuestionContext,
  ): Promise<GeneratedAdaptiveQuestion[]> {
    const { system, user } = buildAdaptiveFollowUpPrompt(ctx);
    return this.callForQuestions(system, user, 2, 'adaptive follow-up');
  }

  private async callForQuestions(
    system: string,
    user: string,
    minExpected: number,
    label: string,
  ): Promise<GeneratedAdaptiveQuestion[]> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const raw =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const text = raw
          .replace(/```json?\s*\n?/gi, '')
          .replace(/```\s*/gi, '')
          .trim();
        const questions: GeneratedAdaptiveQuestion[] = JSON.parse(text);

        if (!Array.isArray(questions) || questions.length < minExpected) {
          throw new Error(
            `Expected ${minExpected}+ questions, got ${questions.length}`,
          );
        }

        return questions;
      } catch (error) {
        this.logger.warn(
          `AI ${label} generation attempt ${attempt + 1} failed: ${(error as Error).message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error(`Failed to generate ${label} questions after retries`);
  }

  async analyzeDiscoveryScan(
    ctx: DiscoveryScanContext,
  ): Promise<DiscoveryScanResult> {
    const { system, user } = buildDiscoveryScanPrompt(ctx);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const raw =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const text = raw
          .replace(/```json?\s*\n?/gi, '')
          .replace(/```\s*/gi, '')
          .trim();
        const result: DiscoveryScanResult = JSON.parse(text);

        if (typeof result.score !== 'number' || !result.maturityLevel) {
          throw new Error('Discovery scan result missing required fields');
        }

        return result;
      } catch (error) {
        this.logger.warn(
          `Discovery scan attempt ${attempt + 1} failed: ${(error as Error).message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to analyze discovery scan after retries');
  }

  getModel(): string {
    return this.model;
  }
}

export interface TransformationReportData {
  overallScore: number;
  maturityLevel: string;
  fteRedeployable: number;
  executiveSummary: {
    summary: string;
    keyFindings: string[];
  };
  departmentScores: {
    department: string;
    score: number;
    maturityLevel: string;
    currentState: string;
    potentialState: string;
    efficiencyValue: number;
    growthValue: number;
    workflows: {
      name: string;
      currentProcess: string;
      aiOpportunity: string;
      automationPotential: number;
      weeklyHoursSaved: number;
      annualValueSaved: number;
      effort: string;
      timeframe: string;
    }[];
  }[];
  recommendations: {
    id: string;
    title: string;
    description: string;
    department: string;
    impact: string;
    effort: string;
    annualValue: number;
    timeToImplement: string;
    prerequisites: string[];
    category: string;
  }[];
  implementationPlan: {
    phase: number;
    name: string;
    timeframe: string;
    focus: string;
    totalValue: number;
    actions: {
      title: string;
      department: string;
      value: number;
      effort: string;
      status: string;
    }[];
  }[];
}

export interface OnboardingInsights {
  summary: string;
  readinessScore: number;
  topOpportunities: {
    title: string;
    description: string;
    impact: 'HIGH' | 'MEDIUM' | 'LOW';
    timeframe: 'SHORT' | 'MEDIUM' | 'LONG';
  }[];
  quickWins: string[];
  risks: string[];
  recommendedNextSteps: string[];
}
