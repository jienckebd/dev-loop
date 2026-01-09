import { AIProviderManager } from './provider-manager';
import { EmbeddingCacheManager, CodeItemMetadata } from './embedding-cache';
import { logger } from "../core/utils/logger";

export interface CodeItem {
  id: string;
  content: string;
  fileHash: string;
  metadata: {
    file: string;
    startLine: number;
    endLine: number;
    type: 'function' | 'class' | 'config' | 'block';
  };
}

export interface SimilarItem {
  item: CodeItem;
  similarity: number;
}

export class EmbeddingService {
  constructor(
    private providerManager: AIProviderManager,
    private cache: EmbeddingCacheManager
  ) {}

  /**
   * Get embedding for a single code block (with caching)
   */
  async getEmbedding(code: string, fileHash: string): Promise<number[]> {
    // Check cache first
    const cached = this.cache.get(fileHash);
    if (cached) {
      return cached;
    }

    // Generate embedding
    const provider = this.providerManager.selectOptimalProvider('embedding');
    const embedding = await provider.generateEmbedding(code);

    // Cache it (we'll need metadata, but for single embeddings we can skip it)
    // For now, we'll just store the embedding without full metadata
    // In practice, you'd want to pass metadata when calling this

    return embedding;
  }

  /**
   * Get embeddings for multiple code items (with caching and batching)
   */
  async getEmbeddings(items: CodeItem[]): Promise<Map<string, number[]>> {
    const results = new Map<string, number[]>();
    const itemsToProcess: CodeItem[] = [];

    // Check cache for each item
    for (const item of items) {
      const cached = this.cache.get(item.fileHash);
      if (cached) {
        results.set(item.id, cached);
      } else {
        itemsToProcess.push(item);
      }
    }

    if (itemsToProcess.length === 0) {
      return results;
    }

    // Process remaining items in batches
    const provider = this.providerManager.selectOptimalProvider('embedding');
    const batchSize = provider.capabilities.batchSize;

    for (let i = 0; i < itemsToProcess.length; i += batchSize) {
      const batch = itemsToProcess.slice(i, i + batchSize);
      await this.processBatch(batch, provider, results);
    }

    return results;
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * Find items similar to a given embedding
   */
  findSimilar(
    embedding: number[],
    allEmbeddings: Map<string, number[]>,
    threshold: number = 0.85
  ): SimilarItem[] {
    const similar: SimilarItem[] = [];

    for (const [id, otherEmbedding] of allEmbeddings.entries()) {
      const similarity = this.cosineSimilarity(embedding, otherEmbedding);
      if (similarity >= threshold) {
        // We'd need the CodeItem to create SimilarItem, but for now we'll just store the ID
        // In practice, you'd maintain a mapping from ID to CodeItem
        similar.push({
          item: {
            id,
            content: '',
            fileHash: '',
            metadata: {
              file: '',
              startLine: 0,
              endLine: 0,
              type: 'block',
            },
          },
          similarity,
        });
      }
    }

    // Sort by similarity descending
    similar.sort((a, b) => b.similarity - a.similarity);

    return similar;
  }

  /**
   * Process a batch of items
   */
  private async processBatch(
    items: CodeItem[],
    provider: any,
    results: Map<string, number[]>
  ): Promise<void> {
    try {
      const texts = items.map(item => item.content);
      const embeddings = await provider.generateEmbeddings(texts);

      // Store results and cache
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const embedding = embeddings[i];
        results.set(item.id, embedding);

        // Cache the embedding with metadata
        this.cache.set(
          item.fileHash,
          embedding,
          item.metadata,
          provider.name,
          provider.capabilities.embeddingDimensions.toString()
        );
      }
    } catch (error: any) {
      logger.error(`Error processing embedding batch: ${error.message}`);
      throw error;
    }
  }
}
