import { Injectable, Logger } from '@nestjs/common';
import Firecrawl from '@mendable/firecrawl-js';

export interface ScrapedWebsiteData {
  title?: string;
  description?: string;
  keywords?: string[];
  headings?: string[];
  mainContent?: string;
  socialLinks?: string[];
  contactInfo?: {
    emails?: string[];
    phones?: string[];
    email?: string;
    phone?: string;
  };
  metadata?: {
    url?: string;
    scrapedAt?: string;
    language?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogImage?: string;
    statusCode?: number;
    contentType?: string;
    pagesDiscovered?: number;
    pagesScraped?: number;
  };
  businessData?: {
    companyInfo?: {
      name?: string;
      mission?: string;
      industry?: string;
      companySize?: string;
      founded?: string;
      headquarters?: string;
    };
    products?: Array<{
      name?: string;
      description?: string;
      category?: string;
    }>;
    services?: Array<{
      name?: string;
      description?: string;
    }>;
    businessModel?: {
      type?: string;
      revenueStreams?: string[];
    };
    challenges?: string[];
    goals?: string[];
    technologies?: string[];
    aiDetected?: boolean;
    aiMentions?: string[];
    automationDetected?: boolean;
    automationMentions?: string[];
  };
  links?: string[];
  images?: string[];
  branding?: any;
  error?: string;
}

// Pages ranked by relevance for AI/automation intelligence
const HIGH_PRIORITY_PATTERNS = [
  /^\/?$/, // homepage
  /\b(about|company|who-we-are)\b/i,
  /\b(technology|tech|platform|infrastructure)\b/i,
  /\b(ai|artificial-intelligence|machine-learning|ml)\b/i,
  /\b(automation|automate|rpa|workflow)\b/i,
  /\b(products?|solutions?|offerings?)\b/i,
  /\b(services?|capabilities)\b/i,
  /\b(integrations?|partners?|ecosystem)\b/i,
  /\b(engineering|developers?|dev)\b/i,
  /\b(careers?|jobs?|hiring)\b/i, // reveals tech stack
  /\b(pricing|plans)\b/i,
  /\b(case-stud|success-stor|customers?)\b/i,
  /\b(blog|resources?|insights?|news)\b/i,
  /\b(security|compliance|trust)\b/i,
  /\b(data|analytics|reporting)\b/i,
  /\b(contact|support)\b/i,
];

const MAX_PAGES_TO_SCRAPE = 20;

@Injectable()
export class WebsiteScraperService {
  private readonly logger = new Logger(WebsiteScraperService.name);
  private readonly firecrawl: Firecrawl;

  constructor() {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY environment variable is required');
    }
    this.firecrawl = new Firecrawl({ apiKey });
  }

  async scrapeWebsite(url: string): Promise<ScrapedWebsiteData> {
    try {
      const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
      this.logger.log(`Scraping website: ${normalizedUrl}`);

      // Step 1: Discover real pages using Firecrawl's map
      const pagesToScrape = await this.discoverPages(normalizedUrl);
      this.logger.log(
        `Discovered ${pagesToScrape.length} relevant pages to scrape`,
      );

      // Step 2: Scrape all discovered pages concurrently
      const scrapePromises = pagesToScrape.map((pageUrl) =>
        this.scrapePage(pageUrl),
      );
      const scrapeResults = await Promise.all(scrapePromises);
      const validResults = scrapeResults.filter((r) => r !== null);

      this.logger.log(
        `Successfully scraped ${validResults.length}/${pagesToScrape.length} pages`,
      );

      // Step 3: Aggregate all page data
      const data = this.aggregateResults(normalizedUrl, validResults);
      data.metadata!.pagesDiscovered = pagesToScrape.length;
      data.metadata!.pagesScraped = validResults.length;

      // Step 4: Run AI & automation detection on visible text
      this.detectAiAndAutomation(data, validResults);

      this.logger.log(`Successfully scraped ${normalizedUrl}`);
      return data;
    } catch (error) {
      const errorMessage = (error as Error).message || 'Unknown error';
      this.logger.warn(`Failed to scrape ${url}: ${errorMessage}`);
      return { error: errorMessage };
    }
  }

  /**
   * Discover real pages on the site via Firecrawl map, then rank and select
   * the most relevant ones for AI/automation intelligence.
   */
  private async discoverPages(baseUrl: string): Promise<string[]> {
    try {
      const mapResult = await this.firecrawl.map(baseUrl, {
        limit: 100,
        includeSubdomains: false,
      });

      if (!mapResult.links?.length) {
        this.logger.warn('Map returned no links, falling back to guessed paths');
        return this.getFallbackPages(baseUrl);
      }

      const discoveredUrls = mapResult.links.map((link) =>
        typeof link === 'string' ? link : link.url,
      );
      this.logger.log(`Map discovered ${discoveredUrls.length} URLs`);

      // Score and rank pages by relevance
      const scored = discoveredUrls.map((url: string) => ({
        url,
        score: this.scorePageRelevance(url, baseUrl),
      }));

      scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);

      // Always include homepage, then top-scored pages
      const selected = scored
        .filter((s: { score: number }) => s.score > 0)
        .slice(0, MAX_PAGES_TO_SCRAPE)
        .map((s: { url: string }) => s.url);

      // Ensure homepage is included
      if (!selected.some((u: string) => this.isHomepage(u, baseUrl))) {
        selected.unshift(baseUrl);
      }

      return selected.slice(0, MAX_PAGES_TO_SCRAPE);
    } catch (error) {
      this.logger.warn(
        `Map failed, falling back to guessed paths: ${(error as Error).message}`,
      );
      return this.getFallbackPages(baseUrl);
    }
  }

  private scorePageRelevance(pageUrl: string, baseUrl: string): number {
    const path = pageUrl
      .replace(baseUrl.replace(/\/$/, ''), '')
      .toLowerCase();

    // Skip non-content pages
    if (
      /\.(pdf|jpg|png|gif|svg|css|js|xml|json|zip|mp4|webp)(\?|$)/i.test(
        pageUrl,
      )
    ) {
      return 0;
    }
    if (/\b(privacy|terms|cookie|legal|sitemap|login|signup|auth)\b/i.test(path)) {
      return 0;
    }

    // Homepage gets top score
    if (this.isHomepage(pageUrl, baseUrl)) return 100;

    let score = 1;
    for (const pattern of HIGH_PRIORITY_PATTERNS) {
      if (pattern.test(path)) {
        score += 10;
        break;
      }
    }

    // Prefer shallow pages (fewer path segments = more likely a main page)
    const depth = path.split('/').filter(Boolean).length;
    if (depth <= 1) score += 5;
    else if (depth === 2) score += 2;

    return score;
  }

  private isHomepage(pageUrl: string, baseUrl: string): boolean {
    const clean = pageUrl.replace(/\/+$/, '');
    const baseClean = baseUrl.replace(/\/+$/, '');
    return clean === baseClean;
  }

  private getFallbackPages(baseUrl: string): string[] {
    const base = baseUrl.replace(/\/$/, '');
    return [
      baseUrl,
      `${base}/about`,
      `${base}/company`,
      `${base}/products`,
      `${base}/services`,
      `${base}/solutions`,
      `${base}/platform`,
      `${base}/technology`,
      `${base}/careers`,
      `${base}/pricing`,
      `${base}/contact`,
      `${base}/integrations`,
      `${base}/customers`,
      `${base}/blog`,
    ];
  }

  private async scrapePage(pageUrl: string) {
    try {
      return await this.firecrawl.scrape(pageUrl, {
        formats: [
          'markdown',
          'html',
          'links',
          'images',
          'branding',
          {
            type: 'json',
            schema: {
              type: 'object',
              properties: {
                companyInfo: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    mission: { type: 'string' },
                    industry: { type: 'string' },
                    companySize: { type: 'string' },
                    founded: { type: 'string' },
                    headquarters: { type: 'string' },
                  },
                },
                products: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                      category: { type: 'string' },
                    },
                  },
                },
                services: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
                businessModel: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    revenueStreams: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
                challenges: {
                  type: 'array',
                  items: { type: 'string' },
                },
                goals: {
                  type: 'array',
                  items: { type: 'string' },
                },
                technologies: {
                  type: 'array',
                  items: { type: 'string' },
                },
                aiUsage: {
                  type: 'object',
                  description:
                    'Any AI, machine learning, or intelligent system usage detected on this page',
                  properties: {
                    detected: { type: 'boolean' },
                    tools: {
                      type: 'array',
                      items: { type: 'string' },
                      description:
                        'Specific AI tools, platforms, or models mentioned (e.g. ChatGPT, Claude, TensorFlow, custom ML models)',
                    },
                    useCases: {
                      type: 'array',
                      items: { type: 'string' },
                      description:
                        'How AI is being used (e.g. customer support chatbot, predictive analytics, content generation)',
                    },
                    maturity: {
                      type: 'string',
                      description:
                        'AI adoption maturity: "exploring", "piloting", "scaling", "embedded"',
                    },
                  },
                },
                automationUsage: {
                  type: 'object',
                  description:
                    'Any automation, workflow, or process automation detected on this page',
                  properties: {
                    detected: { type: 'boolean' },
                    tools: {
                      type: 'array',
                      items: { type: 'string' },
                      description:
                        'Specific automation tools or platforms mentioned (e.g. Zapier, UiPath, Terraform, Jenkins)',
                    },
                    processes: {
                      type: 'array',
                      items: { type: 'string' },
                      description:
                        'What processes are automated (e.g. CI/CD, invoice processing, customer onboarding)',
                    },
                  },
                },
              },
              required: ['companyInfo'],
            },
          },
        ],
      });
    } catch (error) {
      this.logger.warn(`Failed to scrape ${pageUrl}: ${error}`);
      return null;
    }
  }

  private aggregateResults(
    normalizedUrl: string,
    validResults: any[],
  ): ScrapedWebsiteData {
    const data: ScrapedWebsiteData = {
      title: '',
      description: '',
      keywords: [],
      headings: [],
      mainContent: '',
      socialLinks: [],
      contactInfo: { emails: [], phones: [] },
      metadata: {
        url: normalizedUrl,
        scrapedAt: new Date().toISOString(),
      },
      businessData: {},
      links: [],
      images: [],
      branding: null,
    };

    for (const result of validResults) {
      // Primary metadata from first page with a title (usually homepage)
      if (!data.title && result.metadata?.title) {
        data.title = result.metadata.title;
        data.description = result.metadata?.description || '';
        data.metadata!.language = result.metadata?.language;
        data.metadata!.ogTitle = result.metadata?.ogTitle;
        data.metadata!.ogDescription = result.metadata?.ogDescription;
        data.metadata!.ogImage = result.metadata?.ogImage;
        data.metadata!.statusCode = result.metadata?.statusCode;
        data.metadata!.contentType = result.metadata?.contentType;
      }

      // Keywords
      if (result.metadata?.keywords) {
        const pageKeywords = Array.isArray(result.metadata.keywords)
          ? result.metadata.keywords
          : result.metadata.keywords.split(',').map((k: string) => k.trim());
        for (const keyword of pageKeywords) {
          if (!data.keywords!.includes(keyword)) {
            data.keywords!.push(keyword);
          }
        }
      }

      // Content
      if (result.markdown) {
        data.mainContent += result.markdown + '\n\n---\n\n';
      }

      // Merge structured business data from all pages
      if (result.json) {
        this.mergeBusinessData(data.businessData!, result.json);
      }

      // Links (cap at 200)
      if (result.links && data.links!.length < 200) {
        for (const link of result.links) {
          if (!data.links!.includes(link) && data.links!.length < 200) {
            data.links!.push(link);
          }
        }
      }

      // Images (cap at 100)
      if (result.images && data.images!.length < 100) {
        for (const image of result.images) {
          if (!data.images!.includes(image) && data.images!.length < 100) {
            data.images!.push(image);
          }
        }
      }

      if (!data.branding && result.branding) {
        data.branding = result.branding;
      }
    }

    // Extract headings from combined markdown
    if (data.mainContent) {
      const headingRegex = /^(#{1,6})\s+(.+)$/gm;
      data.headings = [];
      let match;
      while (
        (match = headingRegex.exec(data.mainContent)) !== null &&
        data.headings.length < 80
      ) {
        data.headings.push(match[2].trim());
      }
    }

    // Extract social links and contact info from combined HTML
    const allHtml = validResults
      .map((r) => r.html)
      .filter(Boolean)
      .join(' ');

    if (allHtml) {
      const socialRegex =
        /(?:https?:\/\/)?(?:www\.)?(facebook|twitter|x|linkedin|instagram|youtube|tiktok|snapchat|pinterest|reddit)\.com\/[^\s"']+/gi;
      const socialMatches = allHtml.match(socialRegex);
      if (socialMatches) {
        data.socialLinks = [...new Set(socialMatches)].slice(0, 15);
      }

      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const phoneRegex =
        /(\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4,}/g;
      const emails = allHtml.match(emailRegex);
      const phones = allHtml.match(phoneRegex);
      if (emails || phones) {
        data.contactInfo = {
          emails: emails ? [...new Set(emails)].slice(0, 10) : [],
          phones: phones ? [...new Set(phones)].slice(0, 10) : [],
          email: emails ? emails[0] : undefined,
          phone: phones ? phones[0] : undefined,
        };
      }
    }

    return data;
  }

  /**
   * Merge structured JSON data from each page into the aggregate businessData.
   * Accumulates products, services, technologies, AI/automation findings across pages.
   */
  private mergeBusinessData(target: NonNullable<ScrapedWebsiteData['businessData']>, source: any) {
    // Company info — prefer first non-empty
    if (source.companyInfo) {
      if (!target.companyInfo) {
        target.companyInfo = source.companyInfo;
      } else {
        for (const key of Object.keys(source.companyInfo)) {
          if (source.companyInfo[key] && !target.companyInfo[key as keyof typeof target.companyInfo]) {
            (target.companyInfo as any)[key] = source.companyInfo[key];
          }
        }
      }
    }

    // Accumulate arrays with dedup
    if (source.products?.length) {
      target.products = target.products || [];
      for (const p of source.products) {
        if (p.name && !target.products.some((e) => e.name === p.name)) {
          target.products.push(p);
        }
      }
    }
    if (source.services?.length) {
      target.services = target.services || [];
      for (const s of source.services) {
        if (s.name && !target.services.some((e) => e.name === s.name)) {
          target.services.push(s);
        }
      }
    }
    if (source.technologies?.length) {
      target.technologies = target.technologies || [];
      for (const t of source.technologies) {
        if (!target.technologies.includes(t)) {
          target.technologies.push(t);
        }
      }
    }
    if (source.challenges?.length) {
      target.challenges = target.challenges || [];
      for (const c of source.challenges) {
        if (!target.challenges.includes(c)) {
          target.challenges.push(c);
        }
      }
    }
    if (source.goals?.length) {
      target.goals = target.goals || [];
      for (const g of source.goals) {
        if (!target.goals.includes(g)) {
          target.goals.push(g);
        }
      }
    }
    if (!target.businessModel && source.businessModel) {
      target.businessModel = source.businessModel;
    }

    // Merge AI usage from Firecrawl's LLM extraction
    if (source.aiUsage?.detected) {
      target.aiDetected = true;
      target.aiMentions = target.aiMentions || [];
      for (const tool of source.aiUsage.tools || []) {
        if (!target.aiMentions.includes(tool)) {
          target.aiMentions.push(tool);
        }
      }
      for (const useCase of source.aiUsage.useCases || []) {
        if (!target.aiMentions.includes(useCase)) {
          target.aiMentions.push(useCase);
        }
      }
    }

    // Merge automation usage from Firecrawl's LLM extraction
    if (source.automationUsage?.detected) {
      target.automationDetected = true;
      target.automationMentions = target.automationMentions || [];
      for (const tool of source.automationUsage.tools || []) {
        if (!target.automationMentions.includes(tool)) {
          target.automationMentions.push(tool);
        }
      }
      for (const process of source.automationUsage.processes || []) {
        if (!target.automationMentions.includes(process)) {
          target.automationMentions.push(process);
        }
      }
    }
  }

  /**
   * Layer 2: Keyword scan on visible text to catch things the LLM missed.
   * Merges with Layer 1 (Firecrawl LLM extraction) — never overwrites.
   */
  private detectAiAndAutomation(
    data: ScrapedWebsiteData,
    validResults: any[],
  ) {
    const allHtml = validResults
      .map((r) => r.html)
      .filter(Boolean)
      .join(' ');

    if (!allHtml) return;

    // Strip to visible text only
    const visibleText = allHtml
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();

    const aiKeywords = [
      'artificial intelligence',
      'machine learning',
      'deep learning',
      'neural network',
      'natural language processing',
      'computer vision',
      'predictive analytics',
      'intelligent automation',
      'cognitive computing',
      'generative ai',
      'large language model',
      'ai ethics',
      'responsible ai',
      'ai governance',
      'data science',
      'ai strategy',
      'ai transformation',
      'intelligent process',
      'smart automation',
      'chatbot',
      'conversational ai',
      'sentiment analysis',
      'image recognition',
      'speech recognition',
      'recommendation system',
      'recommendation engine',
      'fraud detection',
      'predictive modeling',
      'ai-powered',
      'ai powered',
      'ml pipeline',
      'model training',
      'inference engine',
      'embeddings',
      'vector database',
      'rag',
      'retrieval augmented',
      'fine-tuning',
      'prompt engineering',
    ];

    const aiShortKeywords = [
      'llm',
      'gpt',
      'claude',
      'openai',
      'anthropic',
      'copilot',
      'gemini',
      'hugging face',
      'langchain',
      'tensorflow',
      'pytorch',
      'scikit-learn',
      'keras',
      'vertex ai',
      'sagemaker',
      'azure ai',
      'bedrock',
    ];

    const automationKeywords = [
      'robotic process automation',
      'business process automation',
      'workflow automation',
      'process automation',
      'marketing automation',
      'sales automation',
      'customer service automation',
      'supply chain automation',
      'manufacturing automation',
      'document automation',
      'approval workflow',
      'integration platform',
      'api automation',
      'webhook automation',
      'scheduling automation',
      'email automation',
      'task automation',
      'data pipeline',
      'continuous integration',
      'continuous deployment',
      'infrastructure as code',
      'configuration management',
      'cloud automation',
      'devops',
      'deployment automation',
      'test automation',
      'quality assurance automation',
      'release automation',
      'pipeline automation',
      'no-code',
      'low-code',
      'workflow orchestration',
      'event-driven',
      'serverless',
    ];

    const automationShortKeywords = [
      'rpa',
      'ci/cd',
      'ansible',
      'terraform',
      'kubernetes',
      'docker',
      'zapier',
      'make.com',
      'power automate',
      'uipath',
      'automation anywhere',
      'workato',
      'n8n',
      'airflow',
      'jenkins',
      'github actions',
      'gitlab ci',
      'argo',
      'pulumi',
    ];

    const aiMentions: string[] = [];
    const automationMentions: string[] = [];

    for (const keyword of aiKeywords) {
      if (visibleText.includes(keyword)) {
        aiMentions.push(keyword);
      }
    }
    for (const keyword of aiShortKeywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(visibleText)) {
        aiMentions.push(keyword);
      }
    }
    for (const keyword of automationKeywords) {
      if (visibleText.includes(keyword)) {
        automationMentions.push(keyword);
      }
    }
    for (const keyword of automationShortKeywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(visibleText)) {
        automationMentions.push(keyword);
      }
    }

    // Merge with Layer 1 (Firecrawl LLM extraction) — never overwrite
    if (!data.businessData) {
      data.businessData = {};
    }

    const existing = data.businessData;
    const mergedAi = [
      ...new Set([...(existing.aiMentions || []), ...aiMentions]),
    ].slice(0, 25);
    const mergedAutomation = [
      ...new Set([...(existing.automationMentions || []), ...automationMentions]),
    ].slice(0, 25);

    existing.aiDetected = existing.aiDetected || mergedAi.length > 0;
    existing.aiMentions = mergedAi.length > 0 ? mergedAi : undefined;
    existing.automationDetected =
      existing.automationDetected || mergedAutomation.length > 0;
    existing.automationMentions =
      mergedAutomation.length > 0 ? mergedAutomation : undefined;
  }
}
