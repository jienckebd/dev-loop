import { AbstractionPattern } from '../frameworks/interface';

/**
 * AI Provider Interface for Pattern Detection
 *
 * This interface is separate from the code generation AI providers
 * and focuses on embeddings and pattern analysis.
 */
export interface AIPatternProvider {
  readonly name: string;
  readonly capabilities: AICapabilities;

  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  analyze(prompt: string, context?: AnalysisContext): Promise<AnalysisResult>;

  // Cost tracking
  getUsage(): ProviderUsage;
  resetUsage(): void;
}

export interface AICapabilities {
  embeddings: boolean;
  analysis: boolean;
  maxTokens: number;
  embeddingDimensions: number;
  batchSize: number;
}

export interface ProviderUsage {
  tokensUsed: number;
  requestsMade: number;
  embeddingsGenerated: number;
  estimatedCost: number;
}

export interface AnalysisContext {
  framework?: string;
  language?: string;
  existingPatterns?: AbstractionPattern[];
  codebaseConventions?: string[];
}

export interface AnalysisResult {
  patterns: AIDetectedPattern[];
  recommendations: AIRecommendation[];
  confidence: number;
  reasoning?: string;
}

export interface AIDetectedPattern {
  id: string;
  description: string;
  confidence: number;
  locations: Array<{ file: string; startLine: number; endLine: number }>;
}

export interface AIRecommendation {
  type: 'abstraction' | 'refactor' | 'optimization';
  suggestion: string;
  reasoning: string;
  confidence: number;
  estimatedImpact: 'low' | 'medium' | 'high';
}
