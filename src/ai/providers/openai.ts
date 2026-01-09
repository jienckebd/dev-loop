import OpenAI from 'openai';
import {
  AIPatternProvider,
  AICapabilities,
  ProviderUsage,
  AnalysisContext,
  AnalysisResult,
} from '../provider-interface';
import { logger } from "../../core/utils/logger";

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
  embeddingModel?: string;
  maxTokens?: number;
  temperature?: number;
}

export class OpenAIPatternProvider implements AIPatternProvider {
  readonly name = 'openai';
  private client: OpenAI;
  private usage: ProviderUsage = {
    tokensUsed: 0,
    requestsMade: 0,
    embeddingsGenerated: 0,
    estimatedCost: 0,
  };

  readonly capabilities: AICapabilities = {
    embeddings: true,
    analysis: true,
    maxTokens: 128000,
    embeddingDimensions: 1536, // text-embedding-3-small
    batchSize: 100, // OpenAI supports larger batches
  };

  constructor(private config: OpenAIConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = this.config.embeddingModel || 'text-embedding-3-small';
      const response = await this.client.embeddings.create({
        model,
        input: text,
      });

      this.usage.embeddingsGenerated += 1;
      this.usage.requestsMade += 1;
      this.usage.tokensUsed += response.usage.total_tokens;
      this.usage.estimatedCost += this.estimateEmbeddingCost(response.usage.total_tokens, model);

      return response.data[0].embedding;
    } catch (error: any) {
      logger.error(`OpenAI embedding error: ${error.message}`);
      throw error;
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const model = this.config.embeddingModel || 'text-embedding-3-small';
      const response = await this.client.embeddings.create({
        model,
        input: texts,
      });

      this.usage.embeddingsGenerated += texts.length;
      this.usage.requestsMade += 1;
      this.usage.tokensUsed += response.usage.total_tokens;
      this.usage.estimatedCost += this.estimateEmbeddingCost(response.usage.total_tokens, model);

      return response.data.map(item => item.embedding);
    } catch (error: any) {
      logger.error(`OpenAI batch embedding error: ${error.message}`);
      throw error;
    }
  }

  async analyze(prompt: string, context?: AnalysisContext): Promise<AnalysisResult> {
    const model = this.config.model || 'gpt-4o-mini';
    const systemPrompt = this.buildSystemPrompt(context);

    try {
      const response = await this.client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature || 0.3,
        response_format: { type: 'json_object' }, // Request JSON response
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      // Track usage
      const inputTokens = response.usage?.prompt_tokens || 0;
      const outputTokens = response.usage?.completion_tokens || 0;
      this.usage.tokensUsed += inputTokens + outputTokens;
      this.usage.requestsMade += 1;
      this.usage.estimatedCost += this.estimateAnalysisCost(inputTokens, outputTokens, model);

      // Parse JSON response
      const parsed = JSON.parse(content);
      return {
        patterns: parsed.patterns || [],
        recommendations: parsed.recommendations || [],
        confidence: parsed.confidence || 0.5,
        reasoning: parsed.reasoning || content,
      };
    } catch (error: any) {
      logger.error(`OpenAI analysis error: ${error.message}`);
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

Respond in JSON format with this structure:
{
  "patterns": [
    {
      "id": "pattern-id",
      "description": "Description of the pattern",
      "confidence": 0.0-1.0,
      "locations": [{"file": "path", "startLine": 1, "endLine": 10}]
    }
  ],
  "recommendations": [
    {
      "type": "abstraction" | "refactor" | "optimization",
      "suggestion": "What to do",
      "reasoning": "Why this helps",
      "confidence": 0.0-1.0,
      "estimatedImpact": "low" | "medium" | "high"
    }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "Overall analysis reasoning"
}`;

    if (context?.framework) {
      prompt += `\n\nFramework: ${context.framework}`;
    }

    if (context?.codebaseConventions && context.codebaseConventions.length > 0) {
      prompt += `\n\nCodebase conventions:\n${context.codebaseConventions.map(c => `- ${c}`).join('\n')}`;
    }

    return prompt;
  }

  private estimateEmbeddingCost(tokens: number, model: string): number {
    // text-embedding-3-small pricing (as of 2024)
    const costPer1k = 0.00002; // $0.02 per 1M tokens
    return (tokens / 1000) * costPer1k;
  }

  private estimateAnalysisCost(inputTokens: number, outputTokens: number, model: string): number {
    // gpt-4o-mini pricing (as of 2024)
    const inputCostPer1k = 0.00015; // $0.15 per 1M tokens
    const outputCostPer1k = 0.0006; // $0.60 per 1M tokens

    return (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
  }
}
