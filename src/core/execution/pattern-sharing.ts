/**
 * Pattern Sharing Manager
 *
 * Manages cross-PRD set pattern sharing with:
 * - Source tracking (which PRD discovered pattern)
 * - Relevance filtering (file path matching)
 * - Persistence to shared-patterns.json
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { Config } from '../../config/schema/core';
import { logger } from '../utils/logger';

export interface SharedPattern {
  name: string;
  guidance: string;
  occurrences: number;
  discoveredBy: string;  // PRD set ID
  relevantTo: string[];  // Glob patterns for relevant files
  tags: string[];
  lastSeen: string;
}

export interface SharedPatternsData {
  version: string;
  patterns: SharedPattern[];
  lastUpdated: string;
}

export interface PatternSharingConfig {
  sharedPatternsPath?: string;
  relevanceThreshold?: number;
  maxPatternsPerContext?: number;
}

/**
 * Pattern Sharing Manager
 *
 * Enables cross-PRD set pattern sharing with relevance-based filtering.
 * Patterns discovered in one PRD set can be surfaced to subsequent executions
 * based on file path matching and tag relevance.
 */
export class PatternSharingManager {
  private sharedPatternsPath: string;
  private relevanceThreshold: number;
  private maxPatternsPerContext: number;
  private debug: boolean;

  constructor(config: Config) {
    const patternConfig = (config as any).patternSharing as PatternSharingConfig || {};
    this.sharedPatternsPath = path.resolve(
      process.cwd(),
      patternConfig.sharedPatternsPath || '.devloop/shared-patterns.json'
    );
    this.relevanceThreshold = patternConfig.relevanceThreshold || 0.6;
    this.maxPatternsPerContext = patternConfig.maxPatternsPerContext || 10;
    this.debug = config.debug || false;
  }

  /**
   * Load all shared patterns
   */
  async loadPatterns(): Promise<SharedPatternsData> {
    try {
      if (await fs.pathExists(this.sharedPatternsPath)) {
        return await fs.readJson(this.sharedPatternsPath);
      }
    } catch (error) {
      logger.warn(`[PatternSharing] Failed to load patterns: ${error}`);
    }
    return {
      version: '1.0',
      patterns: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Save pattern to shared store
   */
  async savePattern(pattern: SharedPattern): Promise<void> {
    const data = await this.loadPatterns();

    // Update existing or add new
    const existingIdx = data.patterns.findIndex(p => p.name === pattern.name);
    if (existingIdx >= 0) {
      data.patterns[existingIdx] = {
        ...data.patterns[existingIdx],
        occurrences: data.patterns[existingIdx].occurrences + pattern.occurrences,
        lastSeen: pattern.lastSeen,
        // Merge relevantTo arrays
        relevantTo: [...new Set([...data.patterns[existingIdx].relevantTo, ...pattern.relevantTo])],
        // Merge tags
        tags: [...new Set([...data.patterns[existingIdx].tags, ...pattern.tags])],
      };
    } else {
      data.patterns.push(pattern);
    }

    data.lastUpdated = new Date().toISOString();

    await fs.ensureDir(path.dirname(this.sharedPatternsPath));
    await fs.writeJson(this.sharedPatternsPath, data, { spaces: 2 });

    if (this.debug) {
      logger.debug(`[PatternSharing] Saved pattern: ${pattern.name}`);
    }
  }

  /**
   * Save multiple patterns at once
   */
  async savePatterns(patterns: SharedPattern[]): Promise<void> {
    for (const pattern of patterns) {
      await this.savePattern(pattern);
    }

    logger.info(`[PatternSharing] Saved ${patterns.length} patterns`);
  }

  /**
   * Get relevant patterns for current context
   */
  async getRelevantPatterns(context: {
    prdSetId?: string;
    targetModule?: string;
    filePaths?: string[];
  }): Promise<SharedPattern[]> {
    const data = await this.loadPatterns();

    if (data.patterns.length === 0) {
      return [];
    }

    const scoredPatterns = data.patterns
      .map(pattern => ({
        pattern,
        score: this.calculateRelevance(pattern, context),
      }))
      .filter(({ score }) => score >= this.relevanceThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.maxPatternsPerContext);

    if (this.debug && scoredPatterns.length > 0) {
      logger.debug(`[PatternSharing] Found ${scoredPatterns.length} relevant patterns`);
    }

    return scoredPatterns.map(({ pattern }) => pattern);
  }

  /**
   * Calculate relevance score (0-1)
   */
  private calculateRelevance(
    pattern: SharedPattern,
    context: { prdSetId?: string; targetModule?: string; filePaths?: string[] }
  ): number {
    let score = 0;

    // Same PRD set = higher relevance
    if (context.prdSetId && pattern.discoveredBy === context.prdSetId) {
      score += 0.4;
    }

    // File path matching
    if (context.filePaths && context.filePaths.length > 0 && pattern.relevantTo.length > 0) {
      const matchCount = context.filePaths.filter(fp =>
        pattern.relevantTo.some(glob => this.matchGlob(fp, glob))
      ).length;
      score += Math.min(0.4, matchCount * 0.1);
    }

    // Target module overlap
    if (context.targetModule && pattern.relevantTo.some(r => r.includes(context.targetModule!))) {
      score += 0.2;
    }

    // High occurrence patterns are more likely to be relevant
    if (pattern.occurrences >= 3) {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  /**
   * Simple glob matching (converts * to regex)
   */
  private matchGlob(filePath: string, glob: string): boolean {
    try {
      // Escape special regex chars except *
      const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      // Convert * to .*
      const regex = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
      return regex.test(filePath);
    } catch {
      return false;
    }
  }

  /**
   * Extract tags from pattern guidance
   */
  extractTags(guidance: string): string[] {
    const tags: string[] = [];

    // Common Drupal/dev patterns
    if (guidance.toLowerCase().includes('entity')) tags.push('entity');
    if (guidance.toLowerCase().includes('plugin')) tags.push('plugin');
    if (guidance.toLowerCase().includes('service')) tags.push('service');
    if (guidance.toLowerCase().includes('schema')) tags.push('schema');
    if (guidance.toLowerCase().includes('config')) tags.push('config');
    if (guidance.toLowerCase().includes('hook')) tags.push('hook');
    if (guidance.toLowerCase().includes('form')) tags.push('form');
    if (guidance.toLowerCase().includes('controller')) tags.push('controller');
    if (guidance.toLowerCase().includes('test')) tags.push('test');
    if (guidance.toLowerCase().includes('api')) tags.push('api');
    if (guidance.toLowerCase().includes('cache')) tags.push('cache');
    if (guidance.toLowerCase().includes('queue')) tags.push('queue');
    if (guidance.toLowerCase().includes('event')) tags.push('event');

    return tags;
  }

  /**
   * Format patterns for handoff document
   */
  formatForHandoff(patterns: SharedPattern[]): string[] {
    return patterns.map(p =>
      `${p.name}: ${p.guidance} (from ${p.discoveredBy}, seen ${p.occurrences}x)`
    );
  }

  /**
   * Get pattern statistics
   */
  async getStatistics(): Promise<{
    totalPatterns: number;
    byPrdSet: Record<string, number>;
    byTag: Record<string, number>;
    topPatterns: Array<{ name: string; occurrences: number }>;
  }> {
    const data = await this.loadPatterns();

    const byPrdSet: Record<string, number> = {};
    const byTag: Record<string, number> = {};

    for (const pattern of data.patterns) {
      byPrdSet[pattern.discoveredBy] = (byPrdSet[pattern.discoveredBy] || 0) + 1;
      for (const tag of pattern.tags) {
        byTag[tag] = (byTag[tag] || 0) + 1;
      }
    }

    const topPatterns = [...data.patterns]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10)
      .map(p => ({ name: p.name, occurrences: p.occurrences }));

    return {
      totalPatterns: data.patterns.length,
      byPrdSet,
      byTag,
      topPatterns,
    };
  }

  /**
   * Clear all patterns (use with caution)
   */
  async clearPatterns(): Promise<void> {
    if (await fs.pathExists(this.sharedPatternsPath)) {
      await fs.remove(this.sharedPatternsPath);
      logger.info('[PatternSharing] Cleared all shared patterns');
    }
  }
}

/**
 * Create a pattern sharing manager with default configuration
 */
export function createPatternSharingManager(config: Config): PatternSharingManager {
  return new PatternSharingManager(config);
}
