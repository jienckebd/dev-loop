import * as fs from 'fs-extra';
import * as path from 'path';
import { AbstractionPattern } from '../frameworks/interface';
import { CodeQualityScanner, ScanResult } from './code-quality-scanner';
import { EmbeddingService, CodeItem } from '../ai/embedding-service';
import { SemanticAnalyzer } from '../ai/semantic-analyzer';
import { PatternClusterer, AbstractionCandidate } from '../ai/pattern-clusterer';
import { EmbeddingCacheManager } from '../ai/embedding-cache';
import { logger } from './logger';

export interface DetectionOptions {
  projectRoot: string;
  paths?: string[];
  minOccurrences?: number;
  minSimilarity?: number;
  maxFileSize?: number;
  includeConfig?: boolean;
}

export interface AIDetectionOptions extends DetectionOptions {
  useAI?: boolean;
  useLLMAnalysis?: boolean;
  similarityThreshold?: number;
  maxTokensPerScan?: number;
  incrementalOnly?: boolean;
}

export class AbstractionDetector {
  private debug: boolean;

  constructor(
    private scanner: CodeQualityScanner,
    private embeddingService?: EmbeddingService,
    private semanticAnalyzer?: SemanticAnalyzer,
    private patternClusterer?: PatternClusterer,
    debug: boolean = false
  ) {
    this.debug = debug;
  }

  /**
   * Detect patterns using traditional methods (non-AI)
   */
  async detectPatterns(options: DetectionOptions): Promise<AbstractionPattern[]> {
    const patterns: AbstractionPattern[] = [];

    // 1. Use duplicate detection tools
    const duplicateResults = await this.getDuplicateDetectionResults(options);
    patterns.push(...await this.analyzeDuplicates(duplicateResults, options));

    // 2. Pattern-based detection
    patterns.push(...await this.detectStructuralPatterns(options));

    // 3. Config pattern detection
    if (options.includeConfig !== false) {
      patterns.push(...await this.detectConfigPatterns(options));
    }

    return this.deduplicatePatterns(patterns);
  }

  /**
   * Detect patterns using AI-enhanced methods
   */
  async detectPatternsWithAI(options: AIDetectionOptions): Promise<AbstractionPattern[]> {
    if (!this.embeddingService || !this.patternClusterer) {
      throw new Error('AI services not initialized. EmbeddingService and PatternClusterer required.');
    }

    // 1. Extract code items from source files
    const codeItems = await this.extractCodeItems(options.paths || [], options);

    if (codeItems.length === 0) {
      return [];
    }

    // 2. Generate/retrieve embeddings
    const embeddings = await this.embeddingService.getEmbeddings(codeItems);

    // 3. Cluster similar patterns
    const clusters = await this.patternClusterer.clusterPatterns(codeItems, {
      similarityThreshold: options.similarityThreshold ?? 0.85,
      minClusterSize: options.minOccurrences ?? 3,
    });

    // 4. Find abstraction candidates
    const candidates = await this.patternClusterer.findAbstractionCandidates(
      clusters,
      options.minOccurrences ?? 3
    );

    // 5. Analyze with LLM (if enabled)
    if (options.useLLMAnalysis && this.semanticAnalyzer) {
      return this.analyzeWithLLM(candidates, options);
    }

    // 6. Convert to AbstractionPattern format
    return this.convertToPatterns(candidates);
  }

  /**
   * Extract code blocks for analysis
   */
  private async extractCodeItems(
    paths: string[],
    options: DetectionOptions
  ): Promise<CodeItem[]> {
    const items: CodeItem[] = [];

    // If no paths specified, get all source files
    const files = paths.length > 0
      ? paths
      : await this.getSourceFiles(options);

    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const fileHash = EmbeddingCacheManager.generateHash(content);

        // Extract functions, classes, and code blocks
        const extracted = this.extractCodeBlocks(content, file);
        for (const block of extracted) {
          items.push({
            id: `${file}:${block.startLine}-${block.endLine}`,
            content: block.content,
            fileHash: EmbeddingCacheManager.generateHash(block.content),
            metadata: {
              file: path.relative(options.projectRoot, file),
              startLine: block.startLine,
              endLine: block.endLine,
              type: block.type,
            },
          });
        }
      } catch (error: any) {
        if (this.debug) {
          logger.warn(`Failed to extract code from ${file}: ${error.message}`);
        }
      }
    }

    return items;
  }

  /**
   * Extract code blocks from file content
   */
  private extractCodeBlocks(
    content: string,
    filePath: string
  ): Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> {
    const blocks: Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> = [];
    const lines = content.split('\n');

    // Simple extraction based on file extension
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.php') {
      // Extract PHP functions and classes
      blocks.push(...this.extractPHPBlocks(content, lines));
    } else if (ext === '.ts' || ext === '.js' || ext === '.tsx' || ext === '.jsx') {
      // Extract TypeScript/JavaScript functions and classes
      blocks.push(...this.extractJSBlocks(content, lines));
    } else if (ext === '.py') {
      // Extract Python functions and classes
      blocks.push(...this.extractPythonBlocks(content, lines));
    } else if (ext === '.yml' || ext === '.yaml') {
      // Extract YAML config structures
      blocks.push(...this.extractYAMLBlocks(content, lines));
    }

    return blocks;
  }

  private extractPHPBlocks(content: string, lines: string[]): Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> {
    const blocks: Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> = [];
    const classRegex = /^\s*(?:abstract\s+|final\s+)?class\s+(\w+)/;
    const functionRegex = /^\s*(?:public|private|protected)?\s*function\s+(\w+)/;

    let currentBlock: { startLine: number; type: 'function' | 'class' | 'config' | 'block'; braceCount: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (classRegex.test(line) && !currentBlock) {
        currentBlock = { startLine: i + 1, type: 'class', braceCount: 0 };
      } else if (functionRegex.test(line) && !currentBlock) {
        currentBlock = { startLine: i + 1, type: 'function', braceCount: 0 };
      }

      if (currentBlock) {
        currentBlock.braceCount += (line.match(/{/g) || []).length;
        currentBlock.braceCount -= (line.match(/}/g) || []).length;

        if (currentBlock.braceCount === 0 && line.includes('}')) {
          blocks.push({
            content: lines.slice(currentBlock.startLine - 1, i + 1).join('\n'),
            startLine: currentBlock.startLine,
            endLine: i + 1,
            type: currentBlock.type,
          });
          currentBlock = null;
        }
      }
    }

    return blocks;
  }

  private extractJSBlocks(content: string, lines: string[]): Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> {
    const blocks: Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> = [];
    const classRegex = /^\s*(?:export\s+)?(?:abstract\s+|default\s+)?class\s+(\w+)/;
    const functionRegex = /^\s*(?:export\s+)?(?:const|function|async\s+function)\s+(\w+)\s*[=:]?\s*(?:\(|=>)/;

    // Similar logic to PHP extraction
    // Simplified version - would need more robust parsing
    return blocks;
  }

  private extractPythonBlocks(content: string, lines: string[]): Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> {
    const blocks: Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> = [];
    const classRegex = /^\s*class\s+(\w+)/;
    const functionRegex = /^\s*def\s+(\w+)/;

    // Similar logic to PHP extraction
    return blocks;
  }

  private extractYAMLBlocks(content: string, lines: string[]): Array<{ content: string; startLine: number; endLine: number; type: 'function' | 'class' | 'config' | 'block' }> {
    // For YAML, treat the whole file as a block
    return [{
      content,
      startLine: 1,
      endLine: lines.length,
      type: 'config',
    }];
  }

  /**
   * Analyze candidates with LLM
   */
  private async analyzeWithLLM(
    candidates: AbstractionCandidate[],
    options: AIDetectionOptions
  ): Promise<AbstractionPattern[]> {
    if (!this.semanticAnalyzer) {
      throw new Error('SemanticAnalyzer not initialized');
    }

    const patterns: AbstractionPattern[] = [];

    // Analyze each candidate
    for (const candidate of candidates) {
      try {
        const analysis = await this.semanticAnalyzer.analyzePattern(candidate, {
          framework: await this.detectFramework(options.projectRoot) || undefined,
        });

        // Convert to AbstractionPattern
        patterns.push({
          id: candidate.cluster.id,
          type: this.determinePatternType(candidate.cluster),
          signature: this.generateSignature(candidate.cluster),
          files: candidate.cluster.members.map(m => m.metadata.file),
          locations: candidate.cluster.members.map(m => ({
            file: m.metadata.file,
            startLine: m.metadata.startLine,
            endLine: m.metadata.endLine,
          })),
          similarity: candidate.cluster.similarity,
          occurrences: candidate.cluster.members.length,
          suggestedAbstraction: candidate.suggestedAbstraction,
          suggestedName: analysis.abstractionStrategy.name,
          evidence: [candidate.reasoning, analysis.intent, analysis.commonality],
        });
      } catch (error: any) {
        if (this.debug) {
          logger.warn(`Failed to analyze candidate ${candidate.cluster.id}: ${error.message}`);
        }
      }
    }

    return patterns;
  }

  /**
   * Convert candidates to AbstractionPattern format
   */
  private convertToPatterns(candidates: AbstractionCandidate[]): AbstractionPattern[] {
    return candidates.map(candidate => ({
      id: candidate.cluster.id,
      type: this.determinePatternType(candidate.cluster),
      signature: this.generateSignature(candidate.cluster),
      files: candidate.cluster.members.map(m => m.metadata.file),
      locations: candidate.cluster.members.map(m => ({
        file: m.metadata.file,
        startLine: m.metadata.startLine,
        endLine: m.metadata.endLine,
      })),
      similarity: candidate.cluster.similarity,
      occurrences: candidate.cluster.members.length,
      suggestedAbstraction: candidate.suggestedAbstraction,
      suggestedName: candidate.cluster.suggestedName,
      evidence: [candidate.reasoning],
    }));
  }

  private determinePatternType(cluster: any): AbstractionPattern['type'] {
    const types = cluster.members.map((m: CodeItem) => m.metadata.type);
    if (types.every((t: string) => t === 'class')) return 'class-pattern';
    if (types.every((t: string) => t === 'function')) return 'function-pattern';
    if (types.every((t: string) => t === 'config')) return 'config-structure';
    return 'code-block';
  }

  private generateSignature(cluster: any): string {
    const firstMember = cluster.members[0];
    return `${firstMember.metadata.type}:${firstMember.metadata.file}:${firstMember.metadata.startLine}`;
  }

  // Traditional detection methods (simplified versions)

  private async getDuplicateDetectionResults(options: DetectionOptions): Promise<ScanResult[]> {
    // This would integrate with CodeQualityScanner
    // For now, return empty
    return [];
  }

  private async analyzeDuplicates(results: ScanResult[], options: DetectionOptions): Promise<AbstractionPattern[]> {
    // Implementation would analyze duplicate detection results
    return [];
  }

  private async detectStructuralPatterns(options: DetectionOptions): Promise<AbstractionPattern[]> {
    // Implementation would detect structural patterns
    return [];
  }

  private async detectConfigPatterns(options: DetectionOptions): Promise<AbstractionPattern[]> {
    // Implementation would detect config patterns
    return [];
  }

  private deduplicatePatterns(patterns: AbstractionPattern[]): AbstractionPattern[] {
    // Remove duplicate patterns
    const seen = new Set<string>();
    return patterns.filter(p => {
      const key = `${p.type}:${p.signature}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async getSourceFiles(options: DetectionOptions): Promise<string[]> {
    // Get source files from project
    const files: string[] = [];
    const root = options.projectRoot;

    async function walkDir(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip common exclude dirs
          if (!['node_modules', 'vendor', '.git', '.devloop'].includes(entry.name)) {
            await walkDir(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (['.php', '.ts', '.js', '.tsx', '.jsx', '.py'].includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    }

    await walkDir(root);
    return files;
  }

  private async detectFramework(projectRoot: string): Promise<'drupal' | 'django' | 'react' | 'browser-extension' | null> {
    if (await fs.pathExists(path.join(projectRoot, 'manage.py'))) return 'django';
    if (await fs.pathExists(path.join(projectRoot, 'vite.config.ts')) || await fs.pathExists(path.join(projectRoot, 'package.json'))) {
      const pkg = await fs.readJson(path.join(projectRoot, 'package.json')).catch(() => ({}));
      if (pkg.dependencies?.react || pkg.devDependencies?.react) return 'react';
    }
    if (await fs.pathExists(path.join(projectRoot, 'manifest.json'))) return 'browser-extension';
    if (await fs.pathExists(path.join(projectRoot, 'docroot', 'core'))) return 'drupal';
    return null;
  }
}
