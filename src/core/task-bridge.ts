import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from '../config/schema';
import { Task, TaskStatus } from '../types';

const execAsync = promisify(exec);

export class TaskMasterBridge {
  private tasksPath: string;
  private originalFormat: 'array' | 'tasks' | 'master' = 'master';

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
        let rawTasks: Task[] = [];

        // Handle multiple formats and remember original format:
        // 1. Direct array: [task1, task2, ...]
        if (Array.isArray(data)) {
          rawTasks = data;
          this.originalFormat = 'array';
        }
        // 2. Object with tasks property: {tasks: [task1, task2, ...]}
        else if (data.tasks && Array.isArray(data.tasks)) {
          rawTasks = data.tasks;
          this.originalFormat = 'tasks';
        }
        // 3. Object with tag keys containing tasks: {master: {tasks: [task1, task2, ...]}, ...}
        else if (typeof data === 'object') {
          const tagKeys = Object.keys(data);
          for (const key of tagKeys) {
            if (data[key] && typeof data[key] === 'object') {
              // Check for nested tasks array
              if (data[key].tasks && Array.isArray(data[key].tasks)) {
                rawTasks = data[key].tasks;
                this.originalFormat = 'master';
                break;
              }
              // Or direct array
              else if (Array.isArray(data[key])) {
                rawTasks = data[key];
                this.originalFormat = 'master';
                break;
              }
            }
          }
        }

        // Flatten subtasks into main task list
        const allTasks: Task[] = [];
        for (const task of rawTasks) {
          allTasks.push(task);
          // Add pending subtasks as separate tasks
          if (task.subtasks && Array.isArray(task.subtasks)) {
            for (const subtask of task.subtasks) {
              if (subtask.status === 'pending') {
                allTasks.push({
                  ...subtask,
                  id: `${task.id}.${subtask.id}`,
                  parentId: task.id,
                  priority: subtask.priority || task.priority || 'medium',
                });
              }
            }
          }
        }

        const pending = allTasks.filter(t => t.status === 'pending');
        console.log(`[TaskBridge] Loaded ${rawTasks.length} tasks, ${pending.length} pending (including subtasks)`);
        return allTasks;
      } catch (error) {
        console.error(`[TaskBridge] Error parsing tasks file:`, error);
        return [];
      }
    }

    console.warn(`[TaskBridge] Tasks file not found: ${this.tasksPath}`);
    return [];
  }

  private async saveTasks(tasks: Task[]): Promise<void> {
    await fs.ensureDir(path.dirname(this.tasksPath));

    // Always use master format to preserve Task Master CLI compatibility
    const originalFormat = 'master';
    console.log(`[TaskBridge] Saving ${tasks.length} tasks in ${originalFormat} format`);

    // Reconstruct tasks with subtasks (tasks with parentId go back to parent's subtasks array)
    const mainTasks: Task[] = [];
    const subtaskMap = new Map<string, Task[]>();

    for (const task of tasks) {
      if (task.parentId) {
        // This is a subtask - add to parent's subtasks
        const parentId = task.parentId;
        if (!subtaskMap.has(parentId)) {
          subtaskMap.set(parentId, []);
        }
        // Remove parentId and restore original ID
        const { parentId: _, id, ...subtaskData } = task;
        const originalSubtaskId = id.toString().split('.').pop() || id;
        subtaskMap.get(parentId)!.push({
          ...subtaskData,
          id: originalSubtaskId,
        } as Task);
      } else {
        mainTasks.push(task);
      }
    }

    // Attach subtasks back to parent tasks
    for (const task of mainTasks) {
      if (subtaskMap.has(task.id.toString())) {
        task.subtasks = subtaskMap.get(task.id.toString())!;
      }
    }

    // Always save in master format for Task Master CLI compatibility
    const output = { master: { tasks: mainTasks } };

    await fs.writeJson(this.tasksPath, output, { spaces: 2 });
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

