import {
  bandDollar,
  clampValueRange,
  estimateAnnualPayroll,
  inferConfidence,
  parseCompanySize,
  validateAndNormalizeBriefing,
} from './value-validator';
import { renderSnapshotAsText } from './ai.service';
import type { ReportGenerationContext } from './prompts/report-generation.prompt';
import type {
  DecisionBlock,
  TransformationReportBriefing,
} from './types/report-briefing.types';

const makeCtx = (
  overrides: Partial<ReportGenerationContext> = {},
): ReportGenerationContext => ({
  organization: { name: 'Acme', industry: 'Technology', size: '201-500' },
  onboarding: {
    businessDescription: '',
    revenueStreams: '',
    challenges: [],
    customChallenges: '',
    tools: [],
    customTools: '',
    goals: [],
    customGoals: '',
    dataSources: [],
    customDataSources: '',
  },
  departments: [],
  consultationAnswers: [],
  ...overrides,
});

describe('value-validator — primitive helpers', () => {
  describe('bandDollar', () => {
    it('rounds sub-$1M to nearest $50K', () => {
      expect(bandDollar(275_000)).toBe(300_000);
      expect(bandDollar(524_999)).toBe(500_000);
    });

    it('rounds mid values to nearest $1M', () => {
      expect(bandDollar(14_400_000)).toBe(14_000_000);
      expect(bandDollar(14_600_000)).toBe(15_000_000);
    });

    it('rounds large values to nearest $5M', () => {
      expect(bandDollar(66_600_000)).toBe(65_000_000);
      expect(bandDollar(67_600_000)).toBe(70_000_000);
    });

    it('returns 0 for invalid inputs', () => {
      expect(bandDollar(-1)).toBe(0);
      expect(bandDollar(NaN)).toBe(0);
    });
  });

  describe('parseCompanySize', () => {
    it('parses ranges to midpoints', () => {
      expect(parseCompanySize('51-200')).toBe(125);
      expect(parseCompanySize('201-500')).toBe(350);
    });

    it('returns null for unparseable input', () => {
      expect(parseCompanySize(null)).toBeNull();
      expect(parseCompanySize('unknown')).toBeNull();
    });
  });
});

describe('value-validator — payroll estimation', () => {
  it('sums explicit department headcount × salary when available (no top-up if size unknown)', () => {
    const ctx = makeCtx({
      organization: { name: 'Acme', industry: 'Technology', size: null },
      departments: [
        { name: 'Eng', headcount: 50, avgSalary: 120_000, workflows: [] },
        { name: 'Sales', headcount: 20, avgSalary: 90_000, workflows: [] },
      ],
    });
    expect(estimateAnnualPayroll(ctx)).toBe(50 * 120_000 + 20 * 90_000);
  });

  it('tops up uncovered headcount using industry default', () => {
    const ctx = makeCtx({
      organization: { name: 'Acme', industry: 'Technology', size: '201-500' },
      departments: [
        { name: 'Eng', headcount: 50, avgSalary: 120_000, workflows: [] },
      ],
    });
    const explicit = 50 * 120_000;
    const uncovered = 350 - 50; // midpoint of 201-500 is 350
    const total = explicit + uncovered * 95_000; // Technology default
    expect(estimateAnnualPayroll(ctx)).toBe(total);
  });

  it('returns 0 when no headcount and no departments', () => {
    const ctx = makeCtx({
      organization: { name: 'Acme', industry: 'Technology', size: null },
    });
    expect(estimateAnnualPayroll(ctx)).toBe(0);
  });
});

describe('value-validator — clampValueRange', () => {
  it('clamps high above ceiling to ceiling', () => {
    const out = clampValueRange(
      {
        low: 60_000_000,
        high: 200_000_000,
        logic: 'x',
        assumptions: [],
        confidenceNote: 'directional',
      },
      100_000_000, // payroll
      0.15, // 15% ceiling = $15M
    );
    expect(out.high).toBeLessThanOrEqual(15_000_000);
    expect(out.low).toBeLessThanOrEqual(out.high);
  });

  it('leaves modest values alone (rounded to band)', () => {
    const out = clampValueRange(
      {
        low: 2_000_000,
        high: 4_000_000,
        logic: 'x',
        assumptions: [],
        confidenceNote: 'directional',
      },
      100_000_000,
    );
    expect(out.low).toBe(2_000_000);
    expect(out.high).toBe(4_000_000);
  });
});

describe('value-validator — inferConfidence', () => {
  it('is order-of-magnitude when inputs are thin', () => {
    expect(inferConfidence(makeCtx())).toBe('order-of-magnitude');
  });

  it('is directional when inputs are rich', () => {
    const rich = makeCtx({
      departments: [
        {
          name: 'Eng',
          headcount: 50,
          avgSalary: 100_000,
          workflows: [
            {
              name: 'wf',
              description: 'd',
              weeklyHours: 40,
              peopleInvolved: 5,
              automationLevel: 'NONE',
              painPoints: null,
              priority: 'HIGH',
            },
          ],
        },
      ],
      consultationAnswers: new Array(10).fill({
        section: 's',
        question: 'q',
        questionType: 'TEXT',
        answer: 'a',
      }),
      scrapedInsights: {
        title: 't',
        description: 'd',
        products: [],
        services: [],
        technologies: [],
        aiDetected: false,
        aiMentions: [],
        automationDetected: false,
        automationMentions: [],
        companyInfo: {},
        businessModel: null,
      },
    });
    expect(inferConfidence(rich)).toBe('directional');
  });
});

// ─── Full briefing normalization ─────────────────────────────────────

const makeBlock = (
  id: string,
  low: number,
  high: number,
  confidence: 'data-grounded' | 'directional' | 'order-of-magnitude' = 'directional',
): DecisionBlock => ({
  id,
  decision: `Decision ${id}`,
  whyNow: { urgency: 'u', costOfInaction: 'c' },
  value: { low, high, logic: 'l', assumptions: ['a'], confidenceNote: confidence },
  ownership: { accountableRole: 'CTO', supportingRoles: [] },
  executionReality: [
    { blocker: 'b1', category: 'organizational', mitigation: 'm' },
    { blocker: 'b2', category: 'technical', mitigation: 'm' },
    { blocker: 'b3', category: 'behavioral', mitigation: 'm' },
  ],
  ninetyDayPlan: {
    objective: 'o',
    actions: [
      { title: 't', ownerRole: 'r', week: 'Weeks 1-2', successSignal: 's' },
    ],
  },
  proofPoint: { metric: 'm', threshold: 't', reviewBy: 'r' },
  dependencies: [],
  risksAndTradeoffs: [],
});

const makeBriefing = (
  blocks: DecisionBlock[],
): TransformationReportBriefing => ({
  companyType: 'Enterprise',
  primaryAudience: 'CLevel',
  reportGoal: 'Decide',
  snapshot: {
    headline: 'Test headline.',
    bottomLine: 'Test bottom line.',
    keyStats: [
      { label: 'Value at stake', value: '$10M-$15M' },
      { label: 'Decisions required', value: '2' },
    ],
    watchouts: ['governance review'],
    readingTime: '5 min read',
    confidenceNote: 'directional',
  },
  executiveBrief: {
    thesis: 't',
    bigMove: 'b',
    decisionsRequired: blocks.map((b) => b.decision),
    valueSummary: {
      low: 0,
      high: 0,
      logic: 'sum of blocks',
      assumptions: [],
      confidenceNote: 'directional',
    },
    portfolioMaturity: { stage: 'Working', evidence: 'e', gaps: 'g' },
    deliveryMaturity: { stage: 'Early', evidence: 'e', gaps: 'g' },
  },
  decisionBlocks: blocks,
  departmentSignal: [],
  assumptionsAndLimitations: {
    scopeOfInputData: 'test',
    uncertaintyNotes: [],
    validationRequired: [],
  },
  peerContext: { note: '', confidence: 'none', sources: [] },
});

describe('validateAndNormalizeBriefing', () => {
  // 1000 explicit headcount @ $120k = $120M payroll; size=null prevents top-up
  // so ceiling at 15% is exactly $18M.
  const bigCtx = makeCtx({
    organization: { name: 'Acme', industry: 'Technology', size: null },
    departments: [
      { name: 'Eng', headcount: 1000, avgSalary: 120_000, workflows: [] },
    ],
  });

  it('clamps block values to realistic ceiling', () => {
    const blocks = [
      // The block wants $50M — $18M ceiling means it should be clamped to <=$18M.
      makeBlock('huge', 30_000_000, 50_000_000),
    ];
    const briefing = makeBriefing(blocks);
    const out = validateAndNormalizeBriefing(briefing, bigCtx);
    expect(out.decisionBlocks[0].value.high).toBeLessThanOrEqual(18_000_000);
  });

  it('aggregates executiveBrief.valueSummary from clamped blocks', () => {
    const briefing = makeBriefing([
      makeBlock('a', 2_000_000, 3_000_000),
      makeBlock('b', 1_000_000, 2_000_000),
    ]);
    const out = validateAndNormalizeBriefing(briefing, bigCtx);
    expect(out.executiveBrief.valueSummary.low).toBe(3_000_000);
    expect(out.executiveBrief.valueSummary.high).toBe(5_000_000);
  });

  it('takes the weakest block confidence for the summary', () => {
    const briefing = makeBriefing([
      makeBlock('a', 1_000_000, 2_000_000, 'data-grounded'),
      makeBlock('b', 1_000_000, 2_000_000, 'order-of-magnitude'),
    ]);
    const out = validateAndNormalizeBriefing(briefing, bigCtx);
    expect(out.executiveBrief.valueSummary.confidenceNote).toBe('order-of-magnitude');
  });

});

describe('renderSnapshotAsText', () => {
  it('renders headline, bottom line, stats, watchouts, and confidence tag', () => {
    const briefing = makeBriefing([makeBlock('a', 1_000_000, 2_000_000)]);
    briefing.snapshot = {
      headline: 'Delivery ops is the binding constraint.',
      bottomLine: 'Commit to a 180-day ops program.',
      keyStats: [
        { label: 'Value at stake', value: '$40M-$60M annually' },
        { label: 'Time to first proof point', value: '90 days' },
      ],
      watchouts: ['Partner council alignment', 'Global governance review cycle'],
      readingTime: '8 min read',
      confidenceNote: 'directional',
    };

    const text = renderSnapshotAsText(briefing);

    expect(text).toContain('Delivery ops is the binding constraint.');
    expect(text).toContain('Commit to a 180-day ops program.');
    expect(text).toContain('AT A GLANCE');
    expect(text).toContain('Value at stake: $40M-$60M annually');
    expect(text).toContain('WATCHOUTS');
    expect(text).toContain('Partner council alignment');
    expect(text).toContain('Directional · 8 min read');
  });
});
