import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';
import { Config } from '../config/schema';
import { WorkflowState, Task } from '../types';

export class StateManager {
  private stateFile: string;
  private tasksFile: string;

  constructor(private config: Config) {
    const stateDir = path.join(process.cwd(), '.devloop');
    this.stateFile = path.join(stateDir, 'state.json');
    this.tasksFile = path.join(stateDir, 'tasks.json');
  }

  async initialize(): Promise<void> {
    const stateDir = path.dirname(this.stateFile);
    await fs.ensureDir(stateDir);
  }

  /**
   * Atomic file write using temp file and rename pattern
   * Prevents file corruption during parallel execution or unexpected crashes
   */
  private async atomicWriteJson(filePath: string, data: any): Promise<void> {
    const tempFile = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
    );

    try {
      // Write to temp file
      await fs.writeJson(tempFile, data, { spaces: 2 });

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
          // Last attempt or non-parse error - return default state
          console.warn(`[StateManager] Failed to read state file (attempt ${attempt}): ${error.message}`);
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

