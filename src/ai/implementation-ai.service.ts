import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ArtifactType } from '@prisma/client';
import { IMPLEMENTATION_TOOLS } from './tools/implementation-tools';
import { ImplementationToolExecutor } from './tools/implementation-tool-executor';
import {
  IMPLEMENTATION_PLAN_SYSTEM_PROMPT,
  buildPlanPrompt,
  buildRefinePrompt,
  type PlanGenerationContext,
} from './prompts/implementation-plan.prompt';
import {
  buildArtifactPrompt,
  getArtifactTitle,
  type ArtifactGenerationContext,
} from './prompts/implementation-artifact.prompt';

export interface PlanResult {
  title: string;
  summary: string;
  steps: {
    stepNumber: number;
    title: string;
    description: string;
    estimatedDuration: string;
    dependencies: number[];
  }[];
  prerequisites: string[];
  risks: { risk: string; mitigation: string; severity: string }[];
  estimatedDuration: string;
  suggestedArtifacts: ArtifactType[];
}

export interface ArtifactResult {
  type: ArtifactType;
  title: string;
  content: string;
}

const MAX_AGENT_TURNS = 10;

@Injectable()
export class ImplementationAiService {
  private readonly logger = new Logger(ImplementationAiService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private configService: ConfigService,
    private toolExecutor: ImplementationToolExecutor,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ai.anthropicApiKey')!,
    });
    this.model = this.configService.get<string>('ai.anthropicModel')!;
  }

  async generatePlan(
    context: PlanGenerationContext,
    organizationId: string,
    existingHistory?: Anthropic.MessageParam[],
  ): Promise<{ plan: PlanResult; conversationHistory: Anthropic.MessageParam[] }> {
    const userPrompt = buildPlanPrompt(context);
    const messages: Anthropic.MessageParam[] = existingHistory
      ? [...existingHistory]
      : [{ role: 'user', content: userPrompt }];

    return this.runAgentLoop(messages, organizationId);
  }

  async refinePlan(
    userMessage: string,
    conversationHistory: Anthropic.MessageParam[],
    organizationId: string,
  ): Promise<{ plan: PlanResult; conversationHistory: Anthropic.MessageParam[] }> {
    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory,
      { role: 'user', content: buildRefinePrompt(userMessage) },
    ];

    return this.runAgentLoop(messages, organizationId);
  }

  async generateArtifact(
    type: ArtifactType,
    context: ArtifactGenerationContext,
  ): Promise<ArtifactResult> {
    const { system, user } = buildArtifactPrompt(type, context);

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 8192,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          throw new Error('No text content in artifact response');
        }

        return {
          type,
          title: getArtifactTitle(type),
          content: textBlock.text,
        };
      } catch (error) {
        this.logger.warn(
          `Artifact generation attempt ${attempt + 1} failed for ${type}: ${(error as Error).message}`,
        );
        if (attempt === 2) throw error;
      }
    }

    throw new Error(`Failed to generate ${type} artifact after retries`);
  }

  private async runAgentLoop(
    messages: Anthropic.MessageParam[],
    organizationId: string,
  ): Promise<{ plan: PlanResult; conversationHistory: Anthropic.MessageParam[] }> {
    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      this.logger.log(`Agent turn ${turn + 1}/${MAX_AGENT_TURNS}`);

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        system: IMPLEMENTATION_PLAN_SYSTEM_PROMPT,
        tools: IMPLEMENTATION_TOOLS,
        messages,
      });

      // Final answer — parse the plan JSON
      if (response.stop_reason === 'end_turn') {
        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          throw new Error('No text content in final response');
        }

        messages.push({ role: 'assistant', content: response.content });
        const plan = this.parsePlanResult(textBlock.text);

        return { plan, conversationHistory: messages };
      }

      // Tool calls — execute and continue
      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            this.logger.debug(`Tool call: ${block.name}`);
            const result = await this.toolExecutor.executeTool(
              block.name,
              block.input as Record<string, unknown>,
              organizationId,
            );
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      // Unexpected stop reason
      this.logger.warn(`Unexpected stop_reason: ${response.stop_reason}`);
      throw new Error(`Unexpected stop reason: ${response.stop_reason}`);
    }

    throw new Error('Agent exceeded maximum turns');
  }

  private parsePlanResult(text: string): PlanResult {
    const cleaned = text
      .replace(/```json?\s*\n?/gi, '')
      .replace(/```\s*/gi, '')
      .trim();

    const plan: PlanResult = JSON.parse(cleaned);

    if (
      !plan.title ||
      !Array.isArray(plan.steps) ||
      plan.steps.length === 0
    ) {
      throw new Error('Plan JSON missing required fields (title, steps)');
    }

    // Validate suggestedArtifacts against known types
    const validTypes = new Set([
      'IMPLEMENTATION_GUIDE',
      'CONFIGURATION_TEMPLATE',
      'INTEGRATION_CHECKLIST',
      'VENDOR_EVALUATION',
      'CODE_SNIPPET',
      'CUSTOM',
    ]);
    if (plan.suggestedArtifacts) {
      plan.suggestedArtifacts = plan.suggestedArtifacts.filter((a) =>
        validTypes.has(a),
      );
    }

    return plan;
  }
}
