/**
 * Text Generation Adapter
 *
 * Adapter for AI providers to support text generation for PRD building.
 * Wraps existing AIProvider interface to provide generate() method for text generation.
 * 
 * IMPORTANT: This adapter delegates exclusively to provider.generateText() to ensure
 * session management, token tracking, and metrics are properly handled by the provider.
 */

import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { logger } from '../../utils/logger';

/**
 * Text Generation Options
 */
export interface TextGenerationOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /**
   * Task type hint for model selection optimization.
   * Simple tasks can use faster models for better performance.
   */
  taskType?: 'schema-generation' | 'test-planning' | 'code-generation' | 'analysis' | 'general';
  /**
   * Override the default model for this call.
   * When set, uses this model instead of provider default.
   */
  model?: string;
}

/**
 * Adapter for text generation using AI providers
 * 
 * Delegates all text generation to the provider's generateText() method,
 * ensuring session management and token tracking work correctly.
 */
export class TextGenerationAdapter {
  private provider: AIProvider;
  private providerConfig: AIProviderConfig;
  private providerName: string;
  private debug: boolean;

  constructor(provider: AIProvider, providerConfig: AIProviderConfig, debug = false) {
    this.provider = provider;
    this.providerConfig = providerConfig;
    this.providerName = provider.name;
    this.debug = debug;

    // Validate that provider supports generateText
    if (!('generateText' in this.provider) || typeof this.provider.generateText !== 'function') {
      logger.warn(`[TextGenerationAdapter] Provider ${this.providerName} does not have generateText() method. Text generation may fail.`);
    }
  }

  /**
   * Select optimal model for task type
   * Simple tasks can use faster/cheaper models for better performance
   */
  private selectModelForTask(taskType?: TextGenerationOptions['taskType'], defaultModel?: string): string {
    // If a model is explicitly set in provider config, respect it
    if (defaultModel && defaultModel !== 'auto' && defaultModel !== 'Auto') {
      return defaultModel;
    }

    // Task-based model selection for optimization
    switch (taskType) {
      case 'schema-generation':
      case 'test-planning':
        // These are structured tasks that don't need heavy reasoning
        // Use faster models when available
        if (this.providerName === 'gemini') {
          return 'gemini-2.0-flash'; // Fast and capable
        }
        if (this.providerName === 'anthropic') {
          return 'claude-3-5-haiku-latest'; // Faster Claude
        }
        if (this.providerName === 'openai') {
          return 'gpt-4o-mini'; // Fast GPT-4
        }
        break;

      case 'code-generation':
      case 'analysis':
        // These need more reasoning capability
        if (this.providerName === 'anthropic') {
          return 'claude-sonnet-4-20250514'; // Best for code
        }
        break;
    }

    // Default to provider's configured model
    return defaultModel || this.providerConfig.model || 'auto';
  }

  /**
   * Generate text from prompt (text generation, not code generation)
   * 
   * Delegates to provider.generateText() to ensure proper session management,
   * token tracking, and metrics recording.
   */
  async generate(prompt: string, options: TextGenerationOptions = {}): Promise<string> {
    const startTime = Date.now();
    const maxTokens = options.maxTokens || this.providerConfig.maxTokens || 4000;
    const temperature = options.temperature ?? this.providerConfig.temperature ?? 0.7;
    const systemPrompt = options.systemPrompt || 'You are a helpful assistant that generates structured documents.';

    // Select optimal model based on task type
    const model = options.model || this.selectModelForTask(options.taskType, this.providerConfig.model);
    if (this.debug && model !== this.providerConfig.model) {
      logger.debug(`[TextGenerationAdapter] Using optimized model '${model}' for ${options.taskType || 'general'} task`);
    }

    try {
      // Validate provider supports generateText
      if (!('generateText' in this.provider) || typeof this.provider.generateText !== 'function') {
        throw new Error(
          `Provider '${this.providerName}' does not support generateText(). ` +
          `All providers must implement generateText() for PRD building. ` +
          `Check that the provider is correctly configured.`
        );
      }

      logger.debug(`[TextGenerationAdapter] Using provider.generateText() for ${this.providerName}`);
      const result = await this.provider.generateText(prompt, { maxTokens, temperature, systemPrompt, model });
      
      // Track metrics with token data if provider supports it
      const durationMs = Date.now() - startTime;
      if ('getLastTokens' in this.provider && typeof this.provider.getLastTokens === 'function') {
        const tokens = this.provider.getLastTokens();
        if (tokens && (tokens.input !== undefined || tokens.output !== undefined)) {
          try {
            const { getBuildMetrics } = require('../../metrics/build');
            getBuildMetrics().recordAICall(
              `${this.providerName}-generateText`,
              true,
              durationMs,
              tokens.input !== undefined && tokens.output !== undefined 
                ? { input: tokens.input, output: tokens.output }
                : undefined
            );
          } catch {
            // Build metrics not available
          }
        }
      }
      
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      // Record failed call in metrics
      try {
        const { getBuildMetrics } = require('../../metrics/build');
        getBuildMetrics().recordAICall(
          `${this.providerName}-generateText`,
          false,
          durationMs
        );
      } catch {
        // Build metrics not available
      }
      
      logger.error(`[TextGenerationAdapter] Text generation failed: ${error}`);
      throw error;
    }
  }

  /**
   * Get the provider name
   */
  getProviderName(): string {
    return this.providerName;
  }

  /**
   * Check if provider supports text generation
   */
  supportsTextGeneration(): boolean {
    return 'generateText' in this.provider && typeof this.provider.generateText === 'function';
  }
}
