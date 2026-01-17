/**
 * LangChain Embeddings Service
 *
 * Provides a unified interface for generating embeddings using LangChain.
 * Supports OpenAI and Ollama embedding models.
 */

import { Embeddings } from '@langchain/core/embeddings';
import { OpenAIEmbeddings } from '@langchain/openai';
import { OllamaEmbeddings } from '@langchain/ollama';

export interface LangChainEmbeddingsConfig {
  provider: 'openai' | 'ollama' | string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/**
 * LangChain-based embeddings service
 */
export class LangChainEmbeddings {
  private embeddings: Embeddings;

  constructor(config: LangChainEmbeddingsConfig) {
    switch (config.provider) {
      case 'openai':
        this.embeddings = new OpenAIEmbeddings({
          openAIApiKey: config.apiKey || process.env.OPENAI_API_KEY,
          model: config.model || 'text-embedding-3-small',
        });
        break;
      case 'ollama':
        this.embeddings = new OllamaEmbeddings({
          model: config.model || 'nomic-embed-text',
          baseUrl: config.baseUrl || 'http://localhost:11434',
        });
        break;
      default:
        throw new Error(`Unsupported embeddings provider: ${config.provider}`);
    }
  }

  /**
   * Generate embedding for a single text query
   */
  async embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  /**
   * Generate embeddings for multiple documents
   */
  async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}