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
  department: {
    name: string;
    headcount: number | null;
    /** Free-text notes captured when the dept was created — surfaces as
     *  contextual grounding for workflow-scoped questions. */
    notes: string | null;
  };
  /** Up to 3 sibling workflows in the same department. Used to drive
   *  comparative questions ("how does this differ from peer workflows?"). */
  siblingWorkflows?: Array<{
    name: string;
    automationLevel: string;
    weeklyHours: number | null;
    painPoints: string | null;
    priority: string;
  }>;
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
  /** Other departments in the same org. Surfaced for DEPARTMENT-scope
   *  pregen so questions can frame this dept relative to peers (size,
   *  presence). Cap ~5 names. */
  siblingDepartments?: Array<{
    name: string;
    headcount: number | null;
  }>;
  /**
   * True when this is NOT the org's first consultation (an earlier ORG-level
   * session has been completed). Drives a different prompt that avoids
   * re-asking baseline questions.
   */
  isFollowUp?: boolean;
  /**
   * Most-recent answered questions from prior consultation sessions for the
   * same org — only populated when isFollowUp. Used as grounding so the AI
   * can ask "what's changed since X?" instead of repeating baselines.
   */
  priorOrgAnswers?: Array<{
    question: string;
    answer: unknown;
    completedAt: string;
  }>;
  previousQA: Array<{
    question: string;
    questionType: string;
    answer: unknown;
    section: string;
  }>;
}

/**
 * Build a follow-up preamble when this org has already completed at least one
 * consultation. Includes the most recent prior answers as grounding so the AI
 * can ask "what's changed?" instead of re-asking baseline questions. Returns
 * empty string when isFollowUp is false. Null/empty answers are omitted.
 */
export function buildFollowUpPreamble(ctx: AdaptiveQuestionContext): string {
  if (!ctx.isFollowUp) return '';

  const priorBlock =
    ctx.priorOrgAnswers && ctx.priorOrgAnswers.length > 0
      ? `\nPrior consultation answers (most recent first):\n${ctx.priorOrgAnswers
          .slice(0, 20)
          .map((qa, i) => {
            const ans =
              typeof qa.answer === 'object'
                ? JSON.stringify(qa.answer)
                : String(qa.answer);
            return `  ${i + 1}. Q: ${qa.question}\n     A: ${ans}`;
          })
          .join('\n')}\n`
      : '\n(No prior answers were retained, but this org has completed a consultation before.)\n';

  return `\n\n═══ FOLLOW-UP CONSULTATION ═══
This org has consulted with us before. Do **NOT** re-ask the baseline questions they have already answered (industry, business description, current tools, top challenges, primary goals). Instead, your questions must:
  1. Probe what has CHANGED since the prior consultation (new tools, new constraints, shifted priorities).
  2. Dig DEEPER into ambiguities or contradictions in the prior answers.
  3. Explore areas that were NOT covered before (newly relevant given current state).
${priorBlock}═══════════════════════════════
`;
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
    if (ctx.siblingDepartments && ctx.siblingDepartments.length) {
      const peers = ctx.siblingDepartments
        .slice(0, 5)
        .map(
          (s) =>
            `${s.name}${s.headcount != null ? ` (${s.headcount})` : ''}`,
        )
        .join(', ');
      lines.push(`Peer departments in this org: ${peers}`);
    }
    lines.push(
      `Constraint: every question must apply to this department's people, workflows, or processes. Do NOT ask company-wide questions.`,
      `Comparative angle: where it sharpens the question, frame against this dept's own workflows or peer departments listed above. Avoid generic "how do you measure efficiency" questions.`,
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
    if (w.department.notes) {
      lines.push(`- Department notes: ${w.department.notes}`);
    }
    if (w.description) lines.push(`- Description: ${w.description}`);
    if (w.weeklyHours != null) lines.push(`- Weekly hours: ${w.weeklyHours}`);
    if (w.peopleInvolved != null) lines.push(`- People involved: ${w.peopleInvolved}`);
    lines.push(`- Current automation level: ${w.automationLevel}`);
    lines.push(`- Priority: ${w.priority}`);
    if (w.painPoints) lines.push(`- Pain points: ${w.painPoints}`);
    if (w.siblingWorkflows && w.siblingWorkflows.length) {
      lines.push(`Peer workflows in the same department:`);
      for (const s of w.siblingWorkflows.slice(0, 3)) {
        const parts: string[] = [`  - ${s.name}`];
        if (s.weeklyHours != null) parts.push(`${s.weeklyHours}h/wk`);
        parts.push(`automation: ${s.automationLevel}`);
        parts.push(`priority: ${s.priority}`);
        if (s.painPoints) parts.push(`pain: ${s.painPoints}`);
        lines.push(parts.join(' | '));
      }
    }
    lines.push(
      `Constraint: every question must apply to this single workflow. Do NOT ask department-wide or company-wide questions.`,
      `Comparative angle: where useful, reference how this workflow differs from the peer workflows listed above (automation gap, hours, pain). Avoid generic "do you use any tools" questions.`,
    );
    return lines.join('\n');
  }

  return '';
}

/**
 * For DEPARTMENT and WORKFLOW pregen: when the org has a recently completed
 * ORG-level consultation, surface a short "themes already covered" block so
 * scope-level questions don't redundantly re-ask company-wide ground.
 * Returns empty string for ORG scope (handled by buildFollowUpPreamble) or
 * when no prior answers are available.
 */
export function buildScopedPriorThemesBlock(
  ctx: AdaptiveQuestionContext,
): string {
  if (!ctx.scope || ctx.scope === 'ORG') return '';
  if (!ctx.priorOrgAnswers || ctx.priorOrgAnswers.length === 0) return '';

  const themes = ctx.priorOrgAnswers
    .slice(0, 6)
    .map((qa) => {
      const ans =
        typeof qa.answer === 'object'
          ? JSON.stringify(qa.answer)
          : String(qa.answer);
      const trimmedAns = ans.length > 100 ? ans.slice(0, 100) + '…' : ans;
      return `  - ${qa.question} → ${trimmedAns}`;
    })
    .join('\n');

  return `\n═══ ORG-LEVEL CONTEXT (prior consultation) ═══
The org has answered these questions in a recent ORG-wide consultation. Use them as background; do NOT re-ask the same ground at this scope:
${themes}
═════════════════════════════════════════════
`;
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
  const followUpBlock = buildFollowUpPreamble(ctx);
  const scopedPriorBlock = buildScopedPriorThemesBlock(ctx);

  // Scope-tuned question type mix and few-shot examples — workflows reward
  // tactical TEXT (process detail) + SCALE (rate friction); departments
  // reward strategic CHOICE/SCALE; org keeps the original balanced mix.
  let typeMixLine: string;
  let fewShotBlock: string;
  if (ctx.scope === 'WORKFLOW') {
    typeMixLine =
      '- Mix question types for THIS scope: TEXT (~50%, process specifics), SCALE (~25%, rate friction/maturity), SINGLE_CHOICE/MULTI_CHOICE (~25%, structured choices)';
    fewShotBlock = `

Examples (illustrative — do NOT copy verbatim, adapt to the actual workflow facts above):
  GOOD: "Your ${ctx.scopedWorkflow?.name ?? 'reporting'} workflow runs at ${ctx.scopedWorkflow?.automationLevel ?? 'NONE'} automation while a peer in the same dept runs higher — what's the single biggest blocker to lifting it?"
  GOOD: "On a 1-5 scale, how much of the ${ctx.scopedWorkflow?.weeklyHours ?? 'weekly'}h spent on this workflow is rework or chasing inputs?"
  AVOID (too generic): "Do you use any tools?"
  AVOID (out of scope): "How does your company measure overall AI maturity?"`;
  } else if (ctx.scope === 'DEPARTMENT') {
    typeMixLine =
      '- Mix question types for THIS scope: TEXT (~35%), SCALE (~25%, dept-level maturity ratings), SINGLE_CHOICE (~25%), MULTI_CHOICE (~15%)';
    fewShotBlock = `

Examples (illustrative — do NOT copy verbatim, adapt to the actual department facts above):
  GOOD: "Of the workflows in ${ctx.scopedDepartment?.name ?? 'this dept'} (${(ctx.scopedDepartment?.workflows ?? []).map((w) => w.name).slice(0, 3).join(', ') || 'listed above'}), which one would deliver the biggest payoff if automated first?"
  GOOD: "On a 1-5 scale, how confident is the ${ctx.scopedDepartment?.name ?? 'department'} team that current tools can scale with planned headcount?"
  AVOID (too generic): "How do you measure your team's efficiency?"
  AVOID (out of scope): "What's the company's overall vision for AI?"`;
  } else {
    typeMixLine =
      '- Mix question types: TEXT (~45%), SINGLE_CHOICE/MULTI_CHOICE (~40%), SCALE (~15%)';
    fewShotBlock = '';
  }

  const user = `Generate ${count} personalized consultation questions for this company.${scopeBlock}${followUpBlock}${scopedPriorBlock}

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
- Questions must be SPECIFIC — reference real facts from the scope and profile above (workflow names, technologies, tools, products/services, pain points). Do NOT speak in generalities.
- ${ctx.scrapedInsights?.aiDetected ? 'They already use AI — ask about depth, ROI, scaling plans, and gaps' : 'They appear to NOT use AI yet — ask about readiness, barriers, and use cases they see potential in'}
- ${ctx.scrapedInsights?.automationDetected ? 'They have automation in place — explore what works, what doesn\'t, and expansion opportunities' : 'Limited automation detected — explore manual processes, bottlenecks, and automation appetite'}
${ctx.scrapedInsights && ctx.scrapedInsights.technologies.length ? `- Anchor at least one question to a real item from their tech stack (${ctx.scrapedInsights.technologies.slice(0, 5).join(', ')}) or stated tools where relevant to this scope.` : ''}
${ctx.scrapedInsights && (ctx.scrapedInsights.products.length || ctx.scrapedInsights.services.length) ? `- Their offerings include ${[...ctx.scrapedInsights.products, ...ctx.scrapedInsights.services].slice(0, 5).join(', ')} — connect at least one question to how this scope supports those offerings.` : ''}
${typeMixLine}
- For SINGLE_CHOICE and MULTI_CHOICE: provide 4-6 realistic options tailored to their context
- For SCALE: range is always 1-5
- Order from broad strategic questions to specific tactical ones
- Do NOT ask things already known from the profile or prior consultation themes above${fewShotBlock}

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
