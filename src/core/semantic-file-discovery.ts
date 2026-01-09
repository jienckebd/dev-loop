/**
 * Semantic File Discovery - Find relevant files using embedding-based semantic search
 *
 * Replaces regex-based file path extraction with intelligent semantic matching:
 * - Uses embeddings to find semantically similar code
 * - Considers file relationships and dependencies
 * - Learns from past context decisions
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { ASTParser, SymbolInfo } from './ast-parser';

// Simplified embedding interface for semantic discovery
export interface EmbeddingProvider {
  getEmbedding(text: string, fileHash?: string): Promise<number[]>;
}

export interface FileRelevance {
  filePath: string;
  score: number;
  reasons: string[];
  symbols?: string[];
}

export interface DiscoveryQuery {
  /** Natural language description of what we're looking for */
  query: string;
  /** Specific file paths to start from */
  seedFiles?: string[];
  /** File patterns to include */
  includePatterns?: string[];
  /** File patterns to exclude */
  excludePatterns?: string[];
  /** Maximum number of results */
  maxResults?: number;
  /** Minimum relevance score (0-1) */
  minScore?: number;
  /** Include related files (imports, exports) */
  includeRelated?: boolean;
}

export interface SemanticFileDiscoveryConfig {
  /** Root directory to search */
  projectRoot: string;
  /** Directories to include in search */
  searchDirs?: string[];
  /** Directories to exclude */
  excludeDirs?: string[];
  /** File extensions to include */
  extensions?: string[];
  /** Cache embeddings */
  cacheEmbeddings?: boolean;
  /** Cache path */
  cachePath?: string;
}

interface FileEmbedding {
  filePath: string;
  embedding: number[];
  symbols: string[];
  imports: string[];
  exports: string[];
  lastModified: number;
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.php', '.py', '.yml', '.yaml'];
const DEFAULT_EXCLUDE_DIRS = ['node_modules', 'vendor', '.git', 'dist', 'build', 'coverage'];

/**
 * Semantic File Discovery using embeddings and AST analysis
 */
export class SemanticFileDiscovery {
  private config: SemanticFileDiscoveryConfig;
  private embeddingProvider: EmbeddingProvider | null;
  private astParser: ASTParser;
  private embeddings: Map<string, FileEmbedding> = new Map();
  private initialized: boolean = false;
  private debug: boolean;

  constructor(
    config: SemanticFileDiscoveryConfig,
    embeddingProvider?: EmbeddingProvider | null,
    astParser?: ASTParser,
    debug: boolean = false
  ) {
    this.config = config;
    this.embeddingProvider = embeddingProvider || null;
    this.astParser = astParser || new ASTParser({}, debug);
    this.debug = debug;
  }

  /**
   * Initialize by indexing files (lazy initialization)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load cached embeddings if available
    if (this.config.cacheEmbeddings && this.config.cachePath) {
      await this.loadCache();
    }

    this.initialized = true;
  }

  /**
   * Discover relevant files based on a semantic query
   */
  async discoverFiles(query: DiscoveryQuery): Promise<FileRelevance[]> {
    await this.initialize();

    const results: FileRelevance[] = [];
    const maxResults = query.maxResults || 20;
    const minScore = query.minScore || 0.3;

    // Get all candidate files
    const candidateFiles = await this.getCandidateFiles(query);

    // If we have seed files, start from them
    if (query.seedFiles && query.seedFiles.length > 0) {
      // Add seed files with high relevance
      for (const seedFile of query.seedFiles) {
        if (await fs.pathExists(seedFile)) {
          results.push({
            filePath: seedFile,
            score: 1.0,
            reasons: ['Seed file'],
          });
        }
      }

      // If includeRelated, find related files
      if (query.includeRelated) {
        const relatedFiles = await this.findRelatedFiles(query.seedFiles);
        for (const related of relatedFiles) {
          if (!results.find(r => r.filePath === related.filePath)) {
            results.push(related);
          }
        }
      }
    }

    // Get query embedding
    let queryEmbedding: number[] | null = null;
    if (this.embeddingProvider) {
      try {
        queryEmbedding = await this.embeddingProvider.getEmbedding(query.query);
      } catch (error) {
        if (this.debug) {
          console.warn(`[SemanticFileDiscovery] Failed to get query embedding: ${error instanceof Error ? error.message : String(error)}`);
        }
        // Fall back to keyword matching
        return this.keywordMatch(query, candidateFiles, maxResults);
      }
    } else {
      // No embedding provider, use keyword matching
      return this.keywordMatch(query, candidateFiles, maxResults);
    }

    // Score each file by semantic similarity
    for (const filePath of candidateFiles) {
      // Skip if already in results
      if (results.find(r => r.filePath === filePath)) continue;

      try {
        const fileEmbedding = await this.getFileEmbedding(filePath);
        if (!fileEmbedding) continue;

        const similarity = this.cosineSimilarity(queryEmbedding, fileEmbedding.embedding);

        if (similarity >= minScore) {
          results.push({
            filePath,
            score: similarity,
            reasons: ['Semantic similarity'],
            symbols: fileEmbedding.symbols.slice(0, 10),
          });
        }
      } catch (error) {
        if (this.debug) {
          console.warn(`[SemanticFileDiscovery] Failed to process ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Sort by score and limit results
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  /**
   * Find files related to the given files (via imports/exports)
   */
  async findRelatedFiles(filePaths: string[]): Promise<FileRelevance[]> {
    const related: FileRelevance[] = [];
    const processedPaths = new Set<string>();

    for (const filePath of filePaths) {
      if (processedPaths.has(filePath)) continue;
      processedPaths.add(filePath);

      try {
        const ast = await this.astParser.parse(filePath);

        // Resolve imports to file paths
        for (const imp of ast.imports) {
          const resolvedPath = await this.resolveImport(imp.source, filePath);
          if (resolvedPath && !processedPaths.has(resolvedPath)) {
            related.push({
              filePath: resolvedPath,
              score: 0.8,
              reasons: [`Imported by ${path.basename(filePath)}`],
            });
          }
        }
      } catch (error) {
        if (this.debug) {
          console.warn(`[SemanticFileDiscovery] Failed to find related for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return related;
  }

  /**
   * Find files that export a specific symbol
   */
  async findFilesBySymbol(symbolName: string, symbolType?: SymbolInfo['type']): Promise<FileRelevance[]> {
    const results: FileRelevance[] = [];
    const files = await this.getAllIndexedFiles();

    for (const filePath of files) {
      try {
        const ast = await this.astParser.parse(filePath);

        for (const exp of ast.exports) {
          if (exp.name === symbolName && (!symbolType || exp.type === symbolType)) {
            results.push({
              filePath,
              score: 1.0,
              reasons: [`Exports ${symbolType || 'symbol'} ${symbolName}`],
              symbols: [symbolName],
            });
            break;
          }
        }

        for (const sym of ast.symbols) {
          if (sym.name === symbolName && (!symbolType || sym.type === symbolType)) {
            const existing = results.find(r => r.filePath === filePath);
            if (!existing) {
              results.push({
                filePath,
                score: 0.9,
                reasons: [`Contains ${sym.type} ${symbolName}`],
                symbols: [symbolName],
              });
            }
          }
        }
      } catch (error) {
        // Ignore individual file errors
      }
    }

    return results;
  }

  /**
   * Find files that contain patterns matching the query
   */
  async findFilesByPattern(patterns: string[]): Promise<FileRelevance[]> {
    const results: FileRelevance[] = [];
    const files = await this.getAllIndexedFiles();

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const matchedPatterns: string[] = [];

        for (const pattern of patterns) {
          const regex = new RegExp(pattern, 'i');
          if (regex.test(content)) {
            matchedPatterns.push(pattern);
          }
        }

        if (matchedPatterns.length > 0) {
          results.push({
            filePath,
            score: matchedPatterns.length / patterns.length,
            reasons: matchedPatterns.map(p => `Matches pattern: ${p}`),
          });
        }
      } catch (error) {
        // Ignore individual file errors
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Update index for changed files
   */
  async updateIndex(changedFiles: string[]): Promise<void> {
    for (const filePath of changedFiles) {
      if (await fs.pathExists(filePath)) {
        // Re-index the file
        this.embeddings.delete(filePath);
        await this.getFileEmbedding(filePath);
      } else {
        // File deleted, remove from index
        this.embeddings.delete(filePath);
      }
    }

    // Save cache
    if (this.config.cacheEmbeddings && this.config.cachePath) {
      await this.saveCache();
    }
  }

  // Private helper methods

  private async getCandidateFiles(query: DiscoveryQuery): Promise<string[]> {
    const files: string[] = [];
    const searchDirs = this.config.searchDirs || [this.config.projectRoot];
    const excludeDirs = [...(this.config.excludeDirs || DEFAULT_EXCLUDE_DIRS), ...(query.excludePatterns || [])];
    const extensions = this.config.extensions || DEFAULT_EXTENSIONS;

    for (const dir of searchDirs) {
      const fullDir = path.isAbsolute(dir) ? dir : path.join(this.config.projectRoot, dir);
      await this.walkDirectory(fullDir, files, excludeDirs, extensions, query.includePatterns);
    }

    return files;
  }

  private async walkDirectory(
    dir: string,
    files: string[],
    excludeDirs: string[],
    extensions: string[],
    includePatterns?: string[]
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name) && !entry.name.startsWith('.')) {
            await this.walkDirectory(fullPath, files, excludeDirs, extensions, includePatterns);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            // Check include patterns if specified
            if (includePatterns && includePatterns.length > 0) {
              const matches = includePatterns.some(pattern => {
                const regex = new RegExp(pattern);
                return regex.test(fullPath);
              });
              if (!matches) continue;
            }
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore permission errors
    }
  }

  private async getAllIndexedFiles(): Promise<string[]> {
    return this.getCandidateFiles({ query: '' });
  }

  private async getFileEmbedding(filePath: string): Promise<FileEmbedding | null> {
    // Check cache
    const cached = this.embeddings.get(filePath);
    if (cached) {
      const stats = await fs.stat(filePath);
      if (stats.mtimeMs <= cached.lastModified) {
        return cached;
      }
    }

    try {
      // Parse file
      const ast = await this.astParser.parse(filePath);

      // Create text representation for embedding
      const textParts: string[] = [];

      // Add file path components
      const pathParts = filePath.split(path.sep);
      textParts.push(...pathParts.slice(-3)); // Last 3 path components

      // Add symbol names
      for (const symbol of ast.symbols) {
        textParts.push(`${symbol.type} ${symbol.name}`);
        if (symbol.docComment) {
          textParts.push(symbol.docComment.slice(0, 200));
        }
      }

      // Add export names
      for (const exp of ast.exports) {
        textParts.push(`exports ${exp.name}`);
      }

      const text = textParts.join(' ');

      if (!this.embeddingProvider) {
        return null;
      }

      // Get embedding
      const embedding = await this.embeddingProvider.getEmbedding(text);

      const stats = await fs.stat(filePath);
      const fileEmbedding: FileEmbedding = {
        filePath,
        embedding,
        symbols: ast.symbols.map(s => s.name),
        imports: ast.imports.map(i => i.source),
        exports: ast.exports.map(e => e.name),
        lastModified: stats.mtimeMs,
      };

      this.embeddings.set(filePath, fileEmbedding);
      return fileEmbedding;
    } catch (error) {
      if (this.debug) {
        console.warn(`[SemanticFileDiscovery] Failed to get embedding for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    }
  }

  private async resolveImport(importSource: string, fromFile: string): Promise<string | null> {
    const dir = path.dirname(fromFile);

    // Handle relative imports
    if (importSource.startsWith('.')) {
      const extensions = ['.ts', '.tsx', '.js', '.jsx', '.php', '.py', ''];

      for (const ext of extensions) {
        const candidate = path.join(dir, importSource + ext);
        if (await fs.pathExists(candidate)) {
          return candidate;
        }

        // Try index file
        const indexCandidate = path.join(dir, importSource, 'index' + ext);
        if (await fs.pathExists(indexCandidate)) {
          return indexCandidate;
        }
      }
    }

    // Handle PHP namespaces
    if (importSource.includes('\\')) {
      // Convert namespace to path (simplified)
      const namePath = importSource.replace(/\\/g, '/');
      const candidates = [
        path.join(this.config.projectRoot, 'docroot/modules', namePath + '.php'),
        path.join(this.config.projectRoot, 'src', namePath + '.php'),
      ];

      for (const candidate of candidates) {
        if (await fs.pathExists(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  private async keywordMatch(
    query: DiscoveryQuery,
    files: string[],
    maxResults: number
  ): Promise<FileRelevance[]> {
    const results: FileRelevance[] = [];
    const keywords = query.query.toLowerCase().split(/\s+/).filter(k => k.length > 2);

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const contentLower = content.toLowerCase();
        const fileNameLower = path.basename(filePath).toLowerCase();

        let matchCount = 0;
        const matchedKeywords: string[] = [];

        for (const keyword of keywords) {
          if (contentLower.includes(keyword) || fileNameLower.includes(keyword)) {
            matchCount++;
            matchedKeywords.push(keyword);
          }
        }

        if (matchCount > 0) {
          results.push({
            filePath,
            score: matchCount / keywords.length,
            reasons: [`Matches keywords: ${matchedKeywords.join(', ')}`],
          });
        }
      } catch (error) {
        // Ignore individual file errors
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  private async loadCache(): Promise<void> {
    const cachePath = this.config.cachePath!;
    try {
      if (await fs.pathExists(cachePath)) {
        const data = await fs.readJson(cachePath);
        if (data && typeof data === 'object') {
          for (const [key, value] of Object.entries(data)) {
            this.embeddings.set(key, value as FileEmbedding);
          }
        }
        if (this.debug) {
          console.log(`[SemanticFileDiscovery] Loaded ${this.embeddings.size} embeddings from cache`);
        }
      }
    } catch (error) {
      if (this.debug) {
        console.warn(`[SemanticFileDiscovery] Failed to load cache: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async saveCache(): Promise<void> {
    const cachePath = this.config.cachePath!;
    try {
      await fs.ensureDir(path.dirname(cachePath));
      const data: Record<string, FileEmbedding> = {};
      for (const [key, value] of this.embeddings) {
        data[key] = value;
      }
      await fs.writeJson(cachePath, data);
      if (this.debug) {
        console.log(`[SemanticFileDiscovery] Saved ${this.embeddings.size} embeddings to cache`);
      }
    } catch (error) {
      if (this.debug) {
        console.warn(`[SemanticFileDiscovery] Failed to save cache: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

