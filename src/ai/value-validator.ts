import type {
  ConfidenceNote,
  DecisionBlock,
  TransformationReportBriefing,
  ValueRange,
} from './types/report-briefing.types';
import type { ReportGenerationContext } from './prompts/report-generation.prompt';

const INDUSTRY_DEFAULT_SALARY: Record<string, number> = {
  Tech: 95000,
  Technology: 95000,
  'Technology & SaaS': 110000,
  Finance: 105000,
  'Financial Services': 120000,
  Healthcare: 85000,
  Retail: 55000,
  'Professional Services': 140000,
  Consulting: 150000,
  default: 75000,
};

const FTE_BANDS = ['<5', '5-10', '10-20', '20-50', '50-100', '100+'] as const;

/**
 * Estimate annual payroll from provided department data, falling back to
 * industry defaults × headcount. Used to ceiling the value ranges the LLM
 * produced so we never emit a $60M value for a $10M-payroll company.
 */
export function estimateAnnualPayroll(ctx: ReportGenerationContext): number {
  let total = 0;
  let covered = 0;

  for (const dept of ctx.departments) {
    if (dept.headcount && dept.avgSalary) {
      total += dept.headcount * dept.avgSalary;
      covered += dept.headcount;
    }
  }

  // Top up with industry default for uncovered headcount
  const totalHeadcount = parseCompanySize(ctx.organization.size);
  if (totalHeadcount && covered < totalHeadcount) {
    const uncovered = totalHeadcount - covered;
    const defaultSalary =
      INDUSTRY_DEFAULT_SALARY[ctx.organization.industry] ??
      INDUSTRY_DEFAULT_SALARY.default;
    total += uncovered * defaultSalary;
  }

  // If we have nothing at all, bail with a very rough estimate
  if (total === 0 && totalHeadcount) {
    const defaultSalary =
      INDUSTRY_DEFAULT_SALARY[ctx.organization.industry] ??
      INDUSTRY_DEFAULT_SALARY.default;
    total = totalHeadcount * defaultSalary;
  }

  return total;
}

/**
 * "1000+" → 1500 midpoint, "100-500" → 300 midpoint, etc.
 * Returns null if we truly can't parse a count.
 */
export function parseCompanySize(size: string | null): number | null {
  if (!size) return null;
  const s = size.trim();
  if (s.endsWith('+')) return parseInt(s.replace(/[^0-9]/g, ''), 10) * 1.5 || null;
  const match = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (match) {
    const low = parseInt(match[1], 10);
    const high = parseInt(match[2], 10);
    return Math.floor((low + high) / 2);
  }
  const single = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(single) && single > 0 ? single : null;
}

/**
 * Round a dollar value to sensible granularity:
 *   < $1M      → round to $50K
 *   < $25M     → round to $1M
 *   >= $25M    → round to $5M
 */
export function bandDollar(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1_000_000) return Math.round(value / 50_000) * 50_000;
  if (value < 25_000_000) return Math.round(value / 1_000_000) * 1_000_000;
  return Math.round(value / 5_000_000) * 5_000_000;
}

/**
 * Map a numeric FTE count to one of the standard bands. Rejects decimals,
 * guarantees the output is one of the allowed strings.
 */
export function bandFte(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '<5';
  const n = Math.round(count);
  if (n < 5) return '<5';
  if (n <= 10) return '5-10';
  if (n <= 20) return '10-20';
  if (n <= 50) return '20-50';
  if (n <= 100) return '50-100';
  return '100+';
}

export function isValidFteBand(band: string | null | undefined): boolean {
  return !!band && (FTE_BANDS as readonly string[]).includes(band);
}

/**
 * Clamp a ValueRange's low/high to a max % of estimated payroll. For
 * efficiency-heavy briefings this should be ~15%; for growth-heavy, ~25%.
 * Also bands to sane granularity and enforces low <= high.
 */
export function clampValueRange(
  range: ValueRange,
  payroll: number,
  maxPercent = 0.15,
): ValueRange {
  const ceiling = payroll > 0 ? payroll * maxPercent : Number.POSITIVE_INFINITY;

  let low = Math.min(range.low, ceiling);
  let high = Math.min(range.high, ceiling);
  if (low > high) [low, high] = [high, low];

  return {
    ...range,
    low: bandDollar(low),
    high: bandDollar(high),
  };
}

/**
 * Derive a coarse confidence tag based on how much grounding data the
 * generator had to work with. We bias toward lower confidence — overstated
 * confidence is the bigger failure mode for this report type.
 */
export function inferConfidence(
  ctx: ReportGenerationContext,
): ConfidenceNote {
  const hasDepts = ctx.departments.length >= 2;
  const hasWorkflows = ctx.departments.some((d) => d.workflows.length > 0);
  const hasSalary = ctx.departments.some((d) => d.avgSalary && d.headcount);
  const hasAnswers = ctx.consultationAnswers.length >= 5;
  const hasScrape = !!ctx.scrapedInsights?.description;

  const score =
    (hasDepts ? 1 : 0) +
    (hasWorkflows ? 1 : 0) +
    (hasSalary ? 1 : 0) +
    (hasAnswers ? 1 : 0) +
    (hasScrape ? 1 : 0);

  if (score >= 4) return 'directional';
  if (score >= 2) return 'order-of-magnitude';
  return 'order-of-magnitude';
}

/**
 * Apply all deterministic sanity rules to a freshly-generated briefing:
 *   - Clamp every ValueRange.high to max 15% of payroll (25% for growth-heavy)
 *   - Band every dollar amount
 *   - Force fteBand to a legal value
 *   - Downgrade confidenceNote to the weakest across blocks
 *   - Strip decimal FTEs if the model snuck them in anywhere
 */
export function validateAndNormalizeBriefing(
  briefing: TransformationReportBriefing,
  ctx: ReportGenerationContext,
): TransformationReportBriefing {
  const payroll = estimateAnnualPayroll(ctx);
  const confidenceFallback = inferConfidence(ctx);

  const normalizedBlocks: DecisionBlock[] = briefing.decisionBlocks.map(
    (block) => ({
      ...block,
      value: clampValueRange(
        {
          ...block.value,
          confidenceNote:
            block.value.confidenceNote ?? confidenceFallback,
        },
        payroll,
      ),
    }),
  );

  // Aggregate the summary value to be consistent with the (clamped) blocks.
  const aggregateLow = normalizedBlocks.reduce(
    (s, b) => s + b.value.low,
    0,
  );
  const aggregateHigh = normalizedBlocks.reduce(
    (s, b) => s + b.value.high,
    0,
  );

  const briefingLow = bandDollar(aggregateLow);
  const briefingHigh = bandDollar(aggregateHigh);

  // Confidence: weakest of the blocks wins.
  const worstConfidence: ConfidenceNote = weakestConfidence(
    normalizedBlocks.map((b) => b.value.confidenceNote),
  );

  const normalizedBrief = {
    ...briefing.executiveBrief,
    valueSummary: {
      ...briefing.executiveBrief.valueSummary,
      low: briefingLow,
      high: briefingHigh,
      confidenceNote: worstConfidence,
    },
    fteBand: isValidFteBand(briefing.executiveBrief.fteBand)
      ? briefing.executiveBrief.fteBand
      : '<5',
  };

  return {
    ...briefing,
    executiveBrief: normalizedBrief,
    decisionBlocks: normalizedBlocks,
  };
}

function weakestConfidence(notes: ConfidenceNote[]): ConfidenceNote {
  if (notes.some((n) => n === 'order-of-magnitude')) return 'order-of-magnitude';
  if (notes.some((n) => n === 'directional')) return 'directional';
  return 'data-grounded';
}
