import {
  AIPatternProvider,
  AICapabilities,
  ProviderUsage,
  AnalysisContext,
  AnalysisResult,
} from '../provider-interface';
import { logger } from '../../core/logger';

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
  maxTokens?: number;
  temperature?: number;
}

export class OllamaPatternProvider implements AIPatternProvider {
  readonly name = 'ollama';
  private baseUrl: string;
  private usage: ProviderUsage = {
    tokensUsed: 0,
    requestsMade: 0,
    embeddingsGenerated: 0,
    estimatedCost: 0, // Local models have no cost
  };

  readonly capabilities: AICapabilities = {
    embeddings: true,
    analysis: true,
    maxTokens: 32768, // Typical for local models
    embeddingDimensions: 768, // nomic-embed-text
    batchSize: 10,
  };

  constructor(private config: OllamaConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const model = this.config.embeddingModel || 'nomic-embed-text';
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: text,
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json() as { embedding: number[] };
      this.usage.embeddingsGenerated += 1;
      this.usage.requestsMade += 1;

      return data.embedding;
    } catch (error: any) {
      logger.error(`Ollama embedding error: ${error.message}`);
      throw error;
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Ollama doesn't support batch embeddings, so we'll do them sequentially
    // In production, you might want to parallelize with a limit
    const embeddings: number[][] = [];
    for (const text of texts) {
      embeddings.push(await this.generateEmbedding(text));
    }
    return embeddings;
  }

  async analyze(prompt: string, context?: AnalysisContext): Promise<AnalysisResult> {
    const model = this.config.model || 'codellama';
    const systemPrompt = this.buildSystemPrompt(context);

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: `${systemPrompt}\n\n${prompt}`,
          stream: false,
          options: {
            temperature: this.config.temperature || 0.3,
            num_predict: this.config.maxTokens || 4096,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json() as { response?: string; eval_count?: number; prompt_eval_count?: number };
      const content = data.response || '';

      // Track usage (approximate)
      this.usage.tokensUsed += (data.eval_count || 0) + (data.prompt_eval_count || 0);
      this.usage.requestsMade += 1;

      // Parse response
      const result = this.parseAnalysisResponse(content);

      return result;
    } catch (error: any) {
      logger.error(`Ollama analysis error: ${error.message}`);
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
}
