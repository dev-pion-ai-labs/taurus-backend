export interface ToolOverlapContext {
  tools: {
    name: string;
    category: string;
    notes: string | null;
    monthlyCost: number | null;
  }[];
  industry: string;
}

export interface ToolOverlapResult {
  overlaps: {
    tools: string[];
    capability: string;
    recommendation: string;
    potentialSaving: number;
  }[];
  summary: string;
}

export function buildToolOverlapPrompt(ctx: ToolOverlapContext): {
  system: string;
  user: string;
} {
  const system = `You are an enterprise software stack optimization analyst. Analyze a company's tool inventory to identify overlapping capabilities, redundancies, and consolidation opportunities. Focus on actionable recommendations that reduce cost while maintaining or improving capability coverage.

Return ONLY valid JSON, no markdown fences or extra text.`;

  const toolList = ctx.tools
    .map(
      (t) =>
        `- ${t.name} (Category: ${t.category}, Cost: $${t.monthlyCost ?? 'Unknown'}/mo${t.notes ? `, Notes: ${t.notes}` : ''})`,
    )
    .join('\n');

  const user = `Analyze this tool inventory for a ${ctx.industry} company:

${toolList}

Identify overlapping tools and consolidation opportunities. Return a JSON object:
{
  "overlaps": [
    {
      "tools": ["Tool A", "Tool B"],
      "capability": "<the overlapping capability, e.g. 'project management'>",
      "recommendation": "<specific recommendation on which to keep/consolidate>",
      "potentialSaving": <estimated monthly savings in dollars>
    }
  ],
  "summary": "<2-3 sentence executive summary of the stack health and top consolidation opportunity>"
}

Only flag genuine overlaps where tools serve the same function. If no overlaps exist, return an empty overlaps array with a summary noting the stack is well-optimized.`;

  return { system, user };
}
