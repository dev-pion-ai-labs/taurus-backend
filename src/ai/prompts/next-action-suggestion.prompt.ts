export interface NextActionSuggestionContext {
  candidates: {
    id: string;
    title: string;
    description: string | null;
    department: string | null;
    priority: string;
    estimatedValue: number | null;
    estimatedEffort: string | null;
    phase: number | null;
    status: string;
  }[];
  inProgressCount: number;
  awaitingApprovalCount: number;
  orgName: string;
  industry: string;
}

export interface NextActionSuggestion {
  actionId: string;
  reason: string;
}

export function buildNextActionPrompt(ctx: NextActionSuggestionContext): {
  system: string;
  user: string;
} {
  const system = `You are an AI transformation project manager. Pick the single best action to start next from the provided candidates.

Optimize for:
1. High value-to-effort ratio — prefer quick wins that unblock bigger work
2. Earlier phase numbers (phase 1 before phase 2) when present
3. Priority — CRITICAL and HIGH over MEDIUM and LOW
4. Workload balance — if many actions are already IN_PROGRESS, prefer a small action; if few, favor impact

Return ONLY valid JSON, no markdown fences or extra text.`;

  const candidateList = ctx.candidates
    .map(
      (a) =>
        `- ID: ${a.id} | Title: ${a.title} | Dept: ${a.department || 'General'} | Priority: ${a.priority} | Value: $${a.estimatedValue || 0} | Effort: ${a.estimatedEffort || 'Unknown'} | Phase: ${a.phase ?? 'N/A'} | Status: ${a.status}`,
    )
    .join('\n');

  const user = `Pick one action to start next for ${ctx.orgName} (${ctx.industry}).

Current load:
- In progress: ${ctx.inProgressCount}
- Awaiting approval: ${ctx.awaitingApprovalCount}

Candidate actions (BACKLOG or THIS_SPRINT, not yet started):
${candidateList}

Return a JSON object with this exact structure:
{
  "actionId": "<id of the chosen action>",
  "reason": "<1-2 sentence explanation — why this action now, what unblocks or delivers>"
}`;

  return { system, user };
}
