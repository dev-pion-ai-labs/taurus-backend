import { ArtifactType } from '@prisma/client';

export interface ArtifactGenerationContext {
  planTitle: string;
  planSummary: string | null;
  planSteps: unknown;
  planPrerequisites: unknown;
  planRisks: unknown;
  actionTitle: string;
  actionDescription: string | null;
  actionDepartment: string | null;
  organizationName: string;
  industry: string;
}

const ARTIFACT_INSTRUCTIONS: Record<ArtifactType, { title: string; prompt: string }> = {
  IMPLEMENTATION_GUIDE: {
    title: 'Implementation Guide',
    prompt: `Create a comprehensive step-by-step implementation guide in Markdown format. Include:
- Executive overview
- Detailed steps with sub-tasks
- Technical requirements and specifications
- Team responsibilities and RACI matrix
- Timeline with milestones
- Success criteria and KPIs
- Rollback procedures`,
  },
  CONFIGURATION_TEMPLATE: {
    title: 'Configuration Template',
    prompt: `Create configuration templates and setup instructions. Include:
- Environment configuration (YAML/JSON templates with placeholder values)
- API integration configuration
- Authentication and permission setup
- Feature flags and gradual rollout settings
- Monitoring and alerting thresholds
- Include inline comments explaining each configuration option`,
  },
  INTEGRATION_CHECKLIST: {
    title: 'Integration Checklist',
    prompt: `Create a detailed integration checklist in Markdown with checkboxes. Include:
- [ ] Pre-integration checks (system requirements, access, credentials)
- [ ] Data integration tasks (schemas, mappings, validation)
- [ ] API integration tasks (endpoints, auth, rate limits)
- [ ] Security review items
- [ ] Testing tasks (unit, integration, UAT)
- [ ] Go-live checklist
- [ ] Post-deployment verification`,
  },
  VENDOR_EVALUATION: {
    title: 'Vendor Evaluation Matrix',
    prompt: `Create a vendor evaluation framework. Include:
- Evaluation criteria with weights (features, cost, support, security, scalability)
- Scoring rubric (1-5 scale with descriptions)
- Comparison matrix template (Markdown table)
- Key questions for vendor demos
- Total cost of ownership template
- Risk assessment per vendor category
- Recommendation framework`,
  },
  CODE_SNIPPET: {
    title: 'Code Snippets & Integration Examples',
    prompt: `Create practical code snippets and integration examples. Include:
- API client setup and authentication
- Key integration patterns (webhook handlers, data sync, error handling)
- Example configurations
- Testing utilities and mock setups
- Common patterns for the specific tools/platforms involved
Use TypeScript/JavaScript as the primary language, with notes for other languages where relevant.`,
  },
  CUSTOM: {
    title: 'Custom Document',
    prompt: `Create a comprehensive document covering the key aspects of this deployment plan that aren't covered by other artifact types. Focus on the most important operational details.`,
  },
};

export function buildArtifactPrompt(
  type: ArtifactType,
  context: ArtifactGenerationContext,
): { system: string; user: string } {
  const instruction = ARTIFACT_INSTRUCTIONS[type];

  const system = `You are an expert technical writer creating deployment artifacts for an AI transformation platform called Taurus. Produce high-quality, actionable documents that teams can directly use. Write in Markdown format. Be specific to the organization and plan context — avoid generic advice.`;

  const user = `Generate a "${instruction.title}" artifact for the following deployment plan:

Organization: ${context.organizationName} (${context.industry})
Plan: ${context.planTitle}
${context.planSummary ? `Summary: ${context.planSummary}` : ''}
Action: ${context.actionTitle}
${context.actionDescription ? `Action Description: ${context.actionDescription}` : ''}
${context.actionDepartment ? `Department: ${context.actionDepartment}` : ''}

Plan Steps:
${JSON.stringify(context.planSteps, null, 2)}

Prerequisites:
${JSON.stringify(context.planPrerequisites, null, 2)}

Risks:
${JSON.stringify(context.planRisks, null, 2)}

${instruction.prompt}

Produce the artifact content directly as Markdown. Do NOT wrap in code fences.`;

  return { system, user };
}

export function getArtifactTitle(type: ArtifactType): string {
  return ARTIFACT_INSTRUCTIONS[type].title;
}
