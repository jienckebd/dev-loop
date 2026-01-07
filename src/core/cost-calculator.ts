/**
 * Cost Calculator
 *
 * Calculates cost estimates based on provider and token usage.
 */

export type ProviderName = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'cursor' | 'other';

export interface ProviderPricing {
  input: number;  // Price per million input tokens
  output: number; // Price per million output tokens
}

export interface CostCalculation {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/**
 * Provider pricing per million tokens (as of 2025)
 * Prices are in USD per million tokens
 */
const PRICING: Record<ProviderName, Record<string, ProviderPricing>> = {
  'anthropic': {
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
    'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
    'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
    'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  },
  'openai': {
    'gpt-4o': { input: 2.50, output: 10.00 },
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4': { input: 30.00, output: 60.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  },
  'gemini': {
    'gemini-pro': { input: 0.50, output: 1.50 },
    'gemini-ultra': { input: 5.00, output: 15.00 },
  },
  'ollama': {
    'llama2': { input: 0, output: 0 }, // Local, no cost
    'mistral': { input: 0, output: 0 },
    'codellama': { input: 0, output: 0 },
  },
  'cursor': {
    'auto': { input: 0, output: 0 }, // Cursor provider doesn't charge per token
  },
  'other': {
    'default': { input: 0, output: 0 }, // Unknown provider, assume no cost
  },
};

export class CostCalculator {
  /**
   * Calculate cost for a single run
   */
  static calculateCost(
    provider: ProviderName,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): CostCalculation {
    // Get pricing for provider and model
    const providerPricing = PRICING[provider] || PRICING.other;
    const pricing = providerPricing[model] || providerPricing.default || { input: 0, output: 0 };

    // Calculate costs (pricing is per million tokens)
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const totalCost = inputCost + outputCost;

    return {
      provider,
      model,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      totalCost,
    };
  }

  /**
   * Calculate total cost from multiple runs
   */
  static calculateTotalCost(calculations: CostCalculation[]): number {
    return calculations.reduce((sum, calc) => sum + calc.totalCost, 0);
  }

  /**
   * Get provider name from config or model string
   */
  static detectProvider(model: string, configProvider?: string): ProviderName {
    if (configProvider) {
      const normalized = configProvider.toLowerCase();
      if (normalized.includes('anthropic') || normalized.includes('claude')) {
        return 'anthropic';
      }
      if (normalized.includes('openai') || normalized.includes('gpt')) {
        return 'openai';
      }
      if (normalized.includes('gemini')) {
        return 'gemini';
      }
      if (normalized.includes('ollama')) {
        return 'ollama';
      }
      if (normalized.includes('cursor')) {
        return 'cursor';
      }
    }

    // Try to detect from model name
    const modelLower = model.toLowerCase();
    if (modelLower.includes('claude')) {
      return 'anthropic';
    }
    if (modelLower.includes('gpt')) {
      return 'openai';
    }
    if (modelLower.includes('gemini')) {
      return 'gemini';
    }
    if (modelLower.includes('llama') || modelLower.includes('mistral') || modelLower.includes('codellama')) {
      return 'ollama';
    }
    if (modelLower.includes('cursor') || modelLower === 'auto') {
      return 'cursor';
    }

    return 'other';
  }

  /**
   * Format cost as currency string
   */
  static formatCost(cost: number): string {
    if (cost === 0) {
      return '$0.00';
    }
    if (cost < 0.01) {
      return `$${cost.toFixed(4)}`;
    }
    return `$${cost.toFixed(2)}`;
  }

  /**
   * Get pricing information for a provider/model
   */
  static getPricing(provider: ProviderName, model: string): ProviderPricing | null {
    const providerPricing = PRICING[provider];
    if (!providerPricing) {
      return null;
    }
    return providerPricing[model] || providerPricing.default || null;
  }
}




