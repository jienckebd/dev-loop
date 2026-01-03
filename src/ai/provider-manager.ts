import {
  AIPatternProvider,
  ProviderUsage,
  AICapabilities,
} from './provider-interface';
import { logger } from '../core/logger';

export interface UsageLimits {
  maxTokensPerScan?: number;
  maxRequestsPerScan?: number;
  maxCostPerScan?: number;
}

export class AIProviderManager {
  private providers: Map<string, AIPatternProvider> = new Map();
  private defaultProvider: string | null = null;
  private usageLimits: UsageLimits;

  constructor(usageLimits: UsageLimits = {}) {
    this.usageLimits = usageLimits;
  }

  /**
   * Register a new AI provider
   */
  registerProvider(provider: AIPatternProvider, setAsDefault = false): void {
    this.providers.set(provider.name, provider);
    if (setAsDefault || !this.defaultProvider) {
      this.defaultProvider = provider.name;
    }
    logger.debug(`Registered AI provider: ${provider.name}`);
  }

  /**
   * Get a provider by name, or the default provider
   */
  getProvider(name?: string): AIPatternProvider {
    if (name) {
      const provider = this.providers.get(name);
      if (!provider) {
        throw new Error(`AI provider '${name}' not found. Available: ${Array.from(this.providers.keys()).join(', ')}`);
      }
      return provider;
    }

    if (!this.defaultProvider) {
      throw new Error('No default AI provider set. Register a provider first.');
    }

    const provider = this.providers.get(this.defaultProvider);
    if (!provider) {
      throw new Error(`Default provider '${this.defaultProvider}' not found`);
    }

    return provider;
  }

  /**
   * Check if usage limits are exceeded
   */
  checkUsageLimits(): boolean {
    const usage = this.getAggregatedUsage();

    if (this.usageLimits.maxTokensPerScan && usage.tokensUsed > this.usageLimits.maxTokensPerScan) {
      logger.warn(`Token limit exceeded: ${usage.tokensUsed} > ${this.usageLimits.maxTokensPerScan}`);
      return false;
    }

    if (this.usageLimits.maxRequestsPerScan && usage.requestsMade > this.usageLimits.maxRequestsPerScan) {
      logger.warn(`Request limit exceeded: ${usage.requestsMade} > ${this.usageLimits.maxRequestsPerScan}`);
      return false;
    }

    if (this.usageLimits.maxCostPerScan && usage.estimatedCost > this.usageLimits.maxCostPerScan) {
      logger.warn(`Cost limit exceeded: $${usage.estimatedCost.toFixed(4)} > $${this.usageLimits.maxCostPerScan}`);
      return false;
    }

    return true;
}

  /**
   * Get aggregated usage across all providers
   */
  getAggregatedUsage(): ProviderUsage {
    const aggregated: ProviderUsage = {
      tokensUsed: 0,
      requestsMade: 0,
      embeddingsGenerated: 0,
      estimatedCost: 0,
    };

    for (const provider of this.providers.values()) {
      const usage = provider.getUsage();
      aggregated.tokensUsed += usage.tokensUsed;
      aggregated.requestsMade += usage.requestsMade;
      aggregated.embeddingsGenerated += usage.embeddingsGenerated;
      aggregated.estimatedCost += usage.estimatedCost;
    }

    return aggregated;
  }

  /**
   * Select optimal provider based on task type
   */
  selectOptimalProvider(task: 'embedding' | 'analysis'): AIPatternProvider {
    // For embeddings, prefer OpenAI (best support) or Ollama (local)
    if (task === 'embedding') {
      const openai = this.providers.get('openai');
      if (openai && openai.capabilities.embeddings) {
        return openai;
      }

      const ollama = this.providers.get('ollama');
      if (ollama && ollama.capabilities.embeddings) {
        return ollama;
      }
    }

    // For analysis, prefer Anthropic (best for code analysis) or OpenAI
    if (task === 'analysis') {
      const anthropic = this.providers.get('anthropic');
      if (anthropic && anthropic.capabilities.analysis) {
        return anthropic;
      }

      const openai = this.providers.get('openai');
      if (openai && openai.capabilities.analysis) {
        return openai;
      }

      const ollama = this.providers.get('ollama');
      if (ollama && ollama.capabilities.analysis) {
        return ollama;
      }
    }

    // Fallback to default provider
    return this.getProvider();
  }

  /**
   * Get all registered providers
   */
  getAllProviders(): AIPatternProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Reset usage for all providers
   */
  resetAllUsage(): void {
    for (const provider of this.providers.values()) {
      provider.resetUsage();
    }
  }

  /**
   * Set default provider
   */
  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider '${name}' not registered`);
    }
    this.defaultProvider = name;
  }
}
