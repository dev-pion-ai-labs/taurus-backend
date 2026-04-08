export interface ReportGenerationContext {
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

export function buildReportGenerationPrompt(ctx: ReportGenerationContext): {
  system: string;
  user: string;
} {
  // Scale output requirements to actual company data
  const deptCount = ctx.departments.length;
  const minDepts = deptCount >= 3 ? deptCount : Math.max(3, deptCount + 1);
  const minRecs = Math.max(5, minDepts * 2);
  const minPhases = 3;

  const system = `You are an expert AI transformation consultant producing a board-ready AI Transformation Roadmap. You analyze companies with surgical precision and generate quantified, dollar-valued recommendations grounded in real data.

Return ONLY valid JSON matching the exact schema specified. No markdown, no commentary, no wrapping. Start with { and end with }.

═══ SCORING RUBRIC (overallScore & departmentScores) ═══
Score based on CURRENT AI/automation adoption, NOT potential or product offering:
  0-20  "AI Curious"    — No AI/automation in use. Fully manual processes. No data infrastructure.
  21-40 "AI Aware"      — Some basic automation (email sequences, simple integrations). Awareness of AI but no meaningful deployment. Limited data utilization.
  41-60 "AI Ready"      — Active use of AI tools in 1-2 areas. Some workflow automation. Data collected but not systematically leveraged. Team has basic AI literacy.
  61-80 "AI Advancing"  — AI integrated into core workflows across multiple departments. Predictive analytics in use. Automated decision-making in at least one area. Systematic data pipelines.
  81-100 "AI Native"    — AI-first operations. Most decisions augmented by AI. Closed-loop learning systems. Advanced automation across all departments. Real-time data-driven everything.

IMPORTANT: Score what the company DOES internally, not what they sell. A company selling AI products but running manual internal operations scores low. Credit existing tools/integrations (Zapier, HubSpot workflows, etc.) proportionally.

═══ FINANCIAL METHODOLOGY ═══
All dollar values MUST be derived from traceable calculations, not round estimates:
- Use provided avg salary per department. If missing, use industry benchmarks: Tech $95K, Finance $105K, Healthcare $85K, Retail $55K, default $75K.
- Hourly rate = avg salary / 2080 hours.
- Efficiency value = weeklyHoursSaved × 52 × hourlyRate × automationPotential%. This is cost savings from time freed.
- Growth value = estimated revenue impact from better conversion, retention, speed-to-market, etc. Must be justified by a specific mechanism (e.g., "improving trial conversion from 8% to 12% on $X pipeline").
- fteRedeployable = total weekly hours saved across all workflows / 40. These are hours freed, not layoffs — frame as capacity unlocked.
- Do NOT inflate values to seem impressive. A 5-person startup cannot save $500K/year. Total AI value should be plausible as a % of estimated revenue/costs.
- Phase totalValue = sum of action values in that phase. Must add up.

═══ GENERATION RULES ═══
- Generate ${minDepts} departments (use provided departments, add 1-2 inferred ones only if fewer than 3 were provided), ${minRecs} recommendations, and ${minPhases} implementation phases with 2-4 actions each.
- Every recommendation must have a unique UUID as its "id" field.
- All scores are integers 0-100. All dollar values are numbers (not strings).
- Department scores should have meaningful spread (not all within 5-10 points). Differentiate clearly.
- Recommendations should reference specific findings from the consultation and website data — not generic advice.
- executiveSummary.summary should be 3-5 sentences: lead with the single most important insight, then key opportunity, then the magnitude of value at stake.
- keyFindings: 5-7 findings. Each should be specific to THIS company — mention their tools, their metrics, their stated challenges. Never generic.
- Keep descriptions concise — 1-2 sentences max for currentState, potentialState, currentProcess, aiOpportunity.`;

  // Build departments section
  let departmentsText =
    'No departments mapped yet — infer standard departments from the industry and company size.';
  if (ctx.departments.length > 0) {
    departmentsText = ctx.departments
      .map((d) => {
        const workflows = d.workflows
          .map(
            (w) =>
              `    - ${w.name}: ${w.description || 'No description'} | ${w.weeklyHours || '?'}h/week | ${w.peopleInvolved || '?'} people | Automation: ${w.automationLevel} | Pain: ${w.painPoints || 'None noted'} | Priority: ${w.priority}`,
          )
          .join('\n');
        return `  ${d.name} (${d.headcount || '?'} people, avg salary: $${d.avgSalary || 'unknown'}/yr)\n${workflows || '    No workflows mapped'}`;
      })
      .join('\n\n');
  }

  // Build consultation answers section
  const answersText = ctx.consultationAnswers
    .map(
      (a) =>
        `  [${a.section}] Q: ${a.question}\n  A: ${typeof a.answer === 'object' ? JSON.stringify(a.answer) : a.answer}`,
    )
    .join('\n\n');

  const user = `Analyze this company and generate a complete AI Transformation Roadmap.

═══ COMPANY CONTEXT ═══
Name: ${ctx.organization.name}
Industry: ${ctx.organization.industry}
Size: ${ctx.organization.size || 'Not specified'} employees

═══ BUSINESS CONTEXT ═══
Description: ${ctx.onboarding.businessDescription}
Revenue Streams: ${ctx.onboarding.revenueStreams}

═══ CHALLENGES ═══
${[...ctx.onboarding.challenges, ctx.onboarding.customChallenges].filter(Boolean).join(', ')}

═══ CURRENT TOOLS & TECH STACK ═══
${[...ctx.onboarding.tools, ctx.onboarding.customTools].filter(Boolean).join(', ')}

═══ AI GOALS ═══
${[...ctx.onboarding.goals, ctx.onboarding.customGoals].filter(Boolean).join(', ')}

═══ AVAILABLE DATA SOURCES ═══
${[...ctx.onboarding.dataSources, ctx.onboarding.customDataSources].filter(Boolean).join(', ')}
${ctx.scrapedInsights ? `
═══ WEBSITE INTELLIGENCE (scraped from company website) ═══
Site: ${ctx.scrapedInsights.title || 'N/A'} — ${ctx.scrapedInsights.description || 'No description'}
AI Usage Detected: ${ctx.scrapedInsights.aiDetected ? 'YES — ' + ctx.scrapedInsights.aiMentions.join(', ') : 'No'}
Automation Detected: ${ctx.scrapedInsights.automationDetected ? 'YES — ' + ctx.scrapedInsights.automationMentions.join(', ') : 'No'}
Technologies: ${ctx.scrapedInsights.technologies.join(', ') || 'Unknown'}
Products: ${ctx.scrapedInsights.products.join(', ') || 'Unknown'}
Services: ${ctx.scrapedInsights.services.join(', ') || 'Unknown'}
${ctx.scrapedInsights.companyInfo ? `Company Info: ${Object.entries(ctx.scrapedInsights.companyInfo).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')}` : ''}
${ctx.scrapedInsights.businessModel ? `Business Model: ${ctx.scrapedInsights.businessModel.type || 'Unknown'}${ctx.scrapedInsights.businessModel.revenueStreams?.length ? ' — Revenue: ' + ctx.scrapedInsights.businessModel.revenueStreams.join(', ') : ''}` : ''}
USE THIS DATA to ground your analysis — reference specific technologies, products, and AI/automation findings in your scores and recommendations.
` : ''}
═══ DEPARTMENTS & WORKFLOWS ═══
${departmentsText}

═══ CONSULTATION RESPONSES ═══
${answersText || 'No consultation responses available.'}

═══ OUTPUT SCHEMA ═══
Return a JSON object with this EXACT structure:

{
  "overallScore": <integer 0-100>,
  "maturityLevel": "<one of: AI Curious | AI Aware | AI Ready | AI Advancing | AI Native>",
  "fteRedeployable": <float, number of full-time equivalents that can be redeployed>,
  "executiveSummary": {
    "summary": "<3-5 sentence executive overview of the company's AI transformation opportunity>",
    "keyFindings": ["<finding 1>", "<finding 2>", ... ] // 5-7 key findings
  },
  "departmentScores": [
    {
      "department": "<department name>",
      "score": <integer 0-100>,
      "maturityLevel": "<same scale>",
      "currentState": "<1-2 sentences: how this department currently uses AI/automation>",
      "potentialState": "<1-2 sentences: what this department looks like fully AI-enabled>",
      "efficiencyValue": <number: annual $ savings>,
      "growthValue": <number: annual $ revenue opportunity>,
      "workflows": [
        {
          "name": "<workflow name>",
          "currentProcess": "<how it works now>",
          "aiOpportunity": "<what AI can do>",
          "automationPotential": <integer 0-100>,
          "weeklyHoursSaved": <number>,
          "annualValueSaved": <number>,
          "effort": "LOW" | "MEDIUM" | "HIGH",
          "timeframe": "WEEKS" | "MONTHS" | "QUARTER"
        }
      ]
    }
  ],
  "recommendations": [
    {
      "id": "<unique UUID v4>",
      "title": "<actionable title>",
      "description": "<2-3 sentences: what, why, expected outcome>",
      "department": "<department name>",
      "impact": "HIGH" | "MEDIUM" | "LOW",
      "effort": "LOW" | "MEDIUM" | "HIGH",
      "annualValue": <number>,
      "timeToImplement": "<e.g. 2-3 weeks>",
      "prerequisites": ["<prereq 1>", ...],
      "category": "EFFICIENCY" | "GROWTH" | "EXPERIENCE" | "INTELLIGENCE"
    }
  ],
  "implementationPlan": [
    {
      "phase": <1|2|3|4>,
      "name": "<Quick Wins | Foundation | Scale | Optimize>",
      "timeframe": "<e.g. Weeks 1-4>",
      "focus": "<1 sentence: what this phase achieves>",
      "totalValue": <number: combined $ value of this phase>,
      "actions": [
        {
          "title": "<action title>",
          "department": "<department>",
          "value": <number>,
          "effort": "LOW" | "MEDIUM" | "HIGH",
          "status": "NOT_STARTED"
        }
      ]
    }
  ]
}

Remember:
- Generate ${minDepts} departments${deptCount > 0 ? ' (use the provided ones, only infer if fewer than 3)' : ' (infer from industry)'}, ${minRecs} recommendations, and ${minPhases} phases with 2-4 actions each.
- All dollar values must be traceable: show the math via the methodology above. A ${ctx.organization.size || 'mid-size'}-employee company cannot save more than a realistic % of its payroll.
- Every recommendation needs a unique UUID.
- Department scores should have at least 15-point spread between highest and lowest.
- Reference specific consultation answers and website findings — not generic advice.
- Keep descriptions concise — 1-2 sentences each.`;

  return { system, user };
}
