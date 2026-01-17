/**
 * File-Based Checkpointer for LangGraph
 *
 * Provides durable checkpointing to the filesystem.
 * Stores checkpoints in .devloop/checkpoints/ directory.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata } from '@langchain/langgraph';
import { RunnableConfig } from '@langchain/core/runnables';
import { logger } from '../../utils/logger';

export interface FileCheckpointerConfig {
  checkpointDir?: string;
  debug?: boolean;
}

/**
 * File-based checkpoint saver for LangGraph
 *
 * Stores checkpoints as JSON files in the configured directory.
 * Supports checkpoint listing, retrieval, and cleanup.
 */
export class FileCheckpointer extends BaseCheckpointSaver {
  private checkpointDir: string;
  private debug: boolean;

  constructor(config: FileCheckpointerConfig = {}) {
    super();
    this.checkpointDir = config.checkpointDir ||
      path.resolve(process.cwd(), '.devloop/checkpoints');
    this.debug = config.debug || false;
  }

  /**
   * Get a checkpoint by thread_id and checkpoint_id
   */
  async getTuple(config: RunnableConfig): Promise<{
    config: RunnableConfig;
    checkpoint: Checkpoint;
    metadata: CheckpointMetadata;
  } | undefined> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;

    if (!threadId) {
      return undefined;
    }

    try {
      const checkpointPath = this.getCheckpointPath(threadId, checkpointId);

      if (!await fs.pathExists(checkpointPath)) {
        // Try to get latest if no specific checkpoint requested
        if (!checkpointId) {
          const latest = await this.getLatestCheckpoint(threadId);
          if (latest) {
            return latest;
          }
        }
        return undefined;
      }

      const data = await fs.readJson(checkpointPath);

      return {
        config: {
          ...config,
          configurable: {
            ...config.configurable,
            checkpoint_id: data.id,
          },
        },
        checkpoint: data.checkpoint,
        metadata: data.metadata || {},
      };
    } catch (error) {
      if (this.debug) {
        logger.debug(`[FileCheckpointer] Error getting checkpoint: ${error}`);
      }
      return undefined;
    }
  }

  /**
   * List checkpoints for a thread
   */
  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig }
  ): AsyncGenerator<{
    config: RunnableConfig;
    checkpoint: Checkpoint;
    metadata: CheckpointMetadata;
  }> {
    const threadId = config.configurable?.thread_id;

    if (!threadId) {
      return;
    }

    try {
      const threadDir = path.join(this.checkpointDir, threadId);

      if (!await fs.pathExists(threadDir)) {
        return;
      }

      const files = await fs.readdir(threadDir);
      const checkpointFiles = files
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Newest first

      let count = 0;
      const limit = options?.limit || checkpointFiles.length;

      for (const file of checkpointFiles) {
        if (count >= limit) break;

        try {
          const data = await fs.readJson(path.join(threadDir, file));

          yield {
            config: {
              ...config,
              configurable: {
                ...config.configurable,
                checkpoint_id: data.id,
              },
            },
            checkpoint: data.checkpoint,
            metadata: data.metadata || {},
          };

          count++;
        } catch {
          // Skip corrupted checkpoints
        }
      }
    } catch (error) {
      if (this.debug) {
        logger.debug(`[FileCheckpointer] Error listing checkpoints: ${error}`);
      }
    }
  }

  /**
   * Put writes for pending checkpoints (required by BaseCheckpointSaver)
   */
  async putWrites(
    config: RunnableConfig,
    writes: Array<[string, unknown]>,
    taskId: string
  ): Promise<void> {
    // For file-based checkpointer, writes are handled in put()
    // This is a no-op implementation for compatibility
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    const threadDir = path.join(this.checkpointDir, String(threadId));
    await fs.ensureDir(threadDir);

    // Store writes for later retrieval if needed
    const writesPath = path.join(threadDir, `writes-${taskId}.json`);
    await fs.writeJson(writesPath, { writes, taskId, timestamp: new Date().toISOString() });
  }

  /**
   * Save a checkpoint
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;

    if (!threadId) {
      throw new Error('thread_id is required for checkpointing');
    }

    try {
      const checkpointId = checkpoint.id || this.generateCheckpointId();
      const threadDir = path.join(this.checkpointDir, threadId);

      await fs.ensureDir(threadDir);

      const checkpointPath = path.join(threadDir, `${checkpointId}.json`);

      const data = {
        id: checkpointId,
        threadId,
        checkpoint,
        metadata,
        timestamp: new Date().toISOString(),
      };

      await fs.writeJson(checkpointPath, data, { spaces: 2 });

      if (this.debug) {
        logger.debug(`[FileCheckpointer] Saved checkpoint: ${checkpointId}`);
      }

      return {
        ...config,
        configurable: {
          ...config.configurable,
          checkpoint_id: checkpointId,
        },
      };
    } catch (error) {
      logger.error(`[FileCheckpointer] Error saving checkpoint: ${error}`);
      throw error;
    }
  }

  /**
   * Delete a checkpoint
   */
  async delete(config: RunnableConfig): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;

    if (!threadId || !checkpointId) {
      return;
    }

    try {
      const checkpointPath = this.getCheckpointPath(threadId, checkpointId);

      if (await fs.pathExists(checkpointPath)) {
        await fs.remove(checkpointPath);

        if (this.debug) {
          logger.debug(`[FileCheckpointer] Deleted checkpoint: ${checkpointId}`);
        }
      }
    } catch (error) {
      if (this.debug) {
        logger.debug(`[FileCheckpointer] Error deleting checkpoint: ${error}`);
      }
    }
  }

  /**
   * Get the path for a checkpoint file
   */
  private getCheckpointPath(threadId: string, checkpointId?: string): string {
    if (checkpointId) {
      return path.join(this.checkpointDir, threadId, `${checkpointId}.json`);
    }
    return path.join(this.checkpointDir, threadId);
  }

  /**
   * Get the latest checkpoint for a thread
   */
  private async getLatestCheckpoint(threadId: string): Promise<{
    config: RunnableConfig;
    checkpoint: Checkpoint;
    metadata: CheckpointMetadata;
  } | undefined> {
    const threadDir = path.join(this.checkpointDir, threadId);

    if (!await fs.pathExists(threadDir)) {
      return undefined;
    }

    try {
      const files = await fs.readdir(threadDir);
      const checkpointFiles = files
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Newest first

      if (checkpointFiles.length === 0) {
        return undefined;
      }

      const latestFile = checkpointFiles[0];
      const data = await fs.readJson(path.join(threadDir, latestFile));

      return {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_id: data.id,
          },
        },
        checkpoint: data.checkpoint,
        metadata: data.metadata || {},
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Generate a unique checkpoint ID
   */
  private generateCheckpointId(): string {
    return `cp-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Clean up old checkpoints for a thread
   */
  async cleanup(threadId: string, keepCount: number = 5): Promise<number> {
    const threadDir = path.join(this.checkpointDir, threadId);

    if (!await fs.pathExists(threadDir)) {
      return 0;
    }

    try {
      const files = await fs.readdir(threadDir);
      const checkpointFiles = files
        .filter(f => f.endsWith('.json'))
        .sort((a, b) => b.localeCompare(a)); // Newest first

      const toDelete = checkpointFiles.slice(keepCount);

      for (const file of toDelete) {
        await fs.remove(path.join(threadDir, file));
      }

      if (this.debug && toDelete.length > 0) {
        logger.debug(`[FileCheckpointer] Cleaned up ${toDelete.length} old checkpoints`);
      }

      return toDelete.length;
    } catch {
      return 0;
    }
  }

  /**
   * Clean up all checkpoints older than a certain age
   */
  async cleanupOld(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    let deletedCount = 0;
    const now = Date.now();

    try {
      if (!await fs.pathExists(this.checkpointDir)) {
        return 0;
      }

      const threads = await fs.readdir(this.checkpointDir);

      for (const thread of threads) {
        const threadDir = path.join(this.checkpointDir, thread);
        const stat = await fs.stat(threadDir);

        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(threadDir);

        for (const file of files) {
          if (!file.endsWith('.json')) continue;

          const filePath = path.join(threadDir, file);
          const fileStat = await fs.stat(filePath);

          if (now - fileStat.mtimeMs > maxAgeMs) {
            await fs.remove(filePath);
            deletedCount++;
          }
        }

        // Remove empty directories
        const remaining = await fs.readdir(threadDir);
        if (remaining.length === 0) {
          await fs.remove(threadDir);
        }
      }

      if (this.debug && deletedCount > 0) {
        logger.debug(`[FileCheckpointer] Cleaned up ${deletedCount} old checkpoint files`);
      }

      return deletedCount;
    } catch {
      return deletedCount;
    }
  }
}

/**
 * Create a file-based checkpointer with default settings
 */
export function createFileCheckpointer(config?: FileCheckpointerConfig): FileCheckpointer {
  return new FileCheckpointer(config);
}
