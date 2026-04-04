import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { buildQuestionGenerationPrompt } from './prompts/question-generation.prompt';

export interface GeneratedQuestion {
  questionText: string;
  questionType: 'TEXT' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'SCALE';
  options: string[] | null;
  challengeAreaTags: string[];
  rationale: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(private configService: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ai.anthropicApiKey')!,
    });
    this.model = this.configService.get<string>('ai.anthropicModel')!;
  }

  async generateIndustryQuestions(
    industryName: string,
    challengeAreas: string[],
  ): Promise<GeneratedQuestion[]> {
    const { system, user } = buildQuestionGenerationPrompt(
      industryName,
      challengeAreas,
    );

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.model,
          max_tokens: 4096,
          system,
          messages: [{ role: 'user', content: user }],
        });

        const text =
          response.content[0].type === 'text' ? response.content[0].text : '';
        const questions: GeneratedQuestion[] = JSON.parse(text);

        if (!Array.isArray(questions) || questions.length < 5) {
          throw new Error(`Expected array of 5+ questions, got ${questions.length}`);
        }

        return questions;
      } catch (error) {
        this.logger.warn(
          `AI question generation attempt ${attempt + 1} failed: ${error.message}`,
        );
        if (attempt === 1) throw error;
      }
    }

    throw new Error('Failed to generate questions after retries');
  }

  getModel(): string {
    return this.model;
  }
}
