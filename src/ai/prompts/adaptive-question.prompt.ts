export interface ScopedDepartmentContext {
  name: string;
  headcount: number | null;
  avgSalary: number | null;
  notes: string | null;
  workflows: Array<{
    name: string;
    description: string | null;
    weeklyHours: number | null;
    peopleInvolved: number | null;
    automationLevel: string;
    painPoints: string | null;
    priority: string;
  }>;
}

export interface ScopedWorkflowContext {
  name: string;
  description: string | null;
  weeklyHours: number | null;
  peopleInvolved: number | null;
  automationLevel: string;
  painPoints: string | null;
  priority: string;
  department: { name: string; headcount: number | null };
}

export interface AdaptiveQuestionContext {
  organization: {
    name: string;
    industry: string;
    size: string | null;
  };
  onboarding: {
    businessDescription: string;
    revenueStreams: string;
    challenges: string[];
    tools: string[];
    goals: string[];
  };
  scrapedInsights?: {
    aiDetected: boolean;
    aiMentions: string[];
    automationDetected: boolean;
    automationMentions: string[];
    technologies: string[];
    products: string[];
    services: string[];
  };
  scope?: 'ORG' | 'DEPARTMENT' | 'WORKFLOW';
  scopedDepartment?: ScopedDepartmentContext;
  scopedWorkflow?: ScopedWorkflowContext;
  previousQA: Array<{
    question: string;
    questionType: string;
    answer: unknown;
    section: string;
  }>;
}

/**
 * Build a deterministic, grounded preamble from real DB fields when the
 * consultation is scoped to a department or workflow. Returns an empty string
 * for ORG scope. Null fields are omitted — never inferred.
 */
export function buildScopePreamble(ctx: AdaptiveQuestionContext): string {
  if (!ctx.scope || ctx.scope === 'ORG') return '';

  if (ctx.scope === 'DEPARTMENT' && ctx.scopedDepartment) {
    const d = ctx.scopedDepartment;
    const lines: string[] = [
      `═══ CONSULTATION SCOPE: DEPARTMENT ═══`,
      `This consultation is scoped to the **${d.name}** department only. Ground every question in facts about this department. Do NOT invent details that are not provided below.`,
      `Department facts:`,
      `- Name: ${d.name}`,
    ];
    if (d.headcount != null) lines.push(`- Headcount: ${d.headcount}`);
    if (d.avgSalary != null) lines.push(`- Avg salary: $${d.avgSalary}`);
    if (d.notes) lines.push(`- Notes: ${d.notes}`);
    if (d.workflows.length) {
      lines.push(`Workflows in this department:`);
      for (const w of d.workflows) {
        const parts: string[] = [`  - ${w.name}`];
        if (w.weeklyHours != null) parts.push(`${w.weeklyHours}h/wk`);
        if (w.peopleInvolved != null) parts.push(`${w.peopleInvolved} ppl`);
        parts.push(`automation: ${w.automationLevel}`);
        parts.push(`priority: ${w.priority}`);
        if (w.painPoints) parts.push(`pain: ${w.painPoints}`);
        lines.push(parts.join(' | '));
      }
    } else {
      lines.push(`(no workflows mapped for this department)`);
    }
    lines.push(
      `Constraint: every question must apply to this department's people, workflows, or processes. Do NOT ask company-wide questions.`,
    );
    return lines.join('\n');
  }

  if (ctx.scope === 'WORKFLOW' && ctx.scopedWorkflow) {
    const w = ctx.scopedWorkflow;
    const lines: string[] = [
      `═══ CONSULTATION SCOPE: WORKFLOW ═══`,
      `This consultation is scoped to a single workflow: **${w.name}** within the **${w.department.name}** department. Ground every question in this workflow only. Do NOT invent details.`,
      `Workflow facts:`,
      `- Name: ${w.name}`,
      `- Department: ${w.department.name}${w.department.headcount != null ? ` (${w.department.headcount} ppl)` : ''}`,
    ];
    if (w.description) lines.push(`- Description: ${w.description}`);
    if (w.weeklyHours != null) lines.push(`- Weekly hours: ${w.weeklyHours}`);
    if (w.peopleInvolved != null) lines.push(`- People involved: ${w.peopleInvolved}`);
    lines.push(`- Current automation level: ${w.automationLevel}`);
    lines.push(`- Priority: ${w.priority}`);
    if (w.painPoints) lines.push(`- Pain points: ${w.painPoints}`);
    lines.push(
      `Constraint: every question must apply to this single workflow. Do NOT ask department-wide or company-wide questions.`,
    );
    return lines.join('\n');
  }

  return '';
}

export interface GeneratedAdaptiveQuestion {
  questionText: string;
  questionType: 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE';
  options: string[] | null;
}

export function buildInitialQuestionsPrompt(
  ctx: AdaptiveQuestionContext,
  opts: { count?: string } = {},
) {
  const count = opts.count ?? '4-5';
  const system = `You are an elite AI transformation consultant conducting a deep-dive consultation. Generate highly personalized consultation questions based on the company's specific profile, website data, and stated challenges.

Output ONLY valid JSON — no markdown, no code fences, no explanation.`;

  const scrapedSection = ctx.scrapedInsights
    ? `
Website Intelligence:
- AI Usage Detected: ${ctx.scrapedInsights.aiDetected ? 'YES — ' + ctx.scrapedInsights.aiMentions.join(', ') : 'No AI usage found'}
- Automation Detected: ${ctx.scrapedInsights.automationDetected ? 'YES — ' + ctx.scrapedInsights.automationMentions.join(', ') : 'No automation found'}
- Technologies: ${ctx.scrapedInsights.technologies.join(', ') || 'Unknown'}
- Products: ${ctx.scrapedInsights.products.join(', ') || 'Unknown'}
- Services: ${ctx.scrapedInsights.services.join(', ') || 'Unknown'}`
    : '';

  const scopePreamble = buildScopePreamble(ctx);
  const scopeBlock = scopePreamble ? `\n\n${scopePreamble}\n` : '';

  const user = `Generate ${count} personalized consultation questions for this company.${scopeBlock}

Company Profile:
- Name: ${ctx.organization.name}
- Industry: ${ctx.organization.industry}
- Size: ${ctx.organization.size || 'Not specified'}
- Business: ${ctx.onboarding.businessDescription || 'Not provided'}
- Revenue Streams: ${ctx.onboarding.revenueStreams || 'Not provided'}
- Key Challenges: ${ctx.onboarding.challenges.join(', ') || 'Not specified'}
- Current Tools: ${ctx.onboarding.tools.join(', ') || 'Not specified'}
- AI/Automation Goals: ${ctx.onboarding.goals.join(', ') || 'Not specified'}
${scrapedSection}

Requirements:
- Questions must be SPECIFIC to this company — reference their industry, tools, challenges, and website findings
- ${ctx.scrapedInsights?.aiDetected ? 'They already use AI — ask about depth, ROI, scaling plans, and gaps' : 'They appear to NOT use AI yet — ask about readiness, barriers, and use cases they see potential in'}
- ${ctx.scrapedInsights?.automationDetected ? 'They have automation in place — explore what works, what doesn\'t, and expansion opportunities' : 'Limited automation detected — explore manual processes, bottlenecks, and automation appetite'}
- Mix question types: TEXT (~45%), SINGLE_CHOICE/MULTI_CHOICE (~40%), SCALE (~15%)
- For SINGLE_CHOICE and MULTI_CHOICE: provide 4-6 realistic options tailored to their context
- For SCALE: range is always 1-5
- Order from broad strategic questions to specific tactical ones
- Do NOT ask things already known from the profile above

Return a JSON array:
[
  {
    "questionText": "...",
    "questionType": "TEXT" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "SCALE",
    "options": ["option1", "option2"] | null
  }
]`;

  return { system, user };
}

export function buildAdaptiveFollowUpPrompt(
  ctx: AdaptiveQuestionContext,
  opts: { count?: string } = {},
) {
  const count = opts.count ?? '2-3';
  const system = `You are an elite AI transformation consultant conducting a deep-dive consultation. Based on the conversation so far, generate follow-up questions that dig deeper into the most important areas revealed by the user's answers.

Output ONLY valid JSON — no markdown, no code fences, no explanation.`;

  const qaHistory = ctx.previousQA
    .map(
      (qa, i) =>
        `Q${i + 1} [${qa.section}]: ${qa.question}\nA${i + 1}: ${typeof qa.answer === 'object' ? JSON.stringify(qa.answer) : qa.answer}`,
    )
    .join('\n\n');

  const scrapedSection = ctx.scrapedInsights
    ? `
Website Intelligence:
- AI: ${ctx.scrapedInsights.aiDetected ? ctx.scrapedInsights.aiMentions.join(', ') : 'None detected'}
- Automation: ${ctx.scrapedInsights.automationDetected ? ctx.scrapedInsights.automationMentions.join(', ') : 'None detected'}
- Tech Stack: ${ctx.scrapedInsights.technologies.join(', ') || 'Unknown'}`
    : '';

  const scopePreamble = buildScopePreamble(ctx);
  const scopeBlock = scopePreamble ? `\n\n${scopePreamble}\n` : '';

  const user = `Based on this consultation so far, generate ${count} adaptive follow-up questions.${scopeBlock}

Company: ${ctx.organization.name} (${ctx.organization.industry}, ${ctx.organization.size || 'size unknown'})
${scrapedSection}

Conversation History:
${qaHistory}

Requirements:
- Questions MUST build on specific answers given — reference what they said
- Dig deeper into: pain points revealed, interesting tool choices, gaps between goals and current state
- If they mentioned specific challenges, ask about impact, urgency, or current workarounds
- If they rated something low on a scale, ask why and what would help
- If they mentioned tools/platforms, ask about adoption, satisfaction, or integration gaps
- Do NOT repeat or rephrase already-asked questions
- Mix types: TEXT (~50%), SINGLE_CHOICE/MULTI_CHOICE (~35%), SCALE (~15%)
- For choices: 4-6 realistic options based on their specific context
- Each question should feel like a natural follow-up in a real consulting conversation

Return a JSON array:
[
  {
    "questionText": "...",
    "questionType": "TEXT" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "SCALE",
    "options": ["option1", "option2"] | null
  }
]`;

  return { system, user };
}
