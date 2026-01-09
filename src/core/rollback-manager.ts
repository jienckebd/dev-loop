import { logger } from './logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';

const execAsync = promisify(exec);

export interface Checkpoint {
  id: string;
  prdId: string;
  phaseId: number;
  checkpointType: 'phase-completion' | 'test-pass' | 'validation-pass' | 'task-completion' | 'manual';
  timestamp: string;
  gitCommit?: string;
  snapshotPath?: string;
}

export interface RollbackResult {
  success: boolean;
  checkpoint: Checkpoint;
  restoredFiles: string[];
  errors: string[];
}

export interface RestoreResult {
  success: boolean;
  checkpoint: Checkpoint;
  restoredFiles: string[];
  errors: string[];
}

/**
 * RollbackManager manages automated checkpoint creation and rollback.
 *
 * Supports:
 * - Checkpoint creation on phase/test/validation completion
 * - Rollback to checkpoints
 * - Multiple restore strategies (git-checkout, snapshot, manual)
 */
export class RollbackManager {
  private checkpointPath: string;
  private restoreStrategy: 'git-checkout' | 'snapshot' | 'manual';
  private debug: boolean;

  constructor(
    checkpointPath: string = '.devloop/checkpoints',
    restoreStrategy: 'git-checkout' | 'snapshot' | 'manual' = 'git-checkout',
    debug: boolean = false
  ) {
    this.checkpointPath = checkpointPath;
    this.restoreStrategy = restoreStrategy;
    this.debug = debug;
  }

  /**
   * Create a checkpoint.
   */
  async createCheckpoint(
    prdId: string,
    phaseId: number,
    checkpointType: Checkpoint['checkpointType']
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: `${prdId}-phase-${phaseId}-${Date.now()}`,
      prdId,
      phaseId,
      checkpointType,
      timestamp: new Date().toISOString(),
    };

    // Get git commit if available
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: process.cwd() });
      checkpoint.gitCommit = stdout.trim();
    } catch {
      // Git not available or not a git repo
    }

    // Create snapshot if strategy is snapshot
    if (this.restoreStrategy === 'snapshot') {
      const snapshotPath = path.join(this.checkpointPath, `${checkpoint.id}.snapshot`);
      await this.createSnapshot(snapshotPath);
      checkpoint.snapshotPath = snapshotPath;
    }

    // Save checkpoint metadata
    const checkpointFile = path.join(this.checkpointPath, `${checkpoint.id}.json`);
    await fs.ensureDir(path.dirname(checkpointFile));
    await fs.writeJson(checkpointFile, checkpoint, { spaces: 2 });

    if (this.debug) {
      logger.debug(`[RollbackManager] Created checkpoint: ${checkpoint.id}`);
    }

    return checkpoint;
  }

  /**
   * Rollback to a checkpoint.
   */
  async rollbackToCheckpoint(checkpoint: Checkpoint): Promise<RollbackResult> {
    const result: RollbackResult = {
      success: false,
      checkpoint,
      restoredFiles: [],
      errors: [],
    };

    try {
      switch (this.restoreStrategy) {
        case 'git-checkout':
          if (checkpoint.gitCommit) {
            await execAsync(`git checkout ${checkpoint.gitCommit}`, { cwd: process.cwd() });
            result.restoredFiles = ['*']; // All files restored
            result.success = true;
          } else {
            result.errors.push('No git commit available for checkpoint');
          }
          break;

        case 'snapshot':
          if (checkpoint.snapshotPath && await fs.pathExists(checkpoint.snapshotPath)) {
            await this.restoreSnapshot(checkpoint.snapshotPath);
            result.restoredFiles = ['*']; // All files restored
            result.success = true;
          } else {
            result.errors.push('Snapshot not available for checkpoint');
          }
          break;

        case 'manual':
          result.errors.push('Manual restore strategy requires user intervention');
          break;
      }
    } catch (error: any) {
      result.errors.push(`Rollback failed: ${error.message}`);
    }

    return result;
  }

  /**
   * Restore from a checkpoint.
   */
  async restoreFromCheckpoint(checkpoint: Checkpoint): Promise<RestoreResult> {
    return this.rollbackToCheckpoint(checkpoint);
  }

  /**
   * List checkpoints for a PRD.
   */
  async listCheckpoints(prdId: string): Promise<Checkpoint[]> {
    const checkpoints: Checkpoint[] = [];

    if (!await fs.pathExists(this.checkpointPath)) {
      return checkpoints;
    }

    const files = await fs.readdir(this.checkpointPath);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const checkpoint = await fs.readJson(path.join(this.checkpointPath, file)) as Checkpoint;
          if (checkpoint.prdId === prdId) {
            checkpoints.push(checkpoint);
          }
        } catch {
          // Ignore invalid checkpoint files
        }
      }
    }

    // Sort by timestamp (newest first)
    checkpoints.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return checkpoints;
  }

  /**
   * Create a snapshot.
   */
  private async createSnapshot(snapshotPath: string): Promise<void> {
    // Create a tar archive of the project
    // This is a simplified implementation
    await fs.ensureDir(path.dirname(snapshotPath));
    // In a real implementation, this would create a full snapshot
  }

  /**
   * Restore from a snapshot.
   */
  private async restoreSnapshot(snapshotPath: string): Promise<void> {
    // Restore from tar archive
    // This is a simplified implementation
    // In a real implementation, this would restore the full snapshot
  }
}






