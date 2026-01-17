/**
 * Cross-PRD Checkpointer
 *
 * Extends FileCheckpointer to support:
 * - PRD set namespacing for checkpoints
 * - Shared state across PRDs in same set
 * - Dependency-aware checkpoint retrieval
 */

import { FileCheckpointer, FileCheckpointerConfig } from './checkpointer';
import { RunnableConfig } from '@langchain/core/runnables';
import { Checkpoint, CheckpointMetadata } from '@langchain/langgraph';
import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../utils/logger';

export interface CrossPrdCheckpointerConfig extends FileCheckpointerConfig {
  prdSetId: string;
  sharedStatePath?: string;
}

export interface SharedCheckpointState {
  prdSetId: string;
  completedPrds: string[];
  sharedPatterns: Array<{ name: string; guidance: string; occurrences: number }>;
  globalMetrics: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalTokens: number;
  };
  lastUpdated: string;
}

/**
 * Cross-PRD Checkpointer for coordinated checkpoint state across PRD sets
 */
export class CrossPrdCheckpointer extends FileCheckpointer {
  private prdSetId: string;
  private sharedStatePath: string;

  constructor(config: CrossPrdCheckpointerConfig) {
    // Namespace checkpoint directory by prdSetId
    const namespacedConfig = {
      ...config,
      checkpointDir: config.checkpointDir
        ? path.join(config.checkpointDir, config.prdSetId)
        : path.resolve(process.cwd(), '.devloop/checkpoints', config.prdSetId),
    };
    super(namespacedConfig);

    this.prdSetId = config.prdSetId;
    this.sharedStatePath = config.sharedStatePath ||
      path.resolve(process.cwd(), '.devloop/shared-checkpoint-state.json');
  }

  /**
   * Get shared state across all PRDs in this set
   */
  async getSharedState(): Promise<SharedCheckpointState> {
    try {
      if (await fs.pathExists(this.sharedStatePath)) {
        const data = await fs.readJson(this.sharedStatePath);
        if (data.prdSetId === this.prdSetId) {
          return data;
        }
      }
    } catch (error) {
      logger.debug(`[CrossPrdCheckpointer] Could not load shared state: ${error}`);
    }

    // Return fresh state if none exists or different prdSetId
    return {
      prdSetId: this.prdSetId,
      completedPrds: [],
      sharedPatterns: [],
      globalMetrics: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalTokens: 0,
      },
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Update shared state (called after PRD completion)
   */
  async updateSharedState(update: Partial<SharedCheckpointState>): Promise<void> {
    const current = await this.getSharedState();
    const updated: SharedCheckpointState = {
      ...current,
      ...update,
      prdSetId: this.prdSetId, // Ensure prdSetId is preserved
      lastUpdated: new Date().toISOString(),
    };

    try {
      await fs.ensureDir(path.dirname(this.sharedStatePath));
      await fs.writeJson(this.sharedStatePath, updated, { spaces: 2 });
      logger.debug(`[CrossPrdCheckpointer] Updated shared state`);
    } catch (error) {
      logger.error(`[CrossPrdCheckpointer] Failed to update shared state: ${error}`);
    }
  }

  /**
   * Mark PRD as complete in shared state
   */
  async markPrdComplete(prdId: string, metrics?: {
    tasksCompleted: number;
    tasksFailed: number;
    tokensUsed: number;
  }): Promise<void> {
    const state = await this.getSharedState();

    if (!state.completedPrds.includes(prdId)) {
      state.completedPrds.push(prdId);
    }

    if (metrics) {
      state.globalMetrics.completedTasks += metrics.tasksCompleted;
      state.globalMetrics.failedTasks += metrics.tasksFailed;
      state.globalMetrics.totalTokens += metrics.tokensUsed;
      state.globalMetrics.totalTasks += metrics.tasksCompleted + metrics.tasksFailed;
    }

    await this.updateSharedState(state);
    logger.info(`[CrossPrdCheckpointer] Marked PRD complete: ${prdId}`);
  }

  /**
   * Check if dependent PRDs are complete
   */
  async areDependenciesComplete(dependencyPrdIds: string[]): Promise<boolean> {
    if (!dependencyPrdIds || dependencyPrdIds.length === 0) {
      return true;
    }

    const state = await this.getSharedState();
    const allComplete = dependencyPrdIds.every(id => state.completedPrds.includes(id));

    if (!allComplete) {
      const missing = dependencyPrdIds.filter(id => !state.completedPrds.includes(id));
      logger.debug(`[CrossPrdCheckpointer] Missing dependencies: ${missing.join(', ')}`);
    }

    return allComplete;
  }

  /**
   * Add shared pattern from PRD execution
   */
  async addSharedPattern(pattern: { name: string; guidance: string; occurrences: number }): Promise<void> {
    const state = await this.getSharedState();

    const existingIdx = state.sharedPatterns.findIndex(p => p.name === pattern.name);
    if (existingIdx >= 0) {
      // Update existing pattern
      state.sharedPatterns[existingIdx].occurrences += pattern.occurrences;
    } else {
      // Add new pattern
      state.sharedPatterns.push(pattern);
    }

    await this.updateSharedState(state);
  }

  /**
   * Get completion progress for the PRD set
   */
  async getProgress(): Promise<{
    completedPrds: number;
    totalMetrics: SharedCheckpointState['globalMetrics'];
    patterns: number;
  }> {
    const state = await this.getSharedState();
    return {
      completedPrds: state.completedPrds.length,
      totalMetrics: state.globalMetrics,
      patterns: state.sharedPatterns.length,
    };
  }

  /**
   * Reset shared state (use with caution)
   */
  async resetSharedState(): Promise<void> {
    const freshState: SharedCheckpointState = {
      prdSetId: this.prdSetId,
      completedPrds: [],
      sharedPatterns: [],
      globalMetrics: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        totalTokens: 0,
      },
      lastUpdated: new Date().toISOString(),
    };

    await this.updateSharedState(freshState);
    logger.info(`[CrossPrdCheckpointer] Reset shared state for ${this.prdSetId}`);
  }

  /**
   * Override put to include prdSetId in metadata
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    // Add prdSetId to metadata
    const enrichedMetadata: CheckpointMetadata = {
      ...metadata,
      prdSetId: this.prdSetId,
    } as CheckpointMetadata;

    return super.put(config, checkpoint, enrichedMetadata);
  }
}

/**
 * Create a cross-PRD checkpointer with default settings
 */
export function createCrossPrdCheckpointer(config: CrossPrdCheckpointerConfig): CrossPrdCheckpointer {
  return new CrossPrdCheckpointer(config);
}
