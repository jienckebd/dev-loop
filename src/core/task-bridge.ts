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
  private taskRetryCount: Map<string, number> = new Map();
  private maxRetries: number = 3;

  constructor(private config: Config) {
    this.tasksPath = path.resolve(process.cwd(), config.taskMaster.tasksPath);
    // Allow config override for maxRetries
    this.maxRetries = (config as any).maxRetries || 3;
  }

  /**
   * Get retry count for a task
   */
  getRetryCount(taskId: string | number): number {
    // Get base task ID (without fix- prefix)
    const baseId = this.getBaseTaskId(taskId);
    return this.taskRetryCount.get(baseId) || 0;
  }

  /**
   * Increment retry count for a task
   */
  incrementRetryCount(taskId: string | number): number {
    const baseId = this.getBaseTaskId(taskId);
    const count = (this.taskRetryCount.get(baseId) || 0) + 1;
    this.taskRetryCount.set(baseId, count);
    return count;
  }

  /**
   * Check if task has exceeded max retries
   */
  hasExceededMaxRetries(taskId: string | number): boolean {
    return this.getRetryCount(taskId) >= this.maxRetries;
  }

  /**
   * Get base task ID (strips fix- prefix and timestamp suffix)
   */
  private getBaseTaskId(taskId: string | number): string {
    const idStr = String(taskId);
    // Handle fix-{originalId}-{timestamp} format
    const fixMatch = idStr.match(/^fix-(.+)-\d+$/);
    if (fixMatch) {
      return this.getBaseTaskId(fixMatch[1]); // Recursive to handle nested fixes
    }
    return idStr;
  }

  async getPendingTasks(): Promise<Task[]> {
    try {
      const tasks = await this.loadTasks();
      // Include both "pending" and "in-progress" tasks (in-progress means it was interrupted)
      const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in-progress');

      // Filter out tasks that have exceeded max retries
      const eligibleTasks = pending.filter(t => !this.hasExceededMaxRetries(t.id));

      // Sort by priority and prefer original tasks over fix tasks
      return eligibleTasks.sort((a, b) => {
        // First, prefer in-progress tasks (to resume them)
        if (a.status === 'in-progress' && b.status !== 'in-progress') return -1;
        if (b.status === 'in-progress' && a.status !== 'in-progress') return 1;

        // Then, prefer non-fix tasks over fix tasks (original tasks first)
        const aIsFix = String(a.id).startsWith('fix-');
        const bIsFix = String(b.id).startsWith('fix-');
        if (!aIsFix && bIsFix) return -1;
        if (aIsFix && !bIsFix) return 1;

        // Then sort by priority
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 2;
        const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 2;
        return aPriority - bPriority;
      });
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

  async getAllTasks(): Promise<Task[]> {
    try {
      return await this.loadTasks();
    } catch (error) {
      throw new Error(`Failed to get all tasks: ${error instanceof Error ? error.message : String(error)}`);
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

  async createFixTask(originalTaskId: string, errorDescription: string, testOutput: string): Promise<Task | null> {
    const originalTask = await this.getTask(originalTaskId);
    if (!originalTask) {
      throw new Error(`Original task not found: ${originalTaskId}`);
    }

    // Increment retry count and check if we've exceeded max retries
    const retryCount = this.incrementRetryCount(originalTaskId);
    if (retryCount > this.maxRetries) {
      console.log(`[TaskBridge] Task ${originalTaskId} has exceeded max retries (${this.maxRetries}), marking as blocked`);
      // Mark the task as blocked instead of creating another fix task
      await this.updateTaskStatus(originalTaskId, 'blocked' as TaskStatus);
      return null;
    }

    console.log(`[TaskBridge] Creating fix task for ${originalTaskId} (attempt ${retryCount}/${this.maxRetries})`);

    // Extract line numbers from error messages for better context
    const lineNumbers = this.extractLineNumbers(errorDescription + '\n' + testOutput);
    const lineContext = lineNumbers.length > 0
      ? `\n\nRelevant line numbers to check: ${lineNumbers.join(', ')}`
      : '';

    // Extract file paths from error messages
    const filePaths = this.extractFilePaths(errorDescription + '\n' + testOutput);
    const fileContext = filePaths.length > 0
      ? `\n\nFiles mentioned in errors:\n${filePaths.map(f => `- ${f}`).join('\n')}`
      : '';

    // Detect common error patterns and add specific guidance
    const guidance = this.getErrorGuidance(errorDescription);

    return this.createTask({
      id: `fix-${originalTaskId}-${Date.now()}`,
      title: `Fix: ${originalTask.title} (attempt ${retryCount})`,
      description: `Fix issues in ${originalTask.title}\n\nAttempt: ${retryCount}/${this.maxRetries}\n\nError: ${errorDescription}${lineContext}${fileContext}${guidance}\n\nTest Output:\n${testOutput}`,
      priority: 'critical', // Fix tasks are always critical
      dependencies: [originalTaskId],
      details: originalTask.details, // Preserve original task details
    });
  }

  /**
   * Extract line numbers from error messages
   */
  private extractLineNumbers(text: string): number[] {
    const lineNumbers: number[] = [];
    const patterns = [
      /line\s+(\d+)/gi,
      /:\s*(\d+)\s*:/g,
      /at\s+.*:(\d+)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const num = parseInt(match[1], 10);
        if (num > 0 && num < 10000 && !lineNumbers.includes(num)) {
          lineNumbers.push(num);
        }
      }
    }

    return lineNumbers.sort((a, b) => a - b);
  }

  /**
   * Extract file paths from error messages using config patterns
   */
  private extractFilePaths(text: string): string[] {
    const paths: string[] = [];

    // Use framework config patterns if available, otherwise use generic patterns
    const configPatterns = (this.config as any).framework?.errorPathPatterns || [];
    const defaultPatterns = [
      /([a-zA-Z0-9_\-./]+\.[a-z]+):\d+/g, // Generic: file.ext:linenum
    ];

    const patterns = configPatterns.length > 0
      ? configPatterns.map((p: string) => new RegExp(p, 'g'))
      : defaultPatterns;

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const filePath = match[1] || match[0];
        if (!paths.includes(filePath) && filePath.includes('/')) {
          paths.push(filePath);
        }
      }
    }

    return paths;
  }

  /**
   * Provide specific guidance based on error patterns (config-driven)
   */
  private getErrorGuidance(error: string): string {
    const guidance: string[] = [];

    // Use framework config guidance if available
    const configGuidance = (this.config as any).framework?.errorGuidance as Record<string, string> | undefined;
    if (configGuidance) {
      for (const [pattern, message] of Object.entries(configGuidance)) {
        if (error.includes(pattern)) {
          guidance.push(message);
        }
      }
    }

    // Generic guidance patterns (framework-agnostic)
    if (error.includes('PATCH_FAILED') || error.includes('Search string not found')) {
      guidance.push('PATCH FAILURE: The search string does not match the actual file content. Copy the EXACT code from the existing file context, including all whitespace and newlines.');
    }

    if (error.includes('undefined method') || error.includes('Call to undefined') || error.includes('is not defined')) {
      guidance.push('UNDEFINED METHOD/FUNCTION: A method or function is being called that does not exist. Either implement it OR remove the call.');
    }

    if (error.includes('syntax error') || error.includes('Parse error') || error.includes('SyntaxError')) {
      guidance.push('SYNTAX ERROR: The generated code has syntax errors. Ensure all braces, parentheses, and semicolons are balanced.');
    }

    return guidance.length > 0 ? '\n\n**Specific Guidance:**\n' + guidance.map(g => `- ${g}`).join('\n') : '';
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
    const output = {
      master: {
        tasks: mainTasks,
        metadata: {
          updated: new Date().toISOString(),
        }
      }
    };

    // Atomic write: write to temp file first, then rename
    const tempPath = `${this.tasksPath}.tmp`;
    try {
      await fs.writeJson(tempPath, output, { spaces: 2 });
      // Verify the JSON is valid before replacing original
      const verification = await fs.readJson(tempPath);
      if (!verification?.master?.tasks) {
        throw new Error('Written JSON is invalid - missing master.tasks');
      }
      await fs.rename(tempPath, this.tasksPath);
    } catch (writeError) {
      // Clean up temp file if it exists
      try { await fs.remove(tempPath); } catch {}
      throw new Error(`Failed to save tasks atomically: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
    }
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

