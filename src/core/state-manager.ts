import * as fs from 'fs-extra';
import * as path from 'path';
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

  async getWorkflowState(): Promise<WorkflowState> {
    await this.initialize();

    if (await fs.pathExists(this.stateFile)) {
      const data = await fs.readJson(this.stateFile);
      return {
        currentTask: data.currentTask,
        status: data.status || 'idle',
        progress: data.progress || 0,
        totalTasks: data.totalTasks || 0,
        completedTasks: data.completedTasks || 0,
      };
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
    await fs.writeJson(this.stateFile, state, { spaces: 2 });
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
    await fs.writeJson(this.tasksFile, tasks, { spaces: 2 });
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

