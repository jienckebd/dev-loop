import { AIProviderName } from '../../types';

/**
 * Model definitions for each AI provider
 */
export interface ModelOption {
  name: string;
  value: string;
}

export const PROVIDER_MODELS: Record<AIProviderName, ModelOption[]> = {
  anthropic: [
    { name: 'Claude Opus 4.5 (Latest, Best Quality)', value: 'claude-opus-4-20250514' },
    { name: 'Claude Sonnet 4 (Recommended)', value: 'claude-sonnet-4-20250514' },
    { name: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
    { name: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
    { name: 'Claude 3 Sonnet', value: 'claude-3-sonnet-20240229' },
    { name: 'Claude 3 Haiku (Fast, Cost-Effective)', value: 'claude-3-haiku-20240307' },
  ],
  openai: [
    { name: 'GPT-4o (Latest, Recommended)', value: 'gpt-4o' },
    { name: 'GPT-4o Mini (Fast, Cost-Effective)', value: 'gpt-4o-mini' },
    { name: 'GPT-4 Turbo', value: 'gpt-4-turbo-preview' },
    { name: 'GPT-4', value: 'gpt-4' },
    { name: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
  ],
  azure: [
    { name: 'GPT-4o (Use Your Deployment Name)', value: 'gpt-4o' },
    { name: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
    { name: 'GPT-4', value: 'gpt-4' },
    { name: 'GPT-3.5 Turbo', value: 'gpt-35-turbo' },
  ],
  gemini: [
    { name: 'Gemini 2.0 Flash (Latest, Fast)', value: 'gemini-2.0-flash' },
    { name: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' },
    { name: 'Gemini Pro', value: 'gemini-pro' },
    { name: 'Gemini Ultra', value: 'gemini-ultra' },
  ],
  ollama: [
    { name: 'Llama 2', value: 'llama2' },
    { name: 'Codellama', value: 'codellama' },
    { name: 'Mistral', value: 'mistral' },
    { name: 'Phi', value: 'phi' },
    { name: 'Neural Chat', value: 'neural-chat' },
    { name: 'StarCoder', value: 'starcoder' },
  ],
  cursor: [
    { name: 'Auto (Cursor Selects Best Model)', value: 'auto' },
    { name: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
    { name: 'Claude Opus 4.5', value: 'claude-opus-4-20250514' },
    { name: 'GPT-4o', value: 'gpt-4o' },
    { name: 'GPT-4 Turbo', value: 'gpt-4-turbo' },
    { name: 'GPT-4', value: 'gpt-4' },
  ],
  amp: [
    { name: 'Auto (Amp Selects Best Model)', value: 'auto' },
    { name: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
    { name: 'Claude Opus 4.5', value: 'claude-opus-4-20250514' },
    { name: 'GPT-4o', value: 'gpt-4o' },
  ],
};

/**
 * Model recommendations based on use case
 */
export interface ModelRecommendation {
  provider: AIProviderName;
  model: string;
  description?: string;
}

export const MODEL_RECOMMENDATIONS: Record<string, ModelRecommendation> = {
  best_quality: {
    provider: 'anthropic',
    model: 'claude-opus-4-20250514',
    description: 'Best quality for complex code generation',
  },
  balanced: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    description: 'Recommended balance of quality and speed',
  },
  fast: {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307',
    description: 'Fast responses, cost-effective',
  },
  cost_effective: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    description: 'Good quality at low cost',
  },
  latest: {
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    description: 'Latest model with fast inference',
  },
};

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: AIProviderName): string {
  const models = PROVIDER_MODELS[provider];
  if (models && models.length > 0) {
    // Return the recommended model (usually the second one) or first if not available
    const recommended = models.find(m => m.name.includes('Recommended'));
    return recommended?.value || models[0].value;
  }
  return '';
}

/**
 * Get model options for a provider
 */
export function getModelsForProvider(provider: AIProviderName): ModelOption[] {
  return PROVIDER_MODELS[provider] || [];
}

/**
 * Validate that a model belongs to a provider
 */
export function validateModelProvider(model: string, provider: AIProviderName): boolean {
  const models = PROVIDER_MODELS[provider];
  if (!models) return false;
  return models.some(m => m.value === model);
}

/**
 * Get provider name from model string (heuristic)
 */
export function detectProviderFromModel(model: string): AIProviderName | null {
  const modelLower = model.toLowerCase();

  if (modelLower.includes('claude')) return 'anthropic';
  if (modelLower.includes('gpt')) return 'openai';
  if (modelLower.includes('gemini')) return 'gemini';
  if (modelLower.includes('llama') || modelLower.includes('mistral') || modelLower.includes('codellama')) return 'ollama';
  if (modelLower === 'auto') return 'cursor';

  return null;
}
