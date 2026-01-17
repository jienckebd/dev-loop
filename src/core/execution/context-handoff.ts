/**
 * ContextHandoff - Manages context threshold and handoff (Ralph pattern)
 *
 * Implements Ralph's auto-handoff pattern for dev-loop:
 * - Generate handoff document for next iteration
 * - Estimate context usage from parallel metrics
 * - Trigger handoff when threshold reached OR every N iterations (fallback)
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { Config } from '../../config/schema/core';
import { logger } from '../utils/logger';
import { getParallelMetricsTracker } from '../metrics/parallel';
import { emitEvent } from '../utils/event-stream';
import { TaskMasterBridge } from './task-bridge';

export interface HandoffContext {
  timestamp: string;
  iteration: number;
  completedTasks: string[];
  pendingTasks: string[];
  blockedTasks: string[];
  currentTask?: string;
  recentLearnings: string[];
  recentPatterns: string[];
  filesModified: string[];
  contextUsagePercent: number;
}

export interface HandoffConfig {
  /** Context usage threshold (0-100) to trigger handoff */
  threshold: number;
  /** Iteration interval for forced handoff (fallback) */
  iterationInterval: number;
  /** Estimated context window size in tokens */
  contextWindowSize: number;
}

const DEFAULT_CONFIG: HandoffConfig = {
  threshold: 90,
  iterationInterval: 5, // Trigger handoff every 5 iterations as fallback
  contextWindowSize: 100000, // 100k tokens typical
};

export class ContextHandoff {
  private handoffPath: string;
  private progressPath: string;
  private config: HandoffConfig;
  private taskBridge: TaskMasterBridge;
  private currentIteration: number = 0;
  private filesModifiedThisSession: Set<string> = new Set();

  constructor(
    baseConfig: Config,
    handoffConfig: Partial<HandoffConfig> = {}
  ) {
    const baseDir = process.cwd();
    this.handoffPath = path.resolve(baseDir, '.devloop/handoff.md');
    this.progressPath = path.resolve(baseDir, '.devloop/progress.md');
    this.config = { ...DEFAULT_CONFIG, ...handoffConfig };
    this.taskBridge = new TaskMasterBridge(baseConfig);
  }

  /**
   * Generate handoff document for next iteration
   * This captures current state so fresh context can resume
   */
  async generateHandoff(iteration?: number): Promise<HandoffContext> {
    if (iteration !== undefined) {
      this.currentIteration = iteration;
    }

    const allTasks = await this.taskBridge.getAllTasks();
    const contextUsage = await this.getContextUsage();

    const handoff: HandoffContext = {
      timestamp: new Date().toISOString(),
      iteration: this.currentIteration,
      completedTasks: allTasks.filter(t => t.status === 'done').map(t => String(t.id)),
      pendingTasks: allTasks.filter(t => t.status === 'pending').map(t => String(t.id)),
      blockedTasks: allTasks.filter(t => t.status === 'blocked').map(t => String(t.id)),
      currentTask: undefined, // Set by caller if known
      recentLearnings: await this.getRecentLearnings(),
      recentPatterns: await this.getRecentPatterns(),
      filesModified: Array.from(this.filesModifiedThisSession),
      contextUsagePercent: contextUsage,
    };

    // Write handoff document
    await this.writeHandoffDocument(handoff);

    logger.debug(`[ContextHandoff] Generated handoff for iteration ${this.currentIteration}`);

    return handoff;
  }

  /**
   * Check if handoff should be triggered
   * Uses both context threshold AND iteration-based fallback
   */
  async shouldTriggerHandoff(): Promise<boolean> {
    // Iteration-based fallback: trigger every N iterations
    if (this.currentIteration > 0 && this.currentIteration % this.config.iterationInterval === 0) {
      logger.debug(`[ContextHandoff] Iteration-based handoff triggered at iteration ${this.currentIteration}`);
      return true;
    }

    // Context threshold check
    const contextUsage = await this.getContextUsage();
    if (contextUsage > this.config.threshold) {
      logger.debug(`[ContextHandoff] Context threshold handoff triggered: ${contextUsage}% > ${this.config.threshold}%`);
      return true;
    }

    return false;
  }

  /**
   * Estimate context usage percentage
   * Based on token tracking from parallel metrics
   */
  async getContextUsage(): Promise<number> {
    try {
      const parallelMetrics = getParallelMetricsTracker();
      const execution = parallelMetrics.getCurrentExecution();

      if (!execution) {
        return 0;
      }

      const totalTokens = execution.tokens.totalInput + execution.tokens.totalOutput;
      return Math.min(100, (totalTokens / this.config.contextWindowSize) * 100);
    } catch (error) {
      logger.warn(`[ContextHandoff] Failed to get context usage: ${error}`);
      return 0;
    }
  }

  /**
   * Trigger context handoff - emit event for handlers
   */
  async triggerHandoff(): Promise<void> {
    const contextUsage = await this.getContextUsage();

    logger.info(`[ContextHandoff] Triggering handoff at iteration ${this.currentIteration}, context: ${contextUsage.toFixed(1)}%`);

    emitEvent('context:handoff_triggered', {
      iteration: this.currentIteration,
      threshold: this.config.threshold,
      contextUsagePercent: contextUsage,
      timestamp: new Date().toISOString(),
    });

    // Reset session tracking
    this.filesModifiedThisSession.clear();
  }

  /**
   * Record a file modification in this session
   */
  recordFileModified(filePath: string): void {
    this.filesModifiedThisSession.add(filePath);
  }

  /**
   * Set current iteration number
   */
  setIteration(iteration: number): void {
    this.currentIteration = iteration;
  }

  /**
   * Write handoff document to .devloop/handoff.md
   */
  private async writeHandoffDocument(handoff: HandoffContext): Promise<void> {
    await fs.ensureDir(path.dirname(this.handoffPath));

    const content = `# Handoff Context

Generated: ${handoff.timestamp}
Iteration: ${handoff.iteration}
Context Usage: ${handoff.contextUsagePercent.toFixed(1)}%

## Task Status

### Completed (${handoff.completedTasks.length})
${handoff.completedTasks.map(t => `- ${t}`).join('\n') || '- None'}

### Pending (${handoff.pendingTasks.length})
${handoff.pendingTasks.map(t => `- ${t}`).join('\n') || '- None'}

### Blocked (${handoff.blockedTasks.length})
${handoff.blockedTasks.map(t => `- ${t}`).join('\n') || '- None'}

${handoff.currentTask ? `### Current Task\n${handoff.currentTask}\n` : ''}

## Recent Learnings
${handoff.recentLearnings.map(l => `- ${l}`).join('\n') || '- None captured'}

## Recent Patterns
${handoff.recentPatterns.map(p => `- ${p}`).join('\n') || '- None discovered'}

## Files Modified This Session
${handoff.filesModified.map(f => `- ${f}`).join('\n') || '- None'}

---

*This file is auto-generated by ContextHandoff for fresh context iteration.*
`;

    await fs.writeFile(this.handoffPath, content, 'utf-8');
    logger.debug(`[ContextHandoff] Wrote handoff document to ${this.handoffPath}`);
  }

  /**
   * Read last N learnings from progress.md
   */
  private async getRecentLearnings(count: number = 5): Promise<string[]> {
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
            .map(l => l.substring(2).trim())
        )
        .slice(-count);
    } catch (error) {
      logger.warn(`[ContextHandoff] Failed to get recent learnings: ${error}`);
      return [];
    }
  }

  /**
   * Read last N patterns from progress.md
   */
  private async getRecentPatterns(count: number = 5): Promise<string[]> {
    try {
      if (!await fs.pathExists(this.progressPath)) {
        return [];
      }

      const content = await fs.readFile(this.progressPath, 'utf-8');
      const patternMatches = content.match(/### Patterns Discovered\n([\s\S]*?)(?=###|---)/g) || [];

      return patternMatches
        .slice(-count)
        .flatMap(m =>
          m.replace('### Patterns Discovered\n', '')
            .split('\n')
            .filter(l => l.startsWith('- ') && !l.includes('None'))
            .map(l => l.substring(2).trim())
        )
        .slice(-count);
    } catch (error) {
      logger.warn(`[ContextHandoff] Failed to get recent patterns: ${error}`);
      return [];
    }
  }

  /**
   * Load handoff context from file (for resuming)
   */
  async loadHandoffContext(): Promise<HandoffContext | null> {
    try {
      if (!await fs.pathExists(this.handoffPath)) {
        return null;
      }

      const content = await fs.readFile(this.handoffPath, 'utf-8');

      // Parse key fields from markdown
      const iterationMatch = content.match(/Iteration:\s*(\d+)/);
      const contextMatch = content.match(/Context Usage:\s*([\d.]+)%/);
      const timestampMatch = content.match(/Generated:\s*(\S+)/);

      // Parse task lists
      const completedMatch = content.match(/### Completed.*?\n([\s\S]*?)(?=###)/);
      const pendingMatch = content.match(/### Pending.*?\n([\s\S]*?)(?=###)/);
      const blockedMatch = content.match(/### Blocked.*?\n([\s\S]*?)(?=###|## Recent)/);

      const extractTasks = (section: string | undefined): string[] => {
        if (!section) return [];
        return section
          .split('\n')
          .filter(l => l.startsWith('- ') && l !== '- None')
          .map(l => l.substring(2).trim());
      };

      return {
        timestamp: timestampMatch?.[1] || new Date().toISOString(),
        iteration: iterationMatch ? parseInt(iterationMatch[1], 10) : 0,
        completedTasks: extractTasks(completedMatch?.[1]),
        pendingTasks: extractTasks(pendingMatch?.[1]),
        blockedTasks: extractTasks(blockedMatch?.[1]),
        recentLearnings: [],
        recentPatterns: [],
        filesModified: [],
        contextUsagePercent: contextMatch ? parseFloat(contextMatch[1]) : 0,
      };
    } catch (error) {
      logger.warn(`[ContextHandoff] Failed to load handoff context: ${error}`);
      return null;
    }
  }
}
