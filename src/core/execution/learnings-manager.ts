/**
 * LearningsManager - Persists iteration learnings (Ralph pattern)
 *
 * Implements Ralph's progress.txt + AGENTS.md pattern for dev-loop:
 * - progress.md: Append-only log of all iterations
 * - learned-patterns.md: Patterns with 3+ occurrences (separate from CLAUDE.md)
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { Config } from '../../config/schema/core';
import { logger } from '../utils/logger';
import { PatternSharingManager, SharedPattern, createPatternSharingManager } from './pattern-sharing';

export interface IterationLearning {
  type: 'pattern' | 'gotcha' | 'convention';
  name: string;
  guidance: string;
  evidence?: string;
  occurrences?: number;
}

export interface Pattern {
  name: string;
  guidance: string;
  occurrences: number;
  lastSeen: string;
}

export interface IterationData {
  iteration: number;
  result: {
    taskId?: string;
    completed: boolean;
    error?: string;
    learnings?: string[];
    patterns?: Pattern[];
    filesModified?: string[];
  };
  duration: number;
}

export class LearningsManager {
  private progressPath: string;
  private patternsPath: string;
  private rulesPath: string;
  private patternCache: Map<string, Pattern> = new Map();
  private patternSharingManager: PatternSharingManager;
  private config: Config;

  // Only persist patterns that occur 3+ times
  private static readonly PATTERN_THRESHOLD = 3;

  constructor(config: Config) {
    this.config = config;
    const baseDir = process.cwd();
    this.progressPath = path.resolve(baseDir, '.devloop/progress.md');
    this.patternsPath = path.resolve(baseDir, '.devloop/learned-patterns.md');
    this.rulesPath = this.findRulesFile(baseDir);
    this.patternSharingManager = createPatternSharingManager(config);

    // Load existing patterns into cache
    this.loadPatternCache();
  }

  /**
   * Append iteration learnings to progress.md (Ralph's progress.txt)
   */
  async persistIteration(data: IterationData): Promise<void> {
    await fs.ensureDir(path.dirname(this.progressPath));

    const entry = this.formatIterationEntry(data);
    await fs.appendFile(this.progressPath, entry);

    logger.debug(`[LearningsManager] Persisted iteration ${data.iteration} to progress.md`);

    // Update pattern cache with new patterns
    if (data.result.patterns?.length) {
      await this.updatePatternCache(data.result.patterns);
    }
  }

  /**
   * Format iteration data as markdown entry
   */
  private formatIterationEntry(data: IterationData): string {
    const timestamp = new Date().toISOString();
    const status = data.result.completed ? 'Completed' : 'Failed';
    const durationSec = Math.round(data.duration / 1000);

    let entry = `
## Iteration ${data.iteration} - ${timestamp}

**Task**: ${data.result.taskId || 'N/A'}
**Status**: ${status}
**Duration**: ${durationSec}s
`;

    if (data.result.error) {
      entry += `**Error**: ${data.result.error}\n`;
    }

    entry += `
### Learnings
${data.result.learnings?.map(l => `- ${l}`).join('\n') || '- No specific learnings captured'}

### Patterns Discovered
${data.result.patterns?.map(p => `- **${p.name}**: ${p.guidance}`).join('\n') || '- None'}

### Files Modified
${data.result.filesModified?.map(f => `- ${f}`).join('\n') || '- None'}

---
`;

    return entry;
  }

  /**
   * Update pattern cache and persist patterns that meet threshold
   */
  private async updatePatternCache(patterns: Pattern[]): Promise<void> {
    const now = new Date().toISOString();

    for (const pattern of patterns) {
      const existing = this.patternCache.get(pattern.name);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeen = now;
        this.patternCache.set(pattern.name, existing);
      } else {
        this.patternCache.set(pattern.name, {
          name: pattern.name,
          guidance: pattern.guidance,
          occurrences: 1,
          lastSeen: now,
        });
      }
    }

    // Persist patterns that meet threshold to learned-patterns.md
    await this.persistLearnedPatterns();
  }

  /**
   * Persist patterns with 3+ occurrences to learned-patterns.md
   */
  private async persistLearnedPatterns(): Promise<void> {
    const qualifiedPatterns = Array.from(this.patternCache.values())
      .filter(p => p.occurrences >= LearningsManager.PATTERN_THRESHOLD)
      .sort((a, b) => b.occurrences - a.occurrences);

    if (qualifiedPatterns.length === 0) {
      return;
    }

    await fs.ensureDir(path.dirname(this.patternsPath));

    const content = `# Learned Patterns (Auto-Generated)

Patterns discovered during PRD execution with ${LearningsManager.PATTERN_THRESHOLD}+ occurrences.

Include in CLAUDE.md with: \`@.devloop/learned-patterns.md\`

---

${qualifiedPatterns.map(p => `## ${p.name}

${p.guidance}

- **Occurrences**: ${p.occurrences}
- **Last seen**: ${p.lastSeen}
`).join('\n')}
`;

    await fs.writeFile(this.patternsPath, content, 'utf-8');
    logger.info(`[LearningsManager] Updated learned-patterns.md with ${qualifiedPatterns.length} patterns`);
  }

  /**
   * Share qualified patterns for cross-PRD access
   */
  async shareQualifiedPatterns(prdSetId: string, targetModule?: string): Promise<void> {
    const qualifiedPatterns = this.getQualifiedPatterns();

    if (qualifiedPatterns.length === 0) {
      return;
    }

    const sharedPatterns: SharedPattern[] = qualifiedPatterns.map(pattern => ({
      name: pattern.name,
      guidance: pattern.guidance,
      occurrences: pattern.occurrences,
      discoveredBy: prdSetId,
      relevantTo: targetModule ? [`${targetModule}/*`] : [],
      tags: this.patternSharingManager.extractTags(pattern.guidance),
      lastSeen: pattern.lastSeen,
    }));

    await this.patternSharingManager.savePatterns(sharedPatterns);
    logger.info(`[LearningsManager] Shared ${sharedPatterns.length} patterns from ${prdSetId}`);
  }

  /**
   * Get relevant shared patterns for current context
   */
  async getSharedPatterns(context: {
    prdSetId?: string;
    targetModule?: string;
    filePaths?: string[];
  }): Promise<SharedPattern[]> {
    return this.patternSharingManager.getRelevantPatterns(context);
  }

  /**
   * Format shared patterns for handoff document
   */
  formatSharedPatternsForHandoff(patterns: SharedPattern[]): string[] {
    return this.patternSharingManager.formatForHandoff(patterns);
  }

  /**
   * Update rules file with discovered patterns (Ralph's AGENTS.md pattern)
   * Only called when patterns meet threshold
   */
  async updateRulesFile(patterns: Pattern[]): Promise<void> {
    // Filter to only patterns meeting threshold
    const qualifiedPatterns = patterns.filter(
      p => (this.patternCache.get(p.name)?.occurrences || 0) >= LearningsManager.PATTERN_THRESHOLD
    );

    if (qualifiedPatterns.length === 0) {
      return;
    }

    if (!await fs.pathExists(this.rulesPath)) {
      logger.warn(`[LearningsManager] Rules file not found: ${this.rulesPath}`);
      return;
    }

    let content = await fs.readFile(this.rulesPath, 'utf-8');
    const marker = '## Learned Patterns (Auto-Generated)';

    // Check if we should add patterns section
    const markerIndex = content.indexOf(marker);
    if (markerIndex === -1) {
      // Add reference to learned-patterns.md instead of inline patterns
      const reference = `
${marker}

See \`.devloop/learned-patterns.md\` for patterns discovered during PRD execution.
`;
      content += reference;
      await fs.writeFile(this.rulesPath, content, 'utf-8');
      logger.info(`[LearningsManager] Added learned patterns reference to ${this.rulesPath}`);
    }
  }

  /**
   * Load existing patterns from learned-patterns.md into cache
   */
  private async loadPatternCache(): Promise<void> {
    try {
      if (!await fs.pathExists(this.patternsPath)) {
        return;
      }

      const content = await fs.readFile(this.patternsPath, 'utf-8');

      // Parse patterns from markdown
      const patternBlocks = content.split(/^## /m).slice(1);
      for (const block of patternBlocks) {
        const lines = block.split('\n');
        const name = lines[0]?.trim();
        if (!name) continue;

        const guidance = lines.slice(1).find(l => l.trim() && !l.startsWith('-'))?.trim() || '';
        const occurrencesMatch = block.match(/\*\*Occurrences\*\*:\s*(\d+)/);
        const lastSeenMatch = block.match(/\*\*Last seen\*\*:\s*(\S+)/);

        if (name && guidance) {
          this.patternCache.set(name, {
            name,
            guidance,
            occurrences: occurrencesMatch ? parseInt(occurrencesMatch[1], 10) : 0,
            lastSeen: lastSeenMatch?.[1] || new Date().toISOString(),
          });
        }
      }

      logger.debug(`[LearningsManager] Loaded ${this.patternCache.size} patterns from cache`);
    } catch (error) {
      logger.warn(`[LearningsManager] Failed to load pattern cache: ${error}`);
    }
  }

  /**
   * Find rules file (CLAUDE.md or .cursorrules)
   */
  private findRulesFile(baseDir: string): string {
    const candidates = ['CLAUDE.md', '.cursorrules'];
    for (const file of candidates) {
      const filePath = path.resolve(baseDir, file);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    // Default to CLAUDE.md if neither exists
    return path.resolve(baseDir, 'CLAUDE.md');
  }

  /**
   * Get recent learnings from progress.md
   */
  async getRecentLearnings(count: number = 5): Promise<string[]> {
    try {
      if (!await fs.pathExists(this.progressPath)) {
        return [];
      }

      const content = await fs.readFile(this.progressPath, 'utf-8');
      const learningMatches = content.match(/### Learnings\n([\s\S]*?)(?=###|---)/g) || [];

      return learningMatches
        .slice(-count)
        .flatMap(m =>
          m.replace('### Learnings\n', '')
            .split('\n')
            .filter(l => l.startsWith('- ') && !l.includes('No specific learnings'))
            .map(l => l.substring(2))
        );
    } catch (error) {
      logger.warn(`[LearningsManager] Failed to get recent learnings: ${error}`);
      return [];
    }
  }

  /**
   * Get patterns that meet the persistence threshold
   */
  getQualifiedPatterns(): Pattern[] {
    return Array.from(this.patternCache.values())
      .filter(p => p.occurrences >= LearningsManager.PATTERN_THRESHOLD);
  }

  /**
   * Get all cached patterns regardless of threshold
   */
  getAllPatterns(): Pattern[] {
    return Array.from(this.patternCache.values());
  }
}
