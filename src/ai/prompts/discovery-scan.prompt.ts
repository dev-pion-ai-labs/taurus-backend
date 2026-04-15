export interface DiscoveryScanContext {
  url: string;
  industry?: string;
  scrapedData: {
    title?: string;
    description?: string;
    mainContent?: string;
    techStack?: string[];
    aiSignals?: string[];
    automationSignals?: string[];
    products?: { name?: string; description?: string }[];
    services?: { name?: string; description?: string }[];
    companyInfo?: {
      name?: string;
      industry?: string;
      companySize?: string;
      founded?: string;
    };
  };
}

export interface DiscoveryScanResult {
  score: number;
  maturityLevel: string;
  industry: string;
  companySize: string;
  techStack: { name: string; category: string }[];
  aiSignals: { type: string; detail: string }[];
  summary: string;
  recommendations: { title: string; description: string; priority: string }[];
}

export function buildDiscoveryScanPrompt(ctx: DiscoveryScanContext): {
  system: string;
  user: string;
} {
  const system = `You are an AI transformation analyst at a top-tier consulting firm. Analyze a company's web presence and estimate their AI maturity. Score conservatively — most companies score 25-55 from public signals alone. This is a preliminary scan, not a full assessment.

Return ONLY valid JSON, no markdown fences or extra text.`;

  const companyInfo = ctx.scrapedData.companyInfo;
  const products = ctx.scrapedData.products?.map((p) => p.name).join(', ') || 'None detected';
  const services = ctx.scrapedData.services?.map((s) => s.name).join(', ') || 'None detected';
  const techStack = ctx.scrapedData.techStack?.join(', ') || 'None detected';
  const aiSignals = ctx.scrapedData.aiSignals?.join(', ') || 'None detected';
  const automationSignals = ctx.scrapedData.automationSignals?.join(', ') || 'None detected';

  // Truncate main content to avoid token limits
  const contentPreview = ctx.scrapedData.mainContent
    ? ctx.scrapedData.mainContent.substring(0, 6000)
    : 'No content available';

  const user = `Analyze this company based on their web presence:

URL: ${ctx.url}
${ctx.industry ? `Stated Industry: ${ctx.industry}` : 'Industry: Detect from content'}

Company Name: ${companyInfo?.name || 'Unknown'}
Founded: ${companyInfo?.founded || 'Unknown'}
Company Size: ${companyInfo?.companySize || 'Unknown'}
Detected Industry: ${companyInfo?.industry || 'Unknown'}

Products: ${products}
Services: ${services}
Detected Tech Stack: ${techStack}
AI Signals: ${aiSignals}
Automation Signals: ${automationSignals}

Website Title: ${ctx.scrapedData.title || 'N/A'}
Website Description: ${ctx.scrapedData.description || 'N/A'}

Content Preview:
${contentPreview}

Generate a JSON object with this exact structure:
{
  "score": <number 0-100, AI maturity estimate based on public signals>,
  "maturityLevel": "<one of: AI_UNAWARE, AI_CURIOUS, AI_EXPERIMENTING, AI_SCALING, AI_NATIVE>",
  "industry": "<detected industry>",
  "companySize": "<estimated size: 1-10, 11-50, 51-200, 201-500, 501-1000, 1001-5000, 5000+>",
  "techStack": [
    { "name": "<tool/platform name>", "category": "<AI_PLATFORM|AUTOMATION|ANALYTICS|CRM|COMMUNICATION|DEVELOPMENT|SECURITY|INDUSTRY_SPECIFIC|OTHER>" }
  ],
  "aiSignals": [
    { "type": "<JOB_POSTING|PRODUCT_FEATURE|PARTNERSHIP|CONTENT_MENTION|TECH_ADOPTION>", "detail": "<specific finding>" }
  ],
  "summary": "<2-3 paragraph executive summary: what this company does, their current AI/tech posture, key opportunities. Be specific and actionable, not generic.>",
  "recommendations": [
    { "title": "<short title>", "description": "<1-2 sentence recommendation>", "priority": "<HIGH|MEDIUM|LOW>" }
  ]
}

Scoring guide:
- 0-20 (AI_UNAWARE): No AI/automation signals, basic web presence, no tech sophistication
- 21-40 (AI_CURIOUS): Some modern tools, digital presence but no AI usage
- 41-60 (AI_EXPERIMENTING): Using some AI tools, partial automation, modern tech stack
- 61-80 (AI_SCALING): AI integrated into products/services, clear AI strategy
- 81-100 (AI_NATIVE): AI-first company, AI embedded throughout operations

Provide 3-5 specific, actionable recommendations. Be specific to this company, not generic.`;

  return { system, user };
}
