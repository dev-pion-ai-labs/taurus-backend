import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { buildQuestionGenerationPrompt } from './prompts/question-generation.prompt';
import {
  buildBriefingPrompt,
  type ReportGenerationContext,
} from './prompts/report-generation.prompt';
import { buildFramingPrompt } from './prompts/framing.prompt';
import {
  COMPANY_TYPES,
  MATURITY_STAGES,
  PRIMARY_AUDIENCES,
  REPORT_GOALS,
  type BriefingOutput,
  type DecisionBlock,
  type ReportFraming,
  type TransformationReportBriefing,
} from './types/report-briefing.types';
import { validateAndNormalizeBriefing } from './value-validator';
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
import {
  buildSprintSuggestionPrompt,
  type SprintSuggestionContext,
  type SprintSuggestion,
} from './prompts/sprint-suggestion.prompt';
import {
  buildNextActionPrompt,
  type NextActionSuggestionContext,
  type NextActionSuggestion,
} from './prompts/next-action-suggestion.prompt';
import {
  buildToolOverlapPrompt,
  type ToolOverlapContext,
  type ToolOverlapResult,
} from './prompts/tool-overlap.prompt';

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

  /**
   * Pass 1 — run the framing call. Cheap, small, sets the lens (audience,
   * company type, report goal, thesis, big move, value band) used by Pass 2.
   */
  async generateFraming(
    context: ReportGenerationContext,
  ): Promise<ReportFraming> {
    const { system, user } = buildFramingPrompt(context);

    this.logger.log(
      `Framing generation starting — model: ${this.model}, max_tokens: 2048`,
    );

    for (let attempt = 0; attempt < 3; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(1);
        this.logger.log(
          `Framing attempt ${attempt + 1}/3 — ${elapsed}s, ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
        );

        const text =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const cleaned = text
          .replace(/```json?\s*\n?/gi, '')
          .replace(/```\s*/gi, '')
          .trim();

        const framing: ReportFraming = JSON.parse(cleaned);
        assertValidFraming(framing);
        return framing;
      } catch (error) {
        this.logger.warn(
          `Framing attempt ${attempt + 1}/3 failed: ${(error as Error).message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to generate framing after retries');
  }

  /**
   * Full transformation-report generation. Runs Pass 1 (framing) then Pass 2
   * (briefing), normalizes value ranges and FTE bands deterministically, and
   * projects the result into the legacy `TransformationReportData` shape so
   * the existing dashboard continues to render during the frontend migration.
   */
  async generateTransformationReport(
    context: ReportGenerationContext,
  ): Promise<TransformationReportData> {
    const framingStart = Date.now();
    const framing = await this.generateFraming(context);
    this.logger.log(
      `Framing: companyType=${framing.companyType} audience=${framing.primaryAudience} goal=${framing.reportGoal} valueRange=$${framing.valueLow}-${framing.valueHigh} (${((Date.now() - framingStart) / 1000).toFixed(1)}s)`,
    );

    const briefingStart = Date.now();
    const briefingOutput = await this.generateBriefing(context, framing);
    this.logger.log(
      `Briefing: ${briefingOutput.decisionBlocks.length} decision blocks, ${briefingOutput.departmentSignal.length} dept signals (${((Date.now() - briefingStart) / 1000).toFixed(1)}s)`,
    );

    const combined: TransformationReportBriefing = {
      companyType: framing.companyType,
      primaryAudience: framing.primaryAudience,
      reportGoal: framing.reportGoal,
      ...briefingOutput,
    };

    const normalized = validateAndNormalizeBriefing(combined, context);

    return projectBriefingToLegacyShape(normalized, framing, context);
  }

  private async generateBriefing(
    context: ReportGenerationContext,
    framing: ReportFraming,
  ): Promise<BriefingOutput> {
    const { system, user } = buildBriefingPrompt(context, framing);

    for (let attempt = 0; attempt < 3; attempt++) {
      const attemptStart = Date.now();
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 16384,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const elapsed = ((Date.now() - attemptStart) / 1000).toFixed(1);
        this.logger.log(
          `Briefing attempt ${attempt + 1}/3 — ${elapsed}s, stop_reason=${response.stop_reason}, ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
        );

        if (response.stop_reason === 'max_tokens') {
          throw new Error(
            `Briefing truncated at ${response.usage.output_tokens} output tokens — increase max_tokens`,
          );
        }

        const text =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const cleaned = text
          .replace(/```json?\s*\n?/gi, '')
          .replace(/```\s*/gi, '')
          .trim();

        const briefing: BriefingOutput = JSON.parse(cleaned);
        assertValidBriefing(briefing, framing.decisionsRequired.length);
        return briefing;
      } catch (error) {
        this.logger.warn(
          `Briefing attempt ${attempt + 1}/3 failed: ${(error as Error).message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to generate briefing after retries');
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

  async suggestNextAction(
    ctx: NextActionSuggestionContext,
  ): Promise<NextActionSuggestion> {
    const { system, user } = buildNextActionPrompt(ctx);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const raw =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const text = raw
          .replace(/```json?\s*\n?/gi, '')
          .replace(/```\s*/gi, '')
          .trim();
        const suggestion: NextActionSuggestion = JSON.parse(text);

        if (!suggestion.actionId || !suggestion.reason) {
          throw new Error('Next-action suggestion missing required fields');
        }

        const known = new Set(ctx.candidates.map((c) => c.id));
        if (!known.has(suggestion.actionId)) {
          throw new Error(
            `AI returned unknown actionId ${suggestion.actionId}`,
          );
        }

        return suggestion;
      } catch (error) {
        this.logger.warn(
          `Next-action suggestion attempt ${attempt + 1} failed: ${(error as Error).message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to generate next-action suggestion after retries');
  }

  async suggestSprint(
    ctx: SprintSuggestionContext,
  ): Promise<SprintSuggestion> {
    const { system, user } = buildSprintSuggestionPrompt(ctx);

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
        const suggestion: SprintSuggestion = JSON.parse(text);

        if (
          !suggestion.name ||
          !Array.isArray(suggestion.suggestedActions) ||
          suggestion.suggestedActions.length === 0
        ) {
          throw new Error('Sprint suggestion missing required fields');
        }

        return suggestion;
      } catch (error) {
        this.logger.warn(
          `Sprint suggestion attempt ${attempt + 1} failed: ${(error as Error).message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to generate sprint suggestion after retries');
  }

  async detectOverlaps(
    ctx: ToolOverlapContext,
  ): Promise<ToolOverlapResult> {
    const { system, user } = buildToolOverlapPrompt(ctx);

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
        const result: ToolOverlapResult = JSON.parse(text);

        if (!Array.isArray(result.overlaps) || !result.summary) {
          throw new Error('Overlap detection result missing required fields');
        }

        return result;
      } catch (error) {
        this.logger.warn(
          `Overlap detection attempt ${attempt + 1} failed: ${(error as Error).message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Failed to detect overlaps after retries');
  }

  getModel(): string {
    return this.model;
  }
}

export interface TransformationReportData {
  // Legacy shape (populated via projection from the new briefing for backward compat)
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

  // New briefing shape — primary output
  briefing: TransformationReportBriefing;
}

// ─── Briefing helpers (shape validation + legacy projection) ─────────────

function assertValidFraming(
  framing: unknown,
): asserts framing is ReportFraming {
  const f = framing as Partial<ReportFraming>;
  if (!f || typeof f !== 'object') {
    throw new Error('Framing JSON is not an object');
  }
  if (!COMPANY_TYPES.includes(f.companyType as never)) {
    throw new Error(`Framing.companyType invalid: ${f.companyType}`);
  }
  if (!PRIMARY_AUDIENCES.includes(f.primaryAudience as never)) {
    throw new Error(`Framing.primaryAudience invalid: ${f.primaryAudience}`);
  }
  if (!REPORT_GOALS.includes(f.reportGoal as never)) {
    throw new Error(`Framing.reportGoal invalid: ${f.reportGoal}`);
  }
  if (!MATURITY_STAGES.includes(f.portfolioMaturityStage as never)) {
    throw new Error(
      `Framing.portfolioMaturityStage invalid: ${f.portfolioMaturityStage}`,
    );
  }
  if (!MATURITY_STAGES.includes(f.deliveryMaturityStage as never)) {
    throw new Error(
      `Framing.deliveryMaturityStage invalid: ${f.deliveryMaturityStage}`,
    );
  }
  if (
    typeof f.thesis !== 'string' ||
    typeof f.bigMove !== 'string' ||
    typeof f.valueLow !== 'number' ||
    typeof f.valueHigh !== 'number' ||
    !Array.isArray(f.decisionsRequired) ||
    f.decisionsRequired.length < 2 ||
    f.decisionsRequired.length > 3 ||
    !Array.isArray(f.keyAssumptions)
  ) {
    throw new Error('Framing JSON missing required fields');
  }
}

function assertValidBriefing(
  briefing: unknown,
  expectedBlockCount: number,
): asserts briefing is BriefingOutput {
  const b = briefing as Partial<BriefingOutput>;
  if (!b || typeof b !== 'object') {
    throw new Error('Briefing JSON is not an object');
  }
  if (!b.snapshot || typeof b.snapshot !== 'object') {
    throw new Error('Briefing missing snapshot');
  }
  if (
    !b.snapshot.headline ||
    !b.snapshot.bottomLine ||
    !Array.isArray(b.snapshot.keyStats) ||
    b.snapshot.keyStats.length < 2
  ) {
    throw new Error(
      'Briefing.snapshot missing required fields (headline, bottomLine, >=2 keyStats)',
    );
  }
  if (!b.executiveBrief || typeof b.executiveBrief !== 'object') {
    throw new Error('Briefing missing executiveBrief');
  }
  if (!Array.isArray(b.decisionBlocks)) {
    throw new Error('Briefing missing decisionBlocks array');
  }
  if (b.decisionBlocks.length !== expectedBlockCount) {
    throw new Error(
      `Briefing has ${b.decisionBlocks.length} decision blocks, expected ${expectedBlockCount}`,
    );
  }
  for (const [i, block] of b.decisionBlocks.entries()) {
    if (!block || typeof block !== 'object') {
      throw new Error(`Decision block ${i} is not an object`);
    }
    const db = block as Partial<DecisionBlock>;
    if (
      !db.decision ||
      !db.whyNow ||
      !db.value ||
      !db.ownership ||
      !db.executionReality ||
      !db.ninetyDayPlan ||
      !db.proofPoint ||
      !db.dependencies ||
      !db.risksAndTradeoffs
    ) {
      throw new Error(`Decision block ${i} missing required subsections`);
    }
    if (db.executionReality.length !== 3) {
      throw new Error(
        `Decision block ${i} must have exactly 3 executionReality blockers (got ${db.executionReality.length})`,
      );
    }
  }
  if (!b.assumptionsAndLimitations || typeof b.assumptionsAndLimitations !== 'object') {
    throw new Error('Briefing missing assumptionsAndLimitations');
  }
  if (!b.peerContext || typeof b.peerContext !== 'object') {
    throw new Error('Briefing missing peerContext');
  }
  if (!Array.isArray(b.departmentSignal)) {
    throw new Error('Briefing missing departmentSignal array');
  }
}

const MATURITY_STAGE_TO_SCORE: Record<string, number> = {
  Early: 35,
  Working: 55,
  Scaling: 72,
  Native: 88,
};

const FTE_BAND_MIDPOINT: Record<string, number> = {
  '<5': 3,
  '5-10': 7,
  '10-20': 15,
  '20-50': 35,
  '50-100': 75,
  '100+': 150,
};

/**
 * Project the new briefing shape down onto the legacy TransformationReportData
 * fields. This keeps the existing dashboard/renderer/tracker working while the
 * frontend is migrated. Values are intentionally coarse — the new fields are
 * the source of truth; the legacy fields are a downgraded view.
 */
function projectBriefingToLegacyShape(
  briefing: TransformationReportBriefing,
  framing: ReportFraming,
  context: ReportGenerationContext,
): TransformationReportData {
  const portfolioScore =
    MATURITY_STAGE_TO_SCORE[briefing.executiveBrief.portfolioMaturity.stage] ??
    50;
  const deliveryScore =
    MATURITY_STAGE_TO_SCORE[briefing.executiveBrief.deliveryMaturity.stage] ??
    50;
  const overallScore = Math.round((portfolioScore + deliveryScore) / 2);
  const maturityLevel = briefing.executiveBrief.portfolioMaturity.stage;

  const totalValueMid =
    (briefing.executiveBrief.valueSummary.low +
      briefing.executiveBrief.valueSummary.high) /
    2;
  // 60/40 efficiency-vs-growth default split; growth-heavy goals tilt toward growth.
  const growthShare = framing.reportGoal === 'Explore' ? 0.5 : 0.4;
  const totalGrowthValue = Math.round(totalValueMid * growthShare);
  const totalEfficiencyValue = Math.round(totalValueMid - totalGrowthValue);

  const fteMidpoint =
    FTE_BAND_MIDPOINT[briefing.executiveBrief.fteBand] ?? 0;

  const executiveSummary = {
    summary: renderSnapshotAsText(briefing),
    keyFindings: [
      ...briefing.decisionBlocks.map((b) => b.whyNow.urgency).filter(Boolean),
      ...briefing.assumptionsAndLimitations.uncertaintyNotes.slice(0, 2),
    ].slice(0, 7),
  };

  const departmentScores = buildLegacyDepartmentScores(
    briefing,
    framing,
    context,
  );

  const recommendations = briefing.decisionBlocks.flatMap((block) =>
    block.ninetyDayPlan.actions.map((action, idx) => ({
      id: `${block.id}-${idx}`,
      title: action.title,
      description: `${block.decision} — ${action.successSignal}`,
      department: action.ownerRole,
      impact: impactFromValue(block.value.high),
      effort: effortFromWeek(action.week),
      annualValue: Math.round(block.value.high / block.ninetyDayPlan.actions.length),
      timeToImplement: action.week,
      prerequisites: block.dependencies.slice(0, 3),
      category: categoryFromGoal(framing.reportGoal),
    })),
  );

  const implementationPlan = buildLegacyImplementationPlan(briefing);

  return {
    overallScore,
    maturityLevel,
    fteRedeployable: fteMidpoint,
    executiveSummary,
    departmentScores,
    recommendations,
    implementationPlan,
    briefing,
  };
}

function buildLegacyDepartmentScores(
  briefing: TransformationReportBriefing,
  framing: ReportFraming,
  context: ReportGenerationContext,
): TransformationReportData['departmentScores'] {
  const portfolioScore =
    MATURITY_STAGE_TO_SCORE[briefing.executiveBrief.portfolioMaturity.stage] ??
    50;
  const perBlockValueMid = briefing.decisionBlocks.length
    ? (briefing.executiveBrief.valueSummary.low +
        briefing.executiveBrief.valueSummary.high) /
      2 /
      briefing.decisionBlocks.length
    : 0;

  const signalByDept = new Map<string, string>();
  for (const s of briefing.departmentSignal) {
    signalByDept.set(s.department, s.observation);
  }

  const departments = context.departments.length
    ? context.departments
    : briefing.departmentSignal.map((s) => ({
        name: s.department,
        headcount: null,
        avgSalary: null,
        workflows: [],
      }));

  return departments.map((d) => ({
    department: d.name,
    score: portfolioScore,
    maturityLevel: briefing.executiveBrief.portfolioMaturity.stage,
    currentState: signalByDept.get(d.name) || 'See decision blocks for detail.',
    potentialState: briefing.executiveBrief.bigMove,
    efficiencyValue: Math.round(perBlockValueMid * 0.6),
    growthValue: Math.round(
      perBlockValueMid * (framing.reportGoal === 'Explore' ? 0.5 : 0.4),
    ),
    workflows: d.workflows.map((w) => ({
      name: w.name,
      currentProcess: w.description || '(not described)',
      aiOpportunity: 'See decision blocks for prioritized opportunity.',
      automationPotential: 50,
      weeklyHoursSaved: 0,
      annualValueSaved: 0,
      effort: 'MEDIUM',
      timeframe: 'MONTHS',
    })),
  }));
}

function buildLegacyImplementationPlan(
  briefing: TransformationReportBriefing,
): TransformationReportData['implementationPlan'] {
  const valueMid =
    (briefing.executiveBrief.valueSummary.low +
      briefing.executiveBrief.valueSummary.high) /
    2;
  const firstPhaseValue = Math.round(valueMid * 0.3);
  const secondPhaseValue = Math.round(valueMid * 0.4);
  const thirdPhaseValue = Math.round(valueMid * 0.3);

  const firstActions = briefing.decisionBlocks.flatMap((b) =>
    b.ninetyDayPlan.actions.slice(0, 2).map((a) => ({
      title: a.title,
      department: a.ownerRole,
      value: Math.round(firstPhaseValue / (briefing.decisionBlocks.length * 2 || 1)),
      effort: 'MEDIUM',
      status: 'NOT_STARTED',
    })),
  );

  const foundationActions = briefing.decisionBlocks.map((b) => ({
    title: `Validate ${b.proofPoint.metric} against ${b.proofPoint.threshold}`,
    department: b.ownership.accountableRole,
    value: Math.round(secondPhaseValue / (briefing.decisionBlocks.length || 1)),
    effort: 'MEDIUM',
    status: 'NOT_STARTED',
  }));

  const scaleActions = briefing.decisionBlocks.map((b) => ({
    title: `Roll out ${b.decision}`,
    department: b.ownership.accountableRole,
    value: Math.round(thirdPhaseValue / (briefing.decisionBlocks.length || 1)),
    effort: 'HIGH',
    status: 'NOT_STARTED',
  }));

  return [
    {
      phase: 1,
      name: 'Quick Wins',
      timeframe: 'Weeks 1-8',
      focus: 'Prove the 90-day plan inside one owner group before broadening.',
      totalValue: firstPhaseValue,
      actions: firstActions,
    },
    {
      phase: 2,
      name: 'Foundation',
      timeframe: 'Months 3-6',
      focus: 'Validate proof points and close governance gaps.',
      totalValue: secondPhaseValue,
      actions: foundationActions,
    },
    {
      phase: 3,
      name: 'Scale',
      timeframe: 'Months 6-12',
      focus: 'Roll the validated decisions across the organization.',
      totalValue: thirdPhaseValue,
      actions: scaleActions,
    },
  ];
}

function impactFromValue(high: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (high >= 5_000_000) return 'HIGH';
  if (high >= 1_000_000) return 'MEDIUM';
  return 'LOW';
}

function effortFromWeek(weekStr: string): 'LOW' | 'MEDIUM' | 'HIGH' {
  const lowered = (weekStr || '').toLowerCase();
  if (lowered.includes('1-2') || lowered.includes('week 1')) return 'LOW';
  if (lowered.includes('month') || lowered.includes('quarter')) return 'HIGH';
  return 'MEDIUM';
}

/**
 * Render the briefing's snapshot as a compact plain-text block that today's
 * dashboard can display in its existing `executiveSummary.summary` slot.
 * The real structured snapshot still lives on `briefing.snapshot` — this is
 * just a backward-compatible rendering for the unrevised frontend.
 */
export function renderSnapshotAsText(
  briefing: TransformationReportBriefing,
): string {
  const s = briefing.snapshot;
  const statsLines = s.keyStats
    .map((stat) => `  • ${stat.label}: ${stat.value}`)
    .join('\n');
  const watchLines = s.watchouts
    .map((w) => `  • ${w}`)
    .join('\n');

  const confidenceLabel =
    s.confidenceNote === 'data-grounded'
      ? 'Data-grounded'
      : s.confidenceNote === 'directional'
        ? 'Directional'
        : 'Order-of-magnitude';

  return [
    s.headline,
    '',
    s.bottomLine,
    '',
    'AT A GLANCE',
    statsLines,
    '',
    'WATCHOUTS',
    watchLines,
    '',
    `${confidenceLabel} · ${s.readingTime}`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

function categoryFromGoal(goal: ReportFraming['reportGoal']): string {
  switch (goal) {
    case 'Decide':
    case 'Align':
      return 'EFFICIENCY';
    case 'Explore':
      return 'GROWTH';
    case 'Validate':
      return 'INTELLIGENCE';
    default:
      return 'EFFICIENCY';
  }
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
