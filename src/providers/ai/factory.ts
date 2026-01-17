import { Config } from '../../config/schema/core';
import { AIProvider } from './interface';
import { LangChainProvider } from './langchain/provider';
import { CursorProvider } from './cursor';
import { AmpProvider } from './amp';

export class AIProviderFactory {
  static create(config: Config): AIProvider {
    // For cursor provider, use the original CursorProvider directly
    // as it has specialized handling for Cursor CLI
    if (config.ai.provider === 'cursor') {
      return new CursorProvider({
        apiKey: config.ai.apiKey || '',
        model: config.ai.model || 'auto',
        temperature: 0.7,
        maxTokens: config.ai.maxTokens || 4000,
        cursorRulesPath: config.rules?.cursorRulesPath,
        frameworkConfig: (config as any).framework,
        sessionManagement: (config.ai as any).sessionManagement,
      });
    }

    // For amp provider, use AmpProvider directly
    // as it has specialized handling for Amp CLI
    if (config.ai.provider === 'amp') {
      return new AmpProvider({
        apiKey: '', // Amp uses its own authentication
        model: config.ai.model || 'auto',
        temperature: 0.7,
        maxTokens: config.ai.maxTokens || 4000,
        cursorRulesPath: config.rules?.cursorRulesPath,
        frameworkConfig: (config as any).framework,
      });
    }

    // For all other providers, use LangChainProvider
    return new LangChainProvider({
      provider: config.ai.provider,
      model: config.ai.model,
      apiKey: config.ai.apiKey || process.env[this.getApiKeyEnvVar(config.ai.provider)] || '',
      maxTokens: config.ai.maxTokens || 4000,
      temperature: 0.7,
      cursorRulesPath: config.rules?.cursorRulesPath,
      frameworkConfig: (config as any).framework,
      sessionManagement: (config.ai as any).sessionManagement,
      debug: config.debug,
    });
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
