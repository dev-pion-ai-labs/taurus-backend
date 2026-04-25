import type { ReportFraming } from '../types/report-briefing.types';

export interface ReportScopeContext {
  scope: 'ORG' | 'DEPARTMENT' | 'WORKFLOW';
  departmentName?: string;
  workflowName?: string;
}

export interface ReportGenerationContext {
  scopeContext?: ReportScopeContext;
  organization: {
    name: string;
    industry: string;
    size: string | null;
  };
  onboarding: {
    businessDescription: string;
    revenueStreams: string;
    challenges: string[];
    customChallenges: string;
    tools: string[];
    customTools: string;
    goals: string[];
    customGoals: string;
    dataSources: string[];
    customDataSources: string;
  };
  scrapedInsights?: {
    title: string | null;
    description: string | null;
    products: string[];
    services: string[];
    technologies: string[];
    aiDetected: boolean;
    aiMentions: string[];
    automationDetected: boolean;
    automationMentions: string[];
    companyInfo: Record<string, string | undefined>;
    businessModel: { type?: string; revenueStreams?: string[] } | null;
  };
  departments: {
    name: string;
    headcount: number | null;
    avgSalary: number | null;
    workflows: {
      name: string;
      description: string | null;
      weeklyHours: number | null;
      peopleInvolved: number | null;
      automationLevel: string;
      painPoints: string | null;
      priority: string;
    }[];
  }[];
  consultationAnswers: {
    section: string;
    question: string;
    questionType: string;
    answer: unknown;
  }[];
}

const VOCAB_BY_AUDIENCE: Record<string, string> = {
  CLevel:
    'C-level governance + P&L vocabulary. Reference board-level risk, capex vs opex tradeoffs, enterprise-wide governance, regulatory exposure. Avoid founder-speak ("velocity", "MVP", "runway").',
  Partner:
    'Partner-level practice-leadership vocabulary. Reference utilization, practice P&L, partner council alignment, cross-service-line ownership, billable leakage, pursuit win rates. Avoid product-speak.',
  Founder:
    'Founder-level pragmatic vocabulary. Reference runway, velocity, headcount pressure, sales-led vs product-led motion, founder bandwidth. Avoid enterprise-governance language unless the company is regulated.',
};

const BLOCKER_GUIDANCE_BY_COMPANY_TYPE: Record<string, string> = {
  Enterprise:
    'Blockers typically include: multi-BU P&L conflicts, global tech governance review cycles (weeks-to-months), regulatory/compliance sign-off, data-residency constraints, procurement lead times, union or works-council consultation.',
  ProfServices:
    'Blockers typically include: partner council alignment, cross-service-line P&L ownership disputes, client contractual clauses on engagement telemetry, billable-utilization impact, risk management review protocols, practice leadership incentive misalignment.',
  Startup:
    'Blockers typically include: founder bandwidth, hiring lead time, engineering capacity vs roadmap commitments, runway/burn, customer concentration making pilots risky, lack of formal data governance.',
  ProductTech:
    'Blockers typically include: roadmap tradeoffs with feature velocity, cross-team prioritization, data pipeline ownership disputes, SOC2/security review cycles, headcount allocation between customer-facing and platform teams.',
};

/**
 * Pass 2 — the Briefing Call.
 *
 * Given the framing output from Pass 1, produce the full briefing payload:
 * executive brief (with maturity ladders), 2-3 decision blocks with the mandatory
 * 10-subsection structure, department signal, assumptions & limitations, peer context.
 */
export function buildBriefingPrompt(
  ctx: ReportGenerationContext,
  framing: ReportFraming,
): { system: string; user: string } {
  const audienceGuidance =
    VOCAB_BY_AUDIENCE[framing.primaryAudience] ?? VOCAB_BY_AUDIENCE.CLevel;
  const blockerGuidance =
    BLOCKER_GUIDANCE_BY_COMPANY_TYPE[framing.companyType] ??
    BLOCKER_GUIDANCE_BY_COMPANY_TYPE.Enterprise;

  const scopeBanner = buildReportScopeBanner(ctx.scopeContext);

  const system = `You are a senior strategist producing an executive briefing (NOT a SaaS recommendation report). Your output will be read by a ${framing.primaryAudience} at a ${framing.companyType} organization. The report goal is to help them ${framing.reportGoal.toUpperCase()}.
${scopeBanner ? `\n${scopeBanner}\n` : ''}
Return ONLY valid JSON matching the exact schema specified. No markdown, no commentary. Start with { and end with }.

═══ TONE FOR THIS AUDIENCE ═══
${audienceGuidance}
FORBIDDEN vocabulary across ALL audiences: "ship", "jump in", "unlock", "leverage" (as a verb), "empower", "enable", "game-changer", "best-in-class", "cutting-edge", "synergies", "holistic".

═══ CORE PRINCIPLES ═══
1. NO FALSE PRECISION. Every dollar value is a RANGE {low, high, logic, assumptions[], confidenceNote}. Never a point estimate. Round heavily — $1M granularity below $25M, $5M above. Do NOT emit any headcount or capacity counts — those are not part of this report.
2. SHOW VALUE LOGIC. Every value range's "logic" field must show a simple sentence of the form "volume × improvement × margin/time" (or equivalent). Every value range's "assumptions" field must list the specific inputs used. No unexplained numbers.
3. NO MEANINGLESS SCORES. No numeric "maturity score". Use the two named 4-step ladders (Early / Working / Scaling / Native) with evidence + gaps per ladder.
4. INTERPRET, DON'T RESTATE. Never repeat back the company's own inputs as findings. Add prioritization, contradiction, or a non-obvious insight.
5. REALISTIC EXECUTION. Reflect actual constraints of a ${framing.companyType}: ${blockerGuidance}
6. HONEST ABOUT WHAT YOU DON'T KNOW. If data is missing, say so in assumptionsAndLimitations.uncertaintyNotes. Never invent.
7. CONFIDENCE TAGGING. Every ValueRange has confidenceNote ∈ {"data-grounded", "directional", "order-of-magnitude"} based on how much grounding data you had.
8. PEER CONTEXT HONESTY. If you don't have real peer data, peerContext.confidence = "none" and note that explicitly. Never name competitors without citing a source.

═══ DECISION BLOCKS ═══
Produce EXACTLY ${framing.decisionsRequired.length} decision blocks — one per item in the framing's decisionsRequired list, in the same order.

Each decision block MUST include ALL of the following subsections (no omissions — reject-able if missing):
  - decision          : State as a decision (commit/not-commit, build/buy, centralize/federate). Not a task. Not a suggestion.
  - whyNow            : {urgency: "why this is time-sensitive", costOfInaction: "what degrades if leadership does not decide"}
  - value             : ValueRange {low, high, logic, assumptions[], confidenceNote}
  - ownership         : {accountableRole: "single named role", supportingRoles: ["..."]}
  - executionReality  : EXACTLY 3 blockers, each {blocker, category ∈ {organizational, technical, behavioral}, mitigation}
  - ninetyDayPlan     : {objective, actions: 3-5 items, each {title, ownerRole, week, successSignal}}. MUST fit within organizational constraints of a ${framing.companyType}.
  - proofPoint        : {metric, threshold, reviewBy} — a SINGLE measurable signal that validates success
  - dependencies      : 2-5 items — what must happen before or alongside
  - risksAndTradeoffs : 2-4 items, each {risk, resistanceSource, mitigation}

═══ SNAPSHOT (5-SECOND TL;DR) ═══
Produce a compact summary designed to be read in 5 seconds by someone who may not read the rest of the report:
  - headline         : ONE sentence, newspaper-style. A statement, not a question. Must name the specific binding constraint or opportunity for THIS company. Max 20 words.
  - bottomLine       : 1-2 sentences stating what leadership should do and why. Concrete verb. No SaaS clichés.
  - keyStats         : 2-4 pre-formatted scannable facts, each {label, value}. The value is a HUMAN-READABLE STRING (not a number). Do NOT use headcount or capacity-freed labels. Examples:
                        { "label": "Value at stake", "value": "$40M–$60M annually" }
                        { "label": "Decisions required", "value": "3 board-level" }
                        { "label": "Time to first proof point", "value": "90 days" }
  - watchouts        : 1-2 short bullets flagging the risks most likely to derail execution. Audience-aware (Enterprise: governance; Startup: runway; ProfServices: partner alignment).
  - readingTime      : approximate reading time of the full report, e.g. "5 min read", "8 min read".
  - confidenceNote   : weakest confidence across the briefing's value claims (inherit from the executiveBrief.valueSummary).

═══ EXECUTIVE BRIEF ═══
Produce a crisp one-page-equivalent:
  - thesis          : Reuse or refine the framing's thesis. One sentence.
  - bigMove         : Reuse or refine the framing's bigMove. 1-2 sentences.
  - decisionsRequired: Same list as framing, in the same order, rewritten crisply if needed.
  - valueSummary    : ValueRange covering the whole report (logic = sum-of-blocks, assumptions = key inputs, confidenceNote = weakest of the individual blocks).
  - portfolioMaturity: {stage, evidence, gaps} — evidence MUST reference observable facts from the inputs; gaps MUST be specific.
  - deliveryMaturity : same structure, focused on operating model / delivery / governance.

═══ DEPARTMENT SIGNAL ═══
NOT a set of per-department dollar values. Instead: 3-6 short observations (one per relevant department) that surface patterns the decision blocks rely on. Each item: {department, observation (1-2 sentences), relevantDecisionBlockIds: decision IDs this observation supports}.

═══ ASSUMPTIONS & LIMITATIONS (MANDATORY) ═══
  - scopeOfInputData   : 1-2 sentences on what the analysis is based on (e.g., "90-minute consultation, 3 stakeholders, Q2 department data; no access to CRM, finance, or delivery telemetry").
  - uncertaintyNotes   : 3-6 bullets on what's uncertain and why.
  - validationRequired : 3-5 bullets on what must be validated before acting — name the system or owner where possible.

═══ PEER CONTEXT ═══
Reuse the framing's peerContextNote. Set confidence = "directional" if the note cites observable market patterns, "none" if you don't have data. NEVER name a specific competitor without a citation in the sources[] field.

═══ WORKED EXAMPLE — VALUE RANGE (ProfServices) ═══
{
  "low": 12000000,
  "high": 20000000,
  "logic": "~400 senior delivery staff × 20% coordination-tax reduction × ~$250/hr × 2000 hrs/yr × 10-15% realized in year one",
  "assumptions": ["Coordination tax currently 35-45% of senior time (stated in consultation)", "Realization in year 1 limited by partner council approval cycles", "Rate blended across Sr Manager/Director level"],
  "confidenceNote": "directional"
}

═══ WORKED EXAMPLE — VALUE RANGE (ProductTech) ═══
{
  "low": 3000000,
  "high": 6000000,
  "logic": "~2000 active paying accounts × 4% churn reduction × $8K avg ACV = $640K ARR protected per year; doubled over 18-month retention horizon",
  "assumptions": ["Baseline churn ~12% annual (inferred from growth-stage SaaS benchmarks)", "AI intervention targets at-risk segments representing ~40% of churn", "ACV stable over horizon"],
  "confidenceNote": "order-of-magnitude"
}`;

  const deptText =
    ctx.departments.length > 0
      ? ctx.departments
          .map((d) => {
            const wf = d.workflows
              .map(
                (w) =>
                  `    - ${w.name} | ${w.weeklyHours || '?'}h/wk × ${w.peopleInvolved || '?'} ppl | automation: ${w.automationLevel} | priority: ${w.priority} | pain: ${w.painPoints || 'none noted'}`,
              )
              .join('\n');
            return `  ${d.name} (${d.headcount || '?'} ppl, $${d.avgSalary || '?'} avg salary)\n${wf || '    (no workflows mapped)'}`;
          })
          .join('\n\n')
      : '(no departments mapped)';

  const answersText = ctx.consultationAnswers
    .map(
      (a) =>
        `  [${a.section}] Q: ${a.question}\n  A: ${typeof a.answer === 'object' ? JSON.stringify(a.answer) : a.answer}`,
    )
    .join('\n\n');

  const user = `Produce the briefing for ${ctx.organization.name}. The framing call has already decided audience, goal, company type, thesis, Big Move, the decisions required, and the overall value range. Your job is to expand the framing into a full briefing — decision blocks, executive brief, department signal, assumptions, peer context.

═══ FRAMING (FROM PASS 1 — TREAT AS GIVEN) ═══
companyType: ${framing.companyType}
primaryAudience: ${framing.primaryAudience}
reportGoal: ${framing.reportGoal}
inferenceRationale: ${framing.inferenceRationale}
thesis: ${framing.thesis}
bigMove: ${framing.bigMove}
decisionsRequired (produce one decision block per item, in order):
${framing.decisionsRequired.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}
valueLow: $${framing.valueLow.toLocaleString()}
valueHigh: $${framing.valueHigh.toLocaleString()}
portfolioMaturityStage: ${framing.portfolioMaturityStage}
deliveryMaturityStage: ${framing.deliveryMaturityStage}
peerContextNote: ${framing.peerContextNote}
keyAssumptions:
${framing.keyAssumptions.map((a) => `  - ${a}`).join('\n')}

═══ COMPANY CONTEXT ═══
Name: ${ctx.organization.name}
Industry: ${ctx.organization.industry}
Size: ${ctx.organization.size || 'Not specified'}

═══ BUSINESS CONTEXT ═══
${ctx.onboarding.businessDescription}
Revenue Streams: ${ctx.onboarding.revenueStreams}

═══ STATED CHALLENGES ═══
${[...ctx.onboarding.challenges, ctx.onboarding.customChallenges].filter(Boolean).join(', ') || '(none)'}

═══ CURRENT TOOLS ═══
${[...ctx.onboarding.tools, ctx.onboarding.customTools].filter(Boolean).join(', ') || '(none)'}

═══ STATED GOALS ═══
${[...ctx.onboarding.goals, ctx.onboarding.customGoals].filter(Boolean).join(', ') || '(none)'}

═══ DATA SOURCES ═══
${[...ctx.onboarding.dataSources, ctx.onboarding.customDataSources].filter(Boolean).join(', ') || '(none)'}
${
  ctx.scrapedInsights
    ? `
═══ WEBSITE INTELLIGENCE ═══
Title: ${ctx.scrapedInsights.title || 'N/A'}
Description: ${ctx.scrapedInsights.description || 'N/A'}
AI detected: ${ctx.scrapedInsights.aiDetected ? 'YES — ' + ctx.scrapedInsights.aiMentions.join(', ') : 'No'}
Automation detected: ${ctx.scrapedInsights.automationDetected ? 'YES — ' + ctx.scrapedInsights.automationMentions.join(', ') : 'No'}
Technologies: ${ctx.scrapedInsights.technologies.join(', ') || 'Unknown'}
Products: ${ctx.scrapedInsights.products.join(', ') || 'Unknown'}
Business model: ${ctx.scrapedInsights.businessModel?.type || 'Unknown'}
`
    : ''
}
═══ DEPARTMENTS & WORKFLOWS ═══
${deptText}

═══ CONSULTATION RESPONSES ═══
${answersText || '(none)'}

═══ OUTPUT SCHEMA ═══
Return a JSON object with this EXACT structure:
{
  "snapshot": {
    "headline": "<one sentence — the single most important statement>",
    "bottomLine": "<1-2 sentences — what leadership should do and why>",
    "keyStats": [
      { "label": "<label>", "value": "<pre-formatted string, e.g. '$40M–$60M annually'>" }
    ],
    "watchouts": ["<1-2 short bullets>"],
    "readingTime": "<e.g. '5 min read'>",
    "confidenceNote": "data-grounded" | "directional" | "order-of-magnitude"
  },
  "executiveBrief": {
    "thesis": "<one sentence>",
    "bigMove": "<1-2 sentences>",
    "decisionsRequired": ["<decision 1>", "<decision 2>", "<decision 3 (optional)>"],
    "valueSummary": {
      "low": <number>,
      "high": <number>,
      "logic": "<one sentence — sum of decision-block values or aggregate mechanism>",
      "assumptions": ["<assumption 1>", "<assumption 2>", "..."],
      "confidenceNote": "data-grounded" | "directional" | "order-of-magnitude"
    },
    "portfolioMaturity": {
      "stage": "Early" | "Working" | "Scaling" | "Native",
      "evidence": "<observable facts supporting this stage — cite specific tools, deployments>",
      "gaps": "<specific gaps vs the next stage up>"
    },
    "deliveryMaturity": {
      "stage": "Early" | "Working" | "Scaling" | "Native",
      "evidence": "<observable facts about delivery/governance/knowledge capture>",
      "gaps": "<specific gaps>"
    }
  },
  "decisionBlocks": [
    {
      "id": "<short-kebab-case-id>",
      "decision": "<state as a decision>",
      "whyNow": {
        "urgency": "<why time-sensitive>",
        "costOfInaction": "<what degrades if ignored>"
      },
      "value": { "low": <n>, "high": <n>, "logic": "<>", "assumptions": [".."], "confidenceNote": ".." },
      "ownership": {
        "accountableRole": "<single named role>",
        "supportingRoles": ["<role>", "<role>"]
      },
      "executionReality": [
        { "blocker": "<>", "category": "organizational" | "technical" | "behavioral", "mitigation": "<>" },
        { ... 2 more ... }
      ],
      "ninetyDayPlan": {
        "objective": "<one sentence, scoped to 90 days>",
        "actions": [
          { "title": "<>", "ownerRole": "<>", "week": "<e.g. Weeks 1-2>", "successSignal": "<>" }
        ]
      },
      "proofPoint": {
        "metric": "<specific metric>",
        "threshold": "<value that validates>",
        "reviewBy": "<e.g. End of Q2>"
      },
      "dependencies": ["<>", "<>"],
      "risksAndTradeoffs": [
        { "risk": "<>", "resistanceSource": "<role or group>", "mitigation": "<>" }
      ]
    }
  ],
  "departmentSignal": [
    {
      "department": "<name>",
      "observation": "<1-2 sentences pattern observation>",
      "relevantDecisionBlockIds": ["<id>"]
    }
  ],
  "assumptionsAndLimitations": {
    "scopeOfInputData": "<1-2 sentences on what analysis is based on>",
    "uncertaintyNotes": ["<>", "<>", "<>"],
    "validationRequired": ["<>", "<>", "<>"]
  },
  "peerContext": {
    "note": "<1-2 sentences>",
    "confidence": "directional" | "none",
    "sources": []
  }
}

Remember:
- EXACTLY ${framing.decisionsRequired.length} decision blocks, in the same order as decisionsRequired.
- Every ValueRange has {low, high, logic, assumptions, confidenceNote}. No exceptions.
- Each decisionBlock.executionReality has EXACTLY 3 blockers.
- ninetyDayPlan.actions must be realistic for a ${framing.companyType} — do NOT promise cross-BU rollout in 90 days.
- assumptionsAndLimitations is mandatory and non-empty.
- The tone must match audience: ${framing.primaryAudience}.
- No SaaS clichés. No emojis. No "Your recommendations have been added to the Tracker" handoff language.`;

  return { system, user };
}

/**
 * Builds a deterministic scope banner from real DB names. Returns empty string
 * for ORG scope. Used by both framing and briefing prompts so the model knows
 * to keep recommendations within the scoped entity.
 */
export function buildReportScopeBanner(scope?: ReportScopeContext): string {
  if (!scope || scope.scope === 'ORG') return '';
  if (scope.scope === 'DEPARTMENT' && scope.departmentName) {
    return `═══ REPORT SCOPE ═══
This briefing is scoped to a SINGLE DEPARTMENT: **${scope.departmentName}**.
- Every decision block, value range, and recommendation must apply only to this department.
- Do NOT propose company-wide initiatives or recommendations for other departments.
- Department signal must contain only this department.
- Snapshot and executive brief must explicitly read as a department-level briefing.
═══════════════════════════════`;
  }
  if (scope.scope === 'WORKFLOW' && scope.workflowName) {
    return `═══ REPORT SCOPE ═══
This briefing is scoped to a SINGLE WORKFLOW: **${scope.workflowName}**${
      scope.departmentName ? ` (within the ${scope.departmentName} department)` : ''
    }.
- Every decision block, value range, and recommendation must apply only to this workflow.
- Do NOT propose department-wide or company-wide initiatives.
- Department signal must reference only the parent department, scoped to this workflow.
- Snapshot and executive brief must explicitly read as a workflow-level briefing.
═══════════════════════════════`;
  }
  return '';
}

/**
 * @deprecated — use buildBriefingPrompt(ctx, framing) as part of the two-pass flow.
 * Retained to keep existing imports of this function (type surface) from breaking
 * during the migration. The AiService now calls framing + briefing explicitly.
 */
export function buildReportGenerationPrompt(_ctx: ReportGenerationContext): {
  system: string;
  user: string;
} {
  throw new Error(
    'buildReportGenerationPrompt is deprecated. Use the two-pass flow via AiService.generateTransformationReport, which calls buildFramingPrompt then buildBriefingPrompt.',
  );
}
