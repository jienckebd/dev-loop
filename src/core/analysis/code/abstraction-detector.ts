import * as fs from 'fs-extra';
import * as path from 'path';
import { AbstractionPattern } from '../../../frameworks/interface';
import { CodeQualityScanner, ScanResult } from './quality-scanner';
import { logger } from '../../utils/logger';

export interface DetectionOptions {
  projectRoot: string;
  paths?: string[];
  minOccurrences?: number;
  minSimilarity?: number;
  maxFileSize?: number;
  includeConfig?: boolean;
}

export class AbstractionDetector {
  private debug: boolean;

  constructor(
    private scanner: CodeQualityScanner,
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
