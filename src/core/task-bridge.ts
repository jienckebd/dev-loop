import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from '../config/schema';
import { Task, TaskStatus } from '../types';

const execAsync = promisify(exec);

export class TaskMasterBridge {
  private tasksPath: string;

  constructor(private config: Config) {
    this.tasksPath = path.resolve(process.cwd(), config.taskMaster.tasksPath);
  }

  async getPendingTasks(): Promise<Task[]> {
    try {
      const tasks = await this.loadTasks();
      return tasks.filter((t) => t.status === 'pending');
    } catch (error) {
      throw new Error(`Failed to get pending tasks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getTask(taskId: string): Promise<Task | null> {
    try {
      const tasks = await this.loadTasks();
      return tasks.find((t) => t.id === taskId) || null;
    } catch (error) {
      throw new Error(`Failed to get task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    try {
      const tasks = await this.loadTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        task.status = status;
        await this.saveTasks(tasks);
      } else {
        throw new Error(`Task not found: ${taskId}`);
      }
    } catch (error) {
      throw new Error(`Failed to update task status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createTask(task: Omit<Task, 'status'> & { status?: TaskStatus }): Promise<Task> {
    try {
      const tasks = await this.loadTasks();
      const newTask: Task = {
        ...task,
        status: task.status || 'pending',
      };
      tasks.push(newTask);
      await this.saveTasks(tasks);
      return newTask;
    } catch (error) {
      throw new Error(`Failed to create task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createFixTask(originalTaskId: string, errorDescription: string, testOutput: string): Promise<Task> {
    const originalTask = await this.getTask(originalTaskId);
    if (!originalTask) {
      throw new Error(`Original task not found: ${originalTaskId}`);
    }

    return this.createTask({
      id: `fix-${originalTaskId}-${Date.now()}`,
      title: `Fix: ${originalTask.title}`,
      description: `Fix issues in ${originalTask.title}\n\nError: ${errorDescription}\n\nTest Output:\n${testOutput}`,
      priority: 'high',
      dependencies: [originalTaskId],
    });
  }

  private async loadTasks(): Promise<Task[]> {
    await fs.ensureDir(path.dirname(this.tasksPath));

    if (await fs.pathExists(this.tasksPath)) {
      const content = await fs.readFile(this.tasksPath, 'utf-8');
      try {
        const data = JSON.parse(content);
        // Handle multiple formats:
        // 1. Direct array: [task1, task2, ...]
        if (Array.isArray(data)) {
          return data;
        }
        // 2. Object with tasks property: {tasks: [task1, task2, ...]}
        else if (data.tasks && Array.isArray(data.tasks)) {
          return data.tasks;
        }
        // 3. Object with tag keys: {master: [task1, task2, ...], ...}
        else if (typeof data === 'object') {
          // Get first array value (typically 'master' tag)
          const tagKeys = Object.keys(data);
          for (const key of tagKeys) {
            if (Array.isArray(data[key])) {
              return data[key];
            }
          }
        }
        return [];
      } catch {
        return [];
      }
    }

    return [];
  }

  private async saveTasks(tasks: Task[]): Promise<void> {
    await fs.ensureDir(path.dirname(this.tasksPath));
    await fs.writeJson(this.tasksPath, tasks, { spaces: 2 });
  }

  async initializeTaskMaster(): Promise<void> {
    // Try to initialize task-master-ai if needed
    // This is a placeholder - actual implementation depends on task-master-ai API
    try {
      // Check if task-master-ai is available
      await execAsync('task-master --version').catch(() => {
        // task-master-ai CLI might not be available, that's okay
      });
    } catch {
      // Ignore errors - task-master-ai might be used programmatically
    }
  }
}

