export function buildQuestionGenerationPrompt(
  industryName: string,
  challengeAreas: string[],
) {
  const system = `You are an AI transformation consultant. Generate industry-specific consultation questions that help assess an organization's readiness for AI transformation.

Output ONLY valid JSON — no markdown, no code fences, no explanation.`;

  const user = `Generate 10-15 consultation questions specific to the **${industryName}** industry.

Requirements:
- Questions must be specific to ${industryName} — universal questions are handled separately
- Cover: current processes, industry pain points, regulatory/compliance, data maturity, workforce readiness
- Mix question types: TEXT (~50%), SINGLE_CHOICE/MULTI_CHOICE (~35%), SCALE (~15%)
- For SINGLE_CHOICE and MULTI_CHOICE: provide 4-6 realistic options
- For SCALE: range is always 1-5
- Tag each question with 1-3 relevant challenge areas from this list: ${challengeAreas.join(', ')}

Return a JSON array with this exact structure:
[
  {
    "questionText": "...",
    "questionType": "TEXT" | "SINGLE_CHOICE" | "MULTI_CHOICE" | "SCALE",
    "options": ["option1", "option2"] | null,
    "challengeAreaTags": ["tag1", "tag2"],
    "rationale": "Why this question matters for ${industryName}"
  }
]`;

  return { system, user };
}
