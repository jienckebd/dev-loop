import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

export interface CodeItemMetadata {
  file: string;
  startLine: number;
  endLine: number;
  type: 'function' | 'class' | 'config' | 'block';
}

export interface EmbeddingCacheEntry {
  embedding: number[];
  metadata: CodeItemMetadata;
  timestamp: number;
}

export interface EmbeddingCache {
  version: string;
  provider: string;
  modelVersion: string;
  entries: {
    [fileHash: string]: EmbeddingCacheEntry;
  };
}

export class EmbeddingCacheManager {
  private cache: EmbeddingCache;
  private cachePath: string;
  private projectRoot: string;

  constructor(projectRoot: string, cachePath?: string) {
    this.projectRoot = projectRoot;
    this.cachePath = cachePath || path.join(projectRoot, '.devloop', 'embeddings.json');
    this.cache = {
      version: '1.0',
      provider: '',
      modelVersion: '',
      entries: {},
    };
  }

  /**
   * Load cache from disk
   */
  async load(): Promise<void> {
    try {
      if (await fs.pathExists(this.cachePath)) {
        const data = await fs.readJson(this.cachePath);
        this.cache = data;
      }
    } catch (error: any) {
      // If cache is corrupted, start fresh
      console.warn(`Failed to load embedding cache: ${error.message}`);
      this.cache = {
        version: '1.0',
        provider: '',
        modelVersion: '',
        entries: {},
      };
    }
  }

  /**
   * Save cache to disk
   */
  async save(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.cachePath));
      await fs.writeJson(this.cachePath, this.cache, { spaces: 2 });
    } catch (error: any) {
      throw new Error(`Failed to save embedding cache: ${error.message}`);
    }
  }

  /**
   * Get embedding from cache
   */
  get(fileHash: string): number[] | undefined {
    const entry = this.cache.entries[fileHash];
    return entry?.embedding;
  }

  /**
   * Set embedding in cache
   */
  set(
    fileHash: string,
    embedding: number[],
    metadata: CodeItemMetadata,
    provider: string,
    modelVersion: string
  ): void {
    // Update provider/model if changed
    if (this.cache.provider !== provider || this.cache.modelVersion !== modelVersion) {
      // If provider/model changed, we should invalidate, but for now just update
      this.cache.provider = provider;
      this.cache.modelVersion = modelVersion;
    }

    this.cache.entries[fileHash] = {
      embedding,
      metadata,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if cache is compatible with current provider/model
   */
  isCompatible(provider: string, modelVersion: string): boolean {
    if (!this.cache.provider || !this.cache.modelVersion) {
      return false;
    }
    return this.cache.provider === provider && this.cache.modelVersion === modelVersion;
  }

  /**
   * Get stale entries (files that no longer exist or have changed)
   */
  getStaleEntries(currentFiles: Map<string, string>): string[] {
    const stale: string[] = [];

    for (const [fileHash, entry] of Object.entries(this.cache.entries)) {
      const filePath = path.resolve(this.projectRoot, entry.metadata.file);

      // Check if file still exists
      if (!fs.existsSync(filePath)) {
        stale.push(fileHash);
        continue;
      }

      // Check if file content matches (by comparing hash)
      // For now, we'll use a simple approach: check if file was modified after cache timestamp
      try {
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs > entry.timestamp) {
          stale.push(fileHash);
        }
      } catch (error) {
        // File doesn't exist or can't be accessed
        stale.push(fileHash);
      }
    }

    return stale;
  }

  /**
   * Prune stale entries from cache
   */
  pruneStaleEntries(): number {
    const stale = this.getStaleEntries(new Map());
    let pruned = 0;

    for (const fileHash of stale) {
      delete this.cache.entries[fileHash];
      pruned++;
    }

    return pruned;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.entries = {};
  }

  /**
   * Get cache statistics
   */
  getStats(): { totalEntries: number; totalSize: number } {
    const totalEntries = Object.keys(this.cache.entries).length;
    // Rough estimate: each embedding is ~4KB (1024 floats * 4 bytes)
    const totalSize = totalEntries * 4 * 1024;
    return { totalEntries, totalSize };
  }

  /**
   * Generate hash for file content
   */
  static generateHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
}
