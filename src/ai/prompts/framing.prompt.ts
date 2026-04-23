import type { ReportGenerationContext } from './report-generation.prompt';

/**
 * Pass 1 — the Framing Call.
 *
 * Returns a compact JSON object that sets the lens for the full briefing:
 *   - companyType       (Enterprise / ProfServices / Startup / ProductTech)
 *   - primaryAudience   (CLevel / Partner / Founder)
 *   - reportGoal        (Decide / Align / Validate / Explore)
 *   - thesis            (one sentence — the single most important insight)
 *   - bigMove           (the highest-leverage action, 1-2 sentences)
 *   - decisionsRequired (2-3 yes/no-shaped items for leadership)
 *   - valueLow/High     (order-of-magnitude range, not a point estimate)
 *   - peerContextNote   (directional, honest about confidence)
 *   - keyAssumptions    (list that Pass 2 must respect)
 *   - portfolioMaturityStage / deliveryMaturityStage
 */
export function buildFramingPrompt(ctx: ReportGenerationContext): {
  system: string;
  user: string;
} {
  const system = `You are a senior strategist producing the FRAMING for a leadership briefing, not the briefing itself. Your output sets the tone, audience, and core thesis that a downstream briefing call will expand into decision blocks.

Return ONLY valid JSON matching the exact schema specified. No markdown, no commentary. Start with { and end with }.

═══ COMPANY TYPE INFERENCE ═══
Infer ONE of:
  "Enterprise"      — Large regulated or multi-layered organization. 5000+ headcount OR regulated industry (banking, insurance, pharma, gov) OR multi-BU/multi-region structure.
  "ProfServices"    — Consulting, law, accounting, advisory. Professional-services firms (e.g., Big 4, boutique consultancies, law firms). Revenue is billable time.
  "Startup"         — Early/growth-stage company, <300 headcount, single product focus, VC- or founder-funded. Founder-led decision-making.
  "ProductTech"     — Established product or SaaS company, 300–5000 headcount, product-led org. Not ProfServices, not Startup, not regulated-Enterprise.

Use the industry, employee size, business description, scraped website data, and consultation answers. If genuinely ambiguous, pick the closest and note the ambiguity in inferenceRationale.

═══ AUDIENCE MAPPING ═══
Default mapping (override only with strong evidence):
  Enterprise   → "CLevel"
  ProfServices → "Partner"
  Startup      → "Founder"
  ProductTech  → "CLevel" (use "Founder" if <500 headcount and founder-led signal present)

═══ REPORT GOAL INFERENCE ═══
Pick ONE based on consultation signals:
  "Decide"   — Leadership is evaluating a specific commit/not-commit choice. Signals: pricing, vendor selection, POC-to-prod, budget approvals.
  "Align"    — Multiple stakeholders need to agree on a plan. Signals: cross-BU rollout, enterprise governance, change mgmt asks.
  "Validate" — An approach exists but needs external pressure-testing. Signals: "is this the right way", POC results, risk review.
  "Explore"  — The problem space is open. Signals: "what could we do", "where should we start", first-time engagement, broad intake.

═══ THESIS ═══
One sentence. Lead with the single most important insight about this company — the core constraint OR opportunity, not a summary. Must reference something specific to THIS company. Never generic.

═══ BIG MOVE ═══
1-2 sentences. The highest-leverage action implied by the thesis. Must be concrete enough that a leadership team can debate yes/no.

═══ DECISIONS REQUIRED ═══
2-3 items. Each must be shaped as an explicit choice (commit/not commit, build/buy, centralize/federate, etc.) — not a task. Written so a CEO or Managing Partner could put it on a board slide.

═══ VALUE RANGE ═══
valueLow and valueHigh are annual $ values. ROUND HEAVILY. No values below $500,000 precision; no sub-$1M granularity below $25M; $5M granularity above $25M. Prefer a wider, honest range over a narrower, false one.

CEILING: Total valueHigh must be plausible as a % of estimated annual payroll or revenue.
  - Estimated payroll = sum(department.headcount × avgSalary) or industry default ($75K × headcount) if missing.
  - valueHigh must be ≤ 15% of estimated payroll for efficiency-heavy companies, ≤ 25% for growth-heavy companies.
  - A 5-person company CANNOT have $10M in annual AI value.

═══ PEER CONTEXT ═══
If you have directional knowledge of what similar companies do, write 1-2 sentences. Be honest about confidence. NEVER name specific competitors without sourcing. If you don't have data, the note must say "We do not have structured peer data for this segment — directional only".

═══ MATURITY STAGES ═══
Infer TWO separate stages, each "Early" | "Working" | "Scaling" | "Native":
  portfolioMaturityStage — Does the AI they currently USE (internally) actually work? Anchored on observable deployment, not on what they sell or plan.
  deliveryMaturityStage  — Does the operating model around AI (delivery, governance, knowledge capture) actually function?
NO numeric scores. The stages are observable states, not a ranking.

═══ KEY ASSUMPTIONS ═══
3-6 bullet-point assumptions the briefing call must respect (e.g., "Assume avg salary in target roles is $X", "Assume regulatory review adds 6-8 weeks per decision"). These are inputs the downstream pass treats as given.

═══ TONE ═══
Write as a peer strategist to the audience — never a SaaS vendor. Forbidden vocabulary: "ship", "jump in", "unlock", "leverage" (as a verb), "empower", "enable". For Enterprise/ProfServices audiences use governance and P&L language. For Founder audiences use runway and velocity language.`;

  const deptSummary =
    ctx.departments.length > 0
      ? ctx.departments
          .map(
            (d) =>
              `  - ${d.name}: ${d.headcount ?? '?'} people, $${d.avgSalary ?? '?'} avg salary, ${d.workflows.length} workflows mapped`,
          )
          .join('\n')
      : '  (no departments mapped yet)';

  const answersText = ctx.consultationAnswers
    .slice(0, 30)
    .map(
      (a) =>
        `  [${a.section}] Q: ${a.question}\n  A: ${typeof a.answer === 'object' ? JSON.stringify(a.answer) : a.answer}`,
    )
    .join('\n\n');

  const user = `Infer the framing for this company's briefing.

═══ COMPANY CONTEXT ═══
Name: ${ctx.organization.name}
Industry: ${ctx.organization.industry}
Size: ${ctx.organization.size || 'Not specified'} employees

═══ BUSINESS CONTEXT ═══
Description: ${ctx.onboarding.businessDescription}
Revenue Streams: ${ctx.onboarding.revenueStreams}

═══ STATED CHALLENGES ═══
${[...ctx.onboarding.challenges, ctx.onboarding.customChallenges].filter(Boolean).join(', ') || '(none stated)'}

═══ STATED GOALS ═══
${[...ctx.onboarding.goals, ctx.onboarding.customGoals].filter(Boolean).join(', ') || '(none stated)'}

═══ CURRENT TOOLS ═══
${[...ctx.onboarding.tools, ctx.onboarding.customTools].filter(Boolean).join(', ') || '(none stated)'}

═══ DEPARTMENTS (SUMMARY) ═══
${deptSummary}
${
  ctx.scrapedInsights
    ? `
═══ WEBSITE INTELLIGENCE ═══
Title: ${ctx.scrapedInsights.title || 'N/A'}
Description: ${ctx.scrapedInsights.description || 'N/A'}
AI detected: ${ctx.scrapedInsights.aiDetected ? 'YES — ' + ctx.scrapedInsights.aiMentions.slice(0, 5).join(', ') : 'No'}
Automation detected: ${ctx.scrapedInsights.automationDetected ? 'YES — ' + ctx.scrapedInsights.automationMentions.slice(0, 5).join(', ') : 'No'}
Business model: ${ctx.scrapedInsights.businessModel?.type || 'Unknown'}
`
    : ''
}
═══ CONSULTATION RESPONSES (first 30) ═══
${answersText || '(none)'}

═══ OUTPUT SCHEMA ═══
Return a JSON object with this EXACT structure:
{
  "companyType": "Enterprise" | "ProfServices" | "Startup" | "ProductTech",
  "primaryAudience": "CLevel" | "Partner" | "Founder",
  "reportGoal": "Decide" | "Align" | "Validate" | "Explore",
  "inferenceRationale": "<1-2 sentences: why these three tags given the inputs>",
  "thesis": "<one sentence — the single most important insight>",
  "bigMove": "<1-2 sentences — the highest-leverage action>",
  "decisionsRequired": ["<decision 1 (yes/no-shaped)>", "<decision 2>", "<decision 3 (optional)>"],
  "valueLow": <number, annual $ low bound>,
  "valueHigh": <number, annual $ high bound>,
  "peerContextNote": "<1-2 sentences; state 'directional only' or 'no peer data' if uncertain>",
  "keyAssumptions": ["<assumption 1>", "<assumption 2>", "..."],
  "portfolioMaturityStage": "Early" | "Working" | "Scaling" | "Native",
  "deliveryMaturityStage":  "Early" | "Working" | "Scaling" | "Native"
}

Remember:
- valueHigh must be a plausible % of estimated payroll. A 5-person company cannot show $10M.
- The thesis must be specific to THIS company — mention their tools, stated challenges, or business specifics.
- Tone must match primaryAudience (C-level: governance + P&L; Partner: practice leadership + utilization; Founder: runway + velocity).`;

  return { system, user };
}
