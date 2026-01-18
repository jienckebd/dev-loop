/**
 * LangChain Model Factory
 *
 * Creates LangChain chat models based on provider configuration.
 * Replaces the legacy provider-specific implementations.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI, AzureChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Extract Azure instance name from endpoint URL.
 * E.g., "https://my-resource.openai.azure.com/" -> "my-resource"
 */
function extractAzureInstanceName(endpoint?: string): string {
  if (!endpoint) return '';
  const match = endpoint.match(/https?:\/\/([^.]+)\./);
  return match ? match[1] : '';
}

/**
 * Creates a LangChain chat model based on provider configuration.
 *
 * @param config - Model configuration
 * @returns A LangChain BaseChatModel instance
 */
export function createLangChainModel(config: ModelConfig): BaseChatModel {
  const { provider, model, apiKey, baseUrl, maxTokens, temperature } = config;

  switch (provider) {
    case 'anthropic':
      return new ChatAnthropic({
        anthropicApiKey: apiKey,
        model: model || 'claude-sonnet-4-20250514',
        maxTokens: maxTokens || 4096,
        streaming: true,  // Required for requests > 10 minutes
      }) as BaseChatModel;

    case 'openai':
      return new ChatOpenAI({
        openAIApiKey: apiKey,
        model: model || 'gpt-4o',
        maxTokens: maxTokens || 4096,
      }) as BaseChatModel;

    case 'azure':
      return new AzureChatOpenAI({
        azureOpenAIApiKey: apiKey || process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiInstanceName: extractAzureInstanceName(baseUrl || process.env.AZURE_OPENAI_ENDPOINT),
        azureOpenAIApiDeploymentName: model || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4',
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
        maxTokens: maxTokens || 4096,
      }) as BaseChatModel;

    case 'gemini':
      return new ChatGoogleGenerativeAI({
        apiKey: apiKey,
        model: model || 'gemini-1.5-pro',
        maxOutputTokens: maxTokens || 4096,
      }) as BaseChatModel;

    case 'ollama':
      return new ChatOllama({
        model: model || 'llama3.1',
        baseUrl: baseUrl || 'http://localhost:11434',
      }) as BaseChatModel;

    case 'cursor':
      // Cursor uses a special adapter - handled separately in provider.ts
      // Return anthropic as fallback for structured operations
      return new ChatAnthropic({
        anthropicApiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        model: 'claude-sonnet-4-20250514',
        maxTokens: maxTokens || 4096,
        streaming: true,  // Required for requests > 10 minutes
      }) as BaseChatModel;

    case 'amp':
      // Amp uses a special adapter - handled separately in factory.ts
      // Return anthropic as fallback for structured operations
      return new ChatAnthropic({
        anthropicApiKey: apiKey || process.env.ANTHROPIC_API_KEY,
        model: 'claude-sonnet-4-20250514',
        maxTokens: maxTokens || 4096,
        streaming: true,  // Required for requests > 10 minutes
      }) as BaseChatModel;

    default:
      throw new Error(`Unknown AI provider: ${provider}. Supported: anthropic, openai, azure, gemini, ollama, cursor, amp`);
  }
}

/**
 * Get the environment variable name for a provider's API key
 */
export function getApiKeyEnvVar(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'azure':
      return 'AZURE_OPENAI_API_KEY';
    case 'gemini':
      return 'GOOGLE_API_KEY';
    case 'ollama':
      return ''; // Ollama doesn't need an API key
    case 'cursor':
      return 'ANTHROPIC_API_KEY'; // Fallback uses Anthropic
    default:
      return '';
  }
}
