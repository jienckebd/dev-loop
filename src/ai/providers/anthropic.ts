import Anthropic from '@anthropic-ai/sdk';
import {
  AIPatternProvider,
  AICapabilities,
  ProviderUsage,
  AnalysisContext,
  AnalysisResult,
  AIDetectedPattern,
  AIRecommendation,
} from '../provider-interface';
import { logger } from '../../core/logger';

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  embeddingModel?: string;
  maxTokens?: number;
  temperature?: number;
}

export class AnthropicPatternProvider implements AIPatternProvider {
  readonly name = 'anthropic';
  private client: Anthropic;
  private usage: ProviderUsage = {
    tokensUsed: 0,
    requestsMade: 0,
    embeddingsGenerated: 0,
    estimatedCost: 0,
  };

  readonly capabilities: AICapabilities = {
    embeddings: true,
    analysis: true,
    maxTokens: 200000,
    embeddingDimensions: 1024, // Voyage embeddings
    batchSize: 10,
  };

  constructor(private config: AnthropicConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    // Note: Anthropic doesn't have native embeddings, but they partner with Voyage AI
    // For now, we'll use a workaround or note that embeddings need to be via Voyage API
    // This is a placeholder - actual implementation would use Voyage AI API
    throw new Error('Anthropic does not provide embeddings directly. Use Voyage AI API or OpenAI for embeddings.');
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Batch embeddings - would use Voyage AI API
    throw new Error('Anthropic does not provide embeddings directly. Use Voyage AI API or OpenAI for embeddings.');
  }

  async analyze(prompt: string, context?: AnalysisContext): Promise<AnalysisResult> {
    const model = this.config.model || 'claude-3-haiku-20240307';
    const systemPrompt = this.buildSystemPrompt(context);

    try {
      const response = await this.client.messages.create({
        model,
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature || 0.3,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Anthropic API');
      }

      // Track usage
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      this.usage.tokensUsed += inputTokens + outputTokens;
      this.usage.requestsMade += 1;
      this.usage.estimatedCost += this.estimateCost(inputTokens, outputTokens, model);

      // Parse response
      const result = this.parseAnalysisResponse(content.text);

      return result;
    } catch (error: any) {
      logger.error(`Anthropic API error: ${error.message}`);
      throw error;
    }
  }

  getUsage(): ProviderUsage {
    return { ...this.usage };
  }

  resetUsage(): void {
    this.usage = {
      tokensUsed: 0,
      requestsMade: 0,
      embeddingsGenerated: 0,
      estimatedCost: 0,
    };
  }

  private buildSystemPrompt(context?: AnalysisContext): string {
    let prompt = `You are an expert code analyzer specializing in detecting abstraction patterns and recommending improvements.

Your task is to analyze code patterns and suggest abstractions that reduce duplication and improve maintainability.

When analyzing patterns, consider:
- Functional similarity (what the code does)
- Structural similarity (how the code is organized)
- Framework-specific best practices
- Maintainability and testability benefits

Provide clear, actionable recommendations with examples.`;

    if (context?.framework) {
      prompt += `\n\nFramework: ${context.framework}`;
    }

    if (context?.codebaseConventions && context.codebaseConventions.length > 0) {
      prompt += `\n\nCodebase conventions:\n${context.codebaseConventions.map(c => `- ${c}`).join('\n')}`;
    }

    return prompt;
  }

  private parseAnalysisResponse(text: string): AnalysisResult {
    // Try to parse JSON from the response
    try {
      // Look for JSON in code blocks or at the end
      const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || text.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          patterns: parsed.patterns || [],
          recommendations: parsed.recommendations || [],
          confidence: parsed.confidence || 0.5,
          reasoning: parsed.reasoning || text,
        };
      }
    } catch (error) {
      // Fall through to text parsing
    }

    // Fallback: parse from structured text
    return {
      patterns: [],
      recommendations: [
        {
          type: 'abstraction',
          suggestion: text,
          reasoning: 'AI analysis',
          confidence: 0.7,
          estimatedImpact: 'medium',
        },
      ],
      confidence: 0.7,
      reasoning: text,
    };
  }

  private estimateCost(inputTokens: number, outputTokens: number, model: string): number {
    // Claude 3 Haiku pricing (as of 2024)
    const inputCostPer1k = 0.00025; // $0.25 per 1M tokens
    const outputCostPer1k = 0.00125; // $1.25 per 1M tokens

    return (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
  }
}
