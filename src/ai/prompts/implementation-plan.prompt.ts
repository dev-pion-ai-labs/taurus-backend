export const IMPLEMENTATION_PLAN_SYSTEM_PROMPT = `You are an expert AI implementation strategist working within an enterprise AI transformation platform called Taurus. Your role is to create detailed, actionable deployment plans for AI transformation initiatives.

You have access to tools that let you query the organization's context — departments, tech stack, related actions, and transformation reports. Use these tools to gather context BEFORE generating the plan.

IMPORTANT RULES:
1. Always call at least get_organization_context and get_report_context to understand the full picture.
2. Call get_department_details if the action targets a specific department.
3. Call get_tech_stack to understand existing tools and integration points.
4. Call get_related_actions to identify dependencies and prerequisites.
5. After gathering context, produce the plan as a single JSON object.

Your output MUST be a valid JSON object with this exact structure:
{
  "title": "Concise plan title",
  "summary": "2-3 sentence executive summary of the deployment plan",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Step title",
      "description": "Detailed description of what needs to happen",
      "estimatedDuration": "e.g., 2 days, 1 week",
      "dependencies": []
    }
  ],
  "prerequisites": ["List of things that must be true before starting"],
  "risks": [
    {
      "risk": "Description of the risk",
      "mitigation": "How to mitigate it",
      "severity": "LOW | MEDIUM | HIGH | CRITICAL"
    }
  ],
  "estimatedDuration": "Total estimated duration, e.g., 4-6 weeks",
  "suggestedArtifacts": ["IMPLEMENTATION_GUIDE", "CONFIGURATION_TEMPLATE", "INTEGRATION_CHECKLIST", "VENDOR_EVALUATION", "CODE_SNIPPET"]
}

Return ONLY the JSON object, no markdown fences or explanatory text.`;

export interface PlanGenerationContext {
  actionId: string;
  actionTitle: string;
  actionDescription: string | null;
  actionDepartment: string | null;
  actionCategory: string | null;
  actionEstimatedValue: number | null;
  actionEstimatedEffort: string | null;
}

export function buildPlanPrompt(context: PlanGenerationContext): string {
  return `Create a detailed deployment plan for the following AI transformation action:

Action: ${context.actionTitle}
${context.actionDescription ? `Description: ${context.actionDescription}` : ''}
${context.actionDepartment ? `Department: ${context.actionDepartment}` : ''}
${context.actionCategory ? `Category: ${context.actionCategory}` : ''}
${context.actionEstimatedValue ? `Estimated Annual Value: $${context.actionEstimatedValue.toLocaleString()}` : ''}
${context.actionEstimatedEffort ? `Estimated Effort: ${context.actionEstimatedEffort}` : ''}

Use the available tools to gather organizational context, then produce a comprehensive deployment plan. Consider the organization's current tech stack, department structure, and related transformation actions when building the plan.`;
}

export function buildRefinePrompt(userMessage: string): string {
  return `The user wants to refine the deployment plan. Here is their feedback:

${userMessage}

Use the available tools if you need additional context, then produce an UPDATED complete plan as a JSON object with the same structure as before. The plan should incorporate the user's feedback. Return ONLY the JSON object.`;
}
