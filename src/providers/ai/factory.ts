import { Config } from '../../config/schema';
import { AIProvider, AIProviderConfig } from './interface';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';

export class AIProviderFactory {
  static create(config: Config): AIProvider {
    const providerConfig: AIProviderConfig = {
      apiKey: config.ai.apiKey || process.env[this.getApiKeyEnvVar(config.ai.provider)] || '',
      model: config.ai.model,
      temperature: 0.7,
      maxTokens: 4000,
    };

    switch (config.ai.provider) {
      case 'anthropic':
        return new AnthropicProvider(providerConfig);
      case 'openai':
        return new OpenAIProvider(providerConfig);
      case 'gemini':
        return new GeminiProvider(providerConfig);
      case 'ollama':
        return new OllamaProvider(providerConfig);
      default:
        throw new Error(`Unknown AI provider: ${config.ai.provider}`);
    }
  }

  static createWithFallback(config: Config): AIProvider {
    try {
      return this.create(config);
    } catch (error) {
      if (config.ai.fallback) {
        const [provider, model] = config.ai.fallback.split(':');
        if (provider && model) {
          const fallbackConfig: Config = {
            ...config,
            ai: {
              ...config.ai,
              provider: provider as any,
              model: model,
            },
          };
          console.warn(`Primary provider failed, using fallback: ${provider}`);
          return this.create(fallbackConfig);
        }
      }
      throw error;
    }
  }

  private static getApiKeyEnvVar(provider: string): string {
    switch (provider) {
      case 'anthropic':
        return 'ANTHROPIC_API_KEY';
      case 'openai':
        return 'OPENAI_API_KEY';
      case 'gemini':
        return 'GOOGLE_AI_API_KEY';
      case 'ollama':
        return 'OLLAMA_API_KEY'; // Usually not needed for local
      default:
        return '';
    }
  }
}

