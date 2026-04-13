export interface SprintSuggestionContext {
  backlogActions: {
    id: string;
    title: string;
    department: string | null;
    priority: string;
    estimatedValue: number | null;
    estimatedEffort: string | null;
    phase: number | null;
  }[];
  currentSprintCount: number;
  averageVelocity: number;
  orgName: string;
  industry: string;
}

export interface SprintSuggestion {
  name: string;
  goal: string;
  suggestedActions: string[]; // action IDs
  rationale: string;
  estimatedValue: number;
}

export function buildSprintSuggestionPrompt(ctx: SprintSuggestionContext): {
  system: string;
  user: string;
} {
  const system = `You are an AI transformation project manager specializing in sprint planning for enterprise digital transformations. Suggest an optimal 2-week sprint from the provided backlog.

Select 6-10 actions optimized for:
1. Value/effort ratio — prefer high-value, low-effort actions
2. Dependency ordering — phase 1 actions before phase 2, etc.
3. Priority — CRITICAL and HIGH before MEDIUM and LOW
4. Department diversity — spread work across departments to avoid bottlenecks

Return ONLY valid JSON, no markdown fences or extra text.`;

  const backlogList = ctx.backlogActions
    .map(
      (a) =>
        `- ID: ${a.id} | Title: ${a.title} | Dept: ${a.department || 'General'} | Priority: ${a.priority} | Value: $${a.estimatedValue || 0} | Effort: ${a.estimatedEffort || 'Unknown'} | Phase: ${a.phase ?? 'N/A'}`,
    )
    .join('\n');

  const user = `Plan the next sprint for ${ctx.orgName} (${ctx.industry}).

Current sprint count: ${ctx.currentSprintCount}
Average velocity (actions/sprint): ${ctx.averageVelocity}

Backlog actions:
${backlogList}

Return a JSON object with this exact structure:
{
  "name": "<sprint name, e.g. 'Sprint ${ctx.currentSprintCount + 1}: Quick Wins'>",
  "goal": "<1-2 sentence sprint goal>",
  "suggestedActions": ["<action ID>", ...],
  "rationale": "<2-3 sentence explanation of why these actions were selected and how they complement each other>",
  "estimatedValue": <total estimated dollar value of selected actions>
}

Select ${Math.min(Math.max(Math.round(ctx.averageVelocity) || 6, 6), 10)} actions that maximize impact while being achievable in a 2-week sprint.`;

  return { system, user };
}
