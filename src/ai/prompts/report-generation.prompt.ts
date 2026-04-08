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

  const system = `You are an expert AI transformation consultant producing a board-ready AI Transformation Roadmap. You analyze companies with surgical precision and generate quantified, dollar-valued recommendations.

Return ONLY valid JSON matching the exact schema specified. No markdown, no commentary, no wrapping. Start with { and end with }.

CRITICAL RULES for dollar values:
- Calibrate ALL dollar values to the company's size and industry. A 10-person startup and a 500-person enterprise have very different values.
- Use the average salary data if provided to calculate FTE savings accurately.
- If no salary data, use industry benchmarks: Tech $95K, Finance $105K, Healthcare $85K, Retail $55K, default $75K.
- Weekly hours saved × 52 weeks × (hourly rate) = annual value. Hourly rate = avg salary / 2080.
- Generate ${minDepts} departments (use provided departments, add 1-2 inferred ones only if fewer than 3 were provided), ${minRecs} recommendations, and ${minPhases} implementation phases with 2-4 actions each.
- Every recommendation must have a unique UUID as its "id" field.
- All scores are integers 0-100. All dollar values are numbers (not strings).
- Be concise in descriptions — 1 sentence max for currentState, potentialState, currentProcess, aiOpportunity. Keep the total output compact.`;

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

Remember: Generate ${minDepts} departments${deptCount > 0 ? ' (use the provided ones, only infer if fewer than 3)' : ' (infer from industry)'}, ${minRecs} recommendations, and ${minPhases} phases with 2-4 actions each. All dollar values must be realistic for a ${ctx.organization.size || 'mid-size'}-employee ${ctx.organization.industry} company. Every recommendation needs a unique UUID. Keep descriptions concise — 1 sentence each.`;

  return { system, user };
}
