/**
 * PRD Building Progress Tracker
 *
 * Tracks progress during PRD building with checkpoint support.
 * Allows resuming from any saved checkpoint.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PRDBuildingPhase, BuildMode } from '../conversation/types';
import { ParsedPlanningDoc } from '../prd/parser/planning-doc-parser';
import { logger } from '../utils/logger';

/**
 * PRD Building Progress
 */
export interface PRDBuildingProgress {
  conversationId: string;
  phase: PRDBuildingPhase;
  questionsAsked: number;
  questionsTotal: number;
  answersReceived: number;
  draftsGenerated: number;
  refinementsApplied: number;
  completionPercentage: number;
  estimatedTimeRemaining?: number; // in seconds
}

/**
 * Checkpoint metadata
 */
export interface CheckpointMetadata {
  checkpointId: string;
  conversationId: string;
  phase: PRDBuildingPhase;
  iteration: number;
  timestamp: string;
  description?: string;
}

/**
 * PRD Building State (for checkpoint resume)
 */
export interface PRDBuildingState {
  conversationId: string;
  mode: BuildMode;
  phase: PRDBuildingPhase;
  iteration: number;
  prdDraft?: ParsedPlanningDoc;
  progress: PRDBuildingProgress;
  metadata: CheckpointMetadata;
}

/**
 * PRD Building Progress Tracker Configuration
 */
export interface PRDBuildingProgressTrackerConfig {
  checkpointsPath?: string;
  autoSaveInterval?: number; // Auto-save checkpoints every N seconds (0 = disabled)
  maxCheckpoints?: number; // Maximum checkpoints to keep
  enabled?: boolean;
  debug?: boolean;
}

/**
 * Tracks PRD building progress with checkpoint support
 */
export class PRDBuildingProgressTracker {
  private config: Required<PRDBuildingProgressTrackerConfig>;
  private checkpointsPath: string;
  private progress: Map<string, PRDBuildingProgress> = new Map();
  private checkpoints: Map<string, CheckpointMetadata> = new Map();
  private autoSaveTimer?: NodeJS.Timeout;

  constructor(config: PRDBuildingProgressTrackerConfig = {}) {
    this.config = {
      checkpointsPath: config.checkpointsPath || '.devloop/prd-building-checkpoints',
      autoSaveInterval: config.autoSaveInterval || 0, // Disabled by default
      maxCheckpoints: config.maxCheckpoints || 20,
      enabled: config.enabled !== false, // Default to true
      debug: config.debug || false,
    };
    this.checkpointsPath = path.resolve(process.cwd(), this.config.checkpointsPath);
    this.loadCheckpoints();

    // Start auto-save timer if enabled
    if (this.config.autoSaveInterval > 0 && this.config.enabled) {
      this.startAutoSave();
    }
  }

  /**
   * Track PRD building progress
   */
  trackPRDBuildingProgress(
    conversationId: string,
    phase: PRDBuildingPhase,
    progress: PRDBuildingProgress
  ): void {
    progress.phase = phase;
    progress.conversationId = conversationId;
    this.progress.set(conversationId, progress);

    logger.debug(
      `[PRDBuildingProgressTracker] Tracked progress for ${conversationId}: phase=${phase}, completion=${progress.completionPercentage}%`
    );
  }

  /**
   * Get current progress for a conversation
   */
  getProgress(conversationId: string): PRDBuildingProgress | null {
    return this.progress.get(conversationId) || null;
  }

  /**
   * Calculate completion percentage based on phase and progress
   */
  calculateCompletionPercentage(
    phase: PRDBuildingPhase,
    questionsAsked: number,
    questionsTotal: number,
    answersReceived: number,
    draftsGenerated: number,
    refinementsApplied: number
  ): number {
    // Weights for each phase
    const phaseWeights: Record<PRDBuildingPhase, number> = {
      'question-generation': 0.1,
      'question-answering': 0.2,
      'draft-generation': 0.3,
      refinement: 0.3,
      validation: 0.08,
      complete: 1.0,
    };

    if (phase === 'complete') {
      return 100;
    }

    const baseProgress = phaseWeights[phase] || 0;
    let additionalProgress = 0;

    switch (phase) {
      case 'question-generation':
      case 'question-answering':
        // Progress based on questions asked and answered
        if (questionsTotal > 0) {
          additionalProgress = (answersReceived / questionsTotal) * 0.2;
        }
        break;
      case 'draft-generation':
        // Progress based on drafts generated
        additionalProgress = Math.min(draftsGenerated * 0.3, 0.3);
        break;
      case 'refinement':
        // Progress based on refinements applied (assume max 5 iterations)
        additionalProgress = Math.min((refinementsApplied / 5) * 0.3, 0.3);
        break;
      case 'validation':
        // Progress based on validation completion (assume 100% at this point)
        additionalProgress = 0.08;
        break;
    }

    return Math.min(Math.round((baseProgress + additionalProgress) * 100), 100);
  }

  /**
   * Save checkpoint
   */
  async saveCheckpoint(
    conversationId: string,
    mode: BuildMode,
    phase: PRDBuildingPhase,
    iteration: number,
    prdDraft?: ParsedPlanningDoc,
    description?: string
  ): Promise<string> {
    const checkpointId = `checkpoint-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    const progress = this.progress.get(conversationId) || {
      conversationId,
      phase,
      questionsAsked: 0,
      questionsTotal: 0,
      answersReceived: 0,
      draftsGenerated: 0,
      refinementsApplied: 0,
      completionPercentage: 0,
    };

    const metadata: CheckpointMetadata = {
      checkpointId,
      conversationId,
      phase,
      iteration,
      timestamp: now,
      description,
    };

    const state: PRDBuildingState = {
      conversationId,
      mode,
      phase,
      iteration,
      prdDraft,
      progress,
      metadata,
    };

    this.checkpoints.set(checkpointId, metadata);

    // Save to disk
    if (this.config.enabled) {
      await this.saveCheckpointToDisk(checkpointId, state);
    }

    // Clean up old checkpoints if we exceed max
    await this.cleanupOldCheckpoints();

    logger.info(
      `[PRDBuildingProgressTracker] Saved checkpoint ${checkpointId} for conversation ${conversationId} (phase: ${phase}, iteration: ${iteration})`
    );

    return checkpointId;
  }

  /**
   * Resume from checkpoint
   */
  async resumeFromCheckpoint(checkpointId: string): Promise<PRDBuildingState | null> {
    if (!this.config.enabled) {
      return null;
    }

    const filePath = path.join(this.checkpointsPath, `${checkpointId}.json`);
    if (!(await fs.pathExists(filePath))) {
      logger.warn(`[PRDBuildingProgressTracker] Checkpoint not found: ${checkpointId}`);
      return null;
    }

    try {
      const state = (await fs.readJson(filePath)) as PRDBuildingState;
      // Restore progress
      this.progress.set(state.conversationId, state.progress);
      logger.info(
        `[PRDBuildingProgressTracker] Resumed from checkpoint ${checkpointId} (conversation: ${state.conversationId}, phase: ${state.phase})`
      );
      return state;
    } catch (error) {
      logger.error(
        `[PRDBuildingProgressTracker] Failed to resume from checkpoint ${checkpointId}: ${error}`
      );
      return null;
    }
  }

  /**
   * List all checkpoints for a conversation
   */
  async listCheckpoints(conversationId: string): Promise<CheckpointMetadata[]> {
    if (!this.config.enabled) {
      return [];
    }

    const checkpoints: CheckpointMetadata[] = [];
    const filePath = path.join(this.checkpointsPath);
    if (!(await fs.pathExists(filePath))) {
      return [];
    }

    try {
      const files = await fs.readdir(filePath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const state = (await fs.readJson(path.join(filePath, file))) as PRDBuildingState;
          if (state.conversationId === conversationId) {
            checkpoints.push(state.metadata);
          }
        }
      }

      // Sort by timestamp (newest first)
      checkpoints.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return checkpoints;
    } catch (error) {
      logger.warn(`[PRDBuildingProgressTracker] Failed to list checkpoints: ${error}`);
      return [];
    }
  }

  /**
   * Get latest checkpoint for a conversation
   */
  async getLatestCheckpoint(conversationId: string): Promise<CheckpointMetadata | null> {
    const checkpoints = await this.listCheckpoints(conversationId);
    return checkpoints.length > 0 ? checkpoints[0] : null;
  }

  /**
   * Delete a checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    this.checkpoints.delete(checkpointId);
    const filePath = path.join(this.checkpointsPath, `${checkpointId}.json`);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
    logger.debug(`[PRDBuildingProgressTracker] Deleted checkpoint: ${checkpointId}`);
  }

  /**
   * Save checkpoint to disk
   */
  private async saveCheckpointToDisk(checkpointId: string, state: PRDBuildingState): Promise<void> {
    await fs.ensureDir(this.checkpointsPath);
    const filePath = path.join(this.checkpointsPath, `${checkpointId}.json`);
    await fs.writeJson(filePath, state, { spaces: 2 });
  }

  /**
   * Load checkpoints from disk
   */
  private loadCheckpoints(): void {
    if (!this.config.enabled || !fs.existsSync(this.checkpointsPath)) {
      return;
    }

    try {
      const files = fs.readdirSync(this.checkpointsPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const state = fs.readJsonSync(path.join(this.checkpointsPath, file)) as PRDBuildingState;
            this.checkpoints.set(state.metadata.checkpointId, state.metadata);
          } catch (error) {
            logger.warn(`[PRDBuildingProgressTracker] Failed to load checkpoint ${file}: ${error}`);
          }
        }
      }
      logger.debug(
        `[PRDBuildingProgressTracker] Loaded ${this.checkpoints.size} checkpoint(s) from disk`
      );
    } catch (error) {
      logger.warn(`[PRDBuildingProgressTracker] Failed to load checkpoints: ${error}`);
    }
  }

  /**
   * Clean up old checkpoints (keep only the most recent N)
   */
  private async cleanupOldCheckpoints(): Promise<void> {
    if (!this.config.enabled || this.checkpoints.size <= this.config.maxCheckpoints) {
      return;
    }

    // Get all checkpoints sorted by timestamp
    const checkpoints = Array.from(this.checkpoints.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Delete oldest checkpoints
    const toDelete = checkpoints.slice(this.config.maxCheckpoints);
    for (const checkpoint of toDelete) {
      await this.deleteCheckpoint(checkpoint.checkpointId);
    }

    logger.debug(
      `[PRDBuildingProgressTracker] Cleaned up ${toDelete.length} old checkpoint(s)`
    );
  }

  /**
   * Start auto-save timer
   */
  private startAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(() => {
      // Auto-save checkpoints for all active conversations
      for (const [conversationId, progress] of this.progress.entries()) {
        // In a real implementation, we'd need access to the conversation manager
        // and PRD draft to auto-save. For now, this is a placeholder.
        logger.debug(`[PRDBuildingProgressTracker] Auto-save check (conversation: ${conversationId})`);
      }
    }, this.config.autoSaveInterval * 1000);
  }

  /**
   * Stop auto-save timer
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = undefined;
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopAutoSave();
    this.progress.clear();
    this.checkpoints.clear();
  }
}
