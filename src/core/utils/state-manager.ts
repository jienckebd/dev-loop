import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { Config } from '../../config/schema';
import { WorkflowState, Task } from '../../types';

// Simple in-memory lock to prevent concurrent writes from same process
const writeLocks: Map<string, Promise<void>> = new Map();

export class StateManager {
  private stateFile: string;
  private tasksFile: string;
  private lockFile: string;

  constructor(private config: Config) {
    const stateDir = path.join(process.cwd(), '.devloop');
    this.stateFile = path.join(stateDir, 'state.json');
    this.tasksFile = path.join(stateDir, 'tasks.json');
    this.lockFile = path.join(stateDir, '.state.lock');
  }

  async initialize(): Promise<void> {
    const stateDir = path.dirname(this.stateFile);
    await fs.ensureDir(stateDir);
  }

  /**
   * Acquire a simple file lock with timeout
   */
  private async acquireLock(lockPath: string, timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    const lockContent = `${process.pid}-${Date.now()}`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to create lock file exclusively
        await fs.writeFile(lockPath, lockContent, { flag: 'wx' });
        return true;
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // Lock exists, check if it's stale (older than 30 seconds)
          try {
            const stat = await fs.stat(lockPath);
            const age = Date.now() - stat.mtimeMs;
            if (age > 30000) {
              // Stale lock, remove it
              await fs.remove(lockPath);
            }
          } catch {
            // Ignore stat errors
          }
          // Wait and retry
          await new Promise(resolve => setTimeout(resolve, 50));
        } else {
          throw error;
        }
      }
    }
    return false;
  }

  /**
   * Release file lock
   */
  private async releaseLock(lockPath: string): Promise<void> {
    try {
      await fs.remove(lockPath);
    } catch {
      // Ignore errors when releasing lock
    }
  }

  /**
   * Atomic file write using temp file and rename pattern with file locking
   * Prevents file corruption during parallel execution or unexpected crashes
   */
  private async atomicWriteJson(filePath: string, data: any): Promise<void> {
    // Wait for any in-progress writes to this file
    const existingLock = writeLocks.get(filePath);
    if (existingLock) {
      await existingLock;
    }

    // Create a new lock promise for this write
    let resolveLock: () => void;
    const lockPromise = new Promise<void>(resolve => { resolveLock = resolve; });
    writeLocks.set(filePath, lockPromise);

    const lockPath = `${filePath}.lock`;
    let hasLock = false;

    try {
      // Acquire file lock
      hasLock = await this.acquireLock(lockPath);
      if (!hasLock) {
        console.warn(`[StateManager] Could not acquire lock for ${filePath}, proceeding anyway`);
      }

      const tempFile = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
      );

      try {
        // Write to temp file
        await fs.writeJson(tempFile, data, { spaces: 2 });

        // Verify JSON is valid before renaming
        const written = await fs.readJson(tempFile);
        if (!written || typeof written !== 'object') {
          throw new Error('Invalid JSON written to temp file');
        }

        // Atomic rename (on most filesystems, rename is atomic)
        await fs.rename(tempFile, filePath);
      } catch (error) {
        // Clean up temp file on error
        try {
          if (await fs.pathExists(tempFile)) {
            await fs.remove(tempFile);
          }
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        throw error;
      }
    } finally {
      // Release locks
      if (hasLock) {
        await this.releaseLock(lockPath);
      }
      writeLocks.delete(filePath);
      resolveLock!();
    }
  }

  async getWorkflowState(): Promise<WorkflowState> {
    await this.initialize();

    if (await fs.pathExists(this.stateFile)) {
      // Retry logic to handle transient read failures during concurrent writes
      const maxRetries = 3;
      const retryDelayMs = 50;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const data = await fs.readJson(this.stateFile);
          return {
            currentTask: data.currentTask,
            status: data.status || 'idle',
            progress: data.progress || 0,
            totalTasks: data.totalTasks || 0,
            completedTasks: data.completedTasks || 0,
          };
        } catch (error: any) {
          if (attempt < maxRetries && error instanceof SyntaxError) {
            // JSON parse error during concurrent write - wait and retry
            await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
            continue;
          }
          // Last attempt or non-parse error - delete corrupted file and return default state
          console.warn(`[StateManager] Failed to read state file (attempt ${attempt}): ${error.message}`);
          if (error instanceof SyntaxError) {
            console.warn(`[StateManager] Deleting corrupted state file`);
            try {
              await fs.remove(this.stateFile);
            } catch {
              // Ignore removal errors
            }
          }
          return {
            status: 'idle',
            progress: 0,
            totalTasks: 0,
            completedTasks: 0,
          };
        }
      }
    }

    return {
      status: 'idle',
      progress: 0,
      totalTasks: 0,
      completedTasks: 0,
    };
  }

  async saveWorkflowState(state: WorkflowState): Promise<void> {
    await this.initialize();
    await this.atomicWriteJson(this.stateFile, state);
  }

  async getTasks(): Promise<Task[]> {
    await this.initialize();

    if (await fs.pathExists(this.tasksFile)) {
      return await fs.readJson(this.tasksFile);
    }

    return [];
  }

  async saveTasks(tasks: Task[]): Promise<void> {
    await this.initialize();
    await this.atomicWriteJson(this.tasksFile, tasks);
  }

  async getTask(taskId: string): Promise<Task | null> {
    const tasks = await this.getTasks();
    return tasks.find((t) => t.id === taskId) || null;
  }

  async updateTask(task: Task): Promise<void> {
    const tasks = await this.getTasks();
    const index = tasks.findIndex((t) => t.id === task.id);
    if (index >= 0) {
      tasks[index] = task;
    } else {
      tasks.push(task);
    }
    await this.saveTasks(tasks);
  }

  async clearState(): Promise<void> {
    await this.initialize();
    if (await fs.pathExists(this.stateFile)) {
      await fs.remove(this.stateFile);
    }
  }
}

