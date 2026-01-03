import { EmbeddingService, CodeItem } from './embedding-service';

export interface ClusterOptions {
  similarityThreshold: number;
  minClusterSize: number;
}

export interface PatternCluster {
  id: string;
  centroid: number[];
  members: CodeItem[];
  similarity: number; // Average similarity within cluster
  suggestedName?: string;
}

export interface AbstractionCandidate {
  cluster: PatternCluster;
  confidence: number;
  suggestedAbstraction: 'utility' | 'service' | 'plugin' | 'config-schema' | 'base-class' | 'entity-type' | 'field';
  reasoning: string;
}

export class PatternClusterer {
  constructor(private embeddingService: EmbeddingService) {}

  /**
   * Cluster similar code blocks based on embeddings
   */
  async clusterPatterns(
    items: CodeItem[],
    options: ClusterOptions
  ): Promise<PatternCluster[]> {
    if (items.length === 0) {
      return [];
    }

    // Get embeddings for all items
    const embeddings = await this.embeddingService.getEmbeddings(items);
    const embeddingMap = new Map<string, number[]>();
    for (const [id, embedding] of embeddings.entries()) {
      embeddingMap.set(id, embedding);
    }

    // Build similarity matrix
    const clusters: PatternCluster[] = [];
    const processed = new Set<string>();

    for (const item of items) {
      if (processed.has(item.id)) {
        continue;
      }

      const embedding = embeddingMap.get(item.id);
      if (!embedding) {
        continue;
      }

      // Find similar items
      const similarItems: CodeItem[] = [item];
      const similarEmbeddings: number[][] = [embedding];

      for (const otherItem of items) {
        if (processed.has(otherItem.id) || otherItem.id === item.id) {
          continue;
        }

        const otherEmbedding = embeddingMap.get(otherItem.id);
        if (!otherEmbedding) {
          continue;
        }

        const similarity = this.embeddingService.cosineSimilarity(embedding, otherEmbedding);
        if (similarity >= options.similarityThreshold) {
          similarItems.push(otherItem);
          similarEmbeddings.push(otherEmbedding);
          processed.add(otherItem.id);
        }
      }

      // Only create cluster if it meets minimum size
      if (similarItems.length >= options.minClusterSize) {
        // Calculate centroid
        const centroid = this.calculateCentroid(similarEmbeddings);

        // Calculate average similarity
        const avgSimilarity = this.calculateAverageSimilarity(similarEmbeddings);

        clusters.push({
          id: `cluster-${clusters.length + 1}`,
          centroid,
          members: similarItems,
          similarity: avgSimilarity,
        });

        processed.add(item.id);
      }
    }

    return clusters;
  }

  /**
   * Find patterns that should be abstracted
   */
  async findAbstractionCandidates(
    clusters: PatternCluster[],
    minOccurrences: number
  ): Promise<AbstractionCandidate[]> {
    const candidates: AbstractionCandidate[] = [];

    for (const cluster of clusters) {
      if (cluster.members.length < minOccurrences) {
        continue;
      }

      // Determine abstraction type based on pattern characteristics
      const suggestedAbstraction = this.determineAbstractionType(cluster);
      const confidence = this.calculateConfidence(cluster);
      const reasoning = this.generateReasoning(cluster, suggestedAbstraction);

      candidates.push({
        cluster,
        confidence,
        suggestedAbstraction,
        reasoning,
      });
    }

    // Sort by confidence descending
    candidates.sort((a, b) => b.confidence - a.confidence);

    return candidates;
  }

  /**
   * Calculate centroid of embeddings
   */
  private calculateCentroid(embeddings: number[][]): number[] {
    if (embeddings.length === 0) {
      return [];
    }

    const dimension = embeddings[0].length;
    const centroid = new Array(dimension).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < dimension; i++) {
        centroid[i] += embedding[i];
      }
    }

    // Average
    for (let i = 0; i < dimension; i++) {
      centroid[i] /= embeddings.length;
    }

    return centroid;
  }

  /**
   * Calculate average similarity within cluster
   */
  private calculateAverageSimilarity(embeddings: number[][]): number {
    if (embeddings.length < 2) {
      return 1.0;
    }

    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        const similarity = this.embeddingService.cosineSimilarity(embeddings[i], embeddings[j]);
        totalSimilarity += similarity;
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  /**
   * Determine abstraction type based on cluster characteristics
   */
  private determineAbstractionType(cluster: PatternCluster): AbstractionCandidate['suggestedAbstraction'] {
    // Analyze cluster members to determine best abstraction
    const types = cluster.members.map(m => m.metadata.type);
    const files = cluster.members.map(m => m.metadata.file);

    // If all are functions, suggest utility
    if (types.every(t => t === 'function')) {
      return 'utility';
    }

    // If all are classes, suggest base-class
    if (types.every(t => t === 'class')) {
      return 'base-class';
    }

    // If config structures, suggest config-schema
    if (types.every(t => t === 'config')) {
      return 'config-schema';
    }

    // If spread across many files, suggest service
    const uniqueFiles = new Set(files);
    if (uniqueFiles.size > 3) {
      return 'service';
    }

    // Default to utility
    return 'utility';
  }

  /**
   * Calculate confidence score for abstraction candidate
   */
  private calculateConfidence(cluster: PatternCluster): number {
    // Base confidence from similarity
    let confidence = cluster.similarity;

    // Boost confidence for larger clusters
    const sizeBoost = Math.min(cluster.members.length / 10, 0.2);
    confidence += sizeBoost;

    // Boost confidence for consistent types
    const types = cluster.members.map(m => m.metadata.type);
    const typeConsistency = types.filter(t => t === types[0]).length / types.length;
    confidence += typeConsistency * 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Generate reasoning for abstraction recommendation
   */
  private generateReasoning(
    cluster: PatternCluster,
    abstractionType: AbstractionCandidate['suggestedAbstraction']
  ): string {
    const count = cluster.members.length;
    const files = new Set(cluster.members.map(m => m.metadata.file));
    const fileCount = files.size;

    return `Found ${count} similar patterns across ${fileCount} file(s) with ${(cluster.similarity * 100).toFixed(1)}% similarity. ` +
           `Recommended abstraction type: ${abstractionType}. ` +
           `This would reduce code duplication and improve maintainability.`;
  }
}
