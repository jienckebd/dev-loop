import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Config } from '../../config/schema/core';
import { Task, TaskStatus, TaskType } from '../../types';
import { emitEvent } from '../utils/event-stream';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export class TaskMasterBridge {
  private tasksPath: string;
  private retryCountsPath: string;
  private originalFormat: 'array' | 'tasks' | 'master' = 'master';
  private taskRetryCount: Map<string, number> = new Map();
  private maxRetries: number = 3;

  constructor(private config: Config) {
    this.tasksPath = path.resolve(process.cwd(), config.taskMaster.tasksPath);
    this.retryCountsPath = path.resolve(process.cwd(), '.devloop/retry-counts.json');
    // Allow config override for maxRetries
    this.maxRetries = (config as any).maxRetries || 3;
    // Load persisted retry counts (fire and forget - don't block constructor)
    this.loadRetryCountsFromFile().catch(err => {
      console.warn('[TaskBridge] Could not load retry counts in constructor:', err);
    });
  }

  /**
   * Load retry counts from persistent storage (simple JSON file)
   */
  private async loadRetryCountsFromFile(): Promise<void> {
    try {
      if (await fs.pathExists(this.retryCountsPath)) {
        const data = await fs.readJson(this.retryCountsPath);
        this.taskRetryCount = new Map(Object.entries(data));
        console.log(`[TaskBridge] Loaded ${this.taskRetryCount.size} retry counts from ${this.retryCountsPath}`);
      }
    } catch (err) {
      // Start fresh if file is corrupted
      console.warn('[TaskBridge] Could not load retry counts, starting fresh:', err);
      this.taskRetryCount = new Map();
    }
  }

  /**
   * Save retry counts to persistent storage (simple JSON file)
   */
  private async saveRetryCountsToFile(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.retryCountsPath));
      await fs.writeJson(this.retryCountsPath, Object.fromEntries(this.taskRetryCount), { spaces: 2 });
    } catch (err) {
      console.warn('[TaskBridge] Could not save retry counts:', err);
    }
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
  async incrementRetryCount(taskId: string | number): Promise<number> {
    const baseId = this.getBaseTaskId(taskId);
    const count = (this.taskRetryCount.get(baseId) || 0) + 1;
    this.taskRetryCount.set(baseId, count);
    await this.saveRetryCountsToFile();
    return count;
  }

  /**
   * Reset retry count for a task (allows unblocking)
   */
  async resetRetryCount(taskId: string | number): Promise<void> {
    const baseId = this.getBaseTaskId(taskId);
    this.taskRetryCount.delete(baseId);
    await this.saveRetryCountsToFile();
    console.log(`[TaskBridge] Reset retry count for task ${baseId}`);
  }

  /**
   * Get all retry counts (for diagnostics)
   */
  getAllRetryCounts(): Record<string, number> {
    return Object.fromEntries(this.taskRetryCount);
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

  /**
   * Infer task type from task title and description
   *
   * Heuristics:
   * - "investigate", "investigation", "analyze", "analysis" -> investigate/analysis
   * - "fix", "fix:", "resolve", "correct" -> fix
   * - "generate", "create", "implement", "add" -> generate
   * - Default: generate (assumes code generation unless explicitly marked as analysis)
   */
  inferTaskType(task: Task | Partial<Task>): TaskType {
    // Return explicit task type if set
    if (task.taskType) {
      return task.taskType;
    }

    const title = (task.title || '').toLowerCase();
    const description = (task.description || '').toLowerCase();
    const combined = `${title} ${description}`;

    // Investigation/analysis tasks
    if (
      combined.includes('investigate') ||
      combined.includes('investigation') ||
      combined.includes('analyze') ||
      combined.includes('analysis') ||
      combined.includes('why') ||
      combined.includes('root cause') ||
      combined.includes('diagnose') ||
      combined.includes('debug')
    ) {
      // If it's asking to investigate a failure, it's an investigate task
      if (combined.includes('failure') || combined.includes('error') || combined.includes('issue')) {
        return 'investigate';
      }
      // Otherwise it's a general analysis
      return 'analysis';
    }

    // Fix tasks (fixing existing code)
    if (
      title.startsWith('fix') ||
      title.startsWith('fix:') ||
      combined.includes('fix') ||
      combined.includes('resolve') ||
      combined.includes('correct') ||
      combined.includes('repair') ||
      combined.includes('patch')
    ) {
      return 'fix';
    }

    // Generate tasks (creating new code)
    // Default assumption: most tasks are code generation tasks
    return 'generate';
  }

  async getPendingTasks(): Promise<Task[]> {
    try {
      const tasks = await this.loadTasks();

      // Get active prdSetId from execution state to filter by PRD set
      let activePrdSetId: string | undefined;
      try {
        const stateFilePath = path.resolve(process.cwd(), '.devloop/execution-state.json');
        if (await fs.pathExists(stateFilePath)) {
          const stateData = await fs.readJson(stateFilePath);
          activePrdSetId = stateData.active?.prdSetId;
        }
      } catch (err) {
        console.warn('[TaskBridge] Could not read active prdSetId from execution state:', err);
      }

      // Filter by active prdSetId if one is set
      let filteredTasks = tasks;
      if (activePrdSetId) {
        filteredTasks = tasks.filter(t => {
          try {
            const details = t.details ? JSON.parse(t.details) : {};
            return details.prdSetId === activePrdSetId;
          } catch {
            return false; // Skip tasks with invalid details
          }
        });
        console.log(`[TaskBridge] Filtered to ${filteredTasks.length} tasks for active PRD set: ${activePrdSetId}`);
      }

      // Filter out tasks with null/undefined IDs before processing
      const validTasks = filteredTasks.filter((t) => t.id != null);
      if (validTasks.length < filteredTasks.length) {
        console.warn(`[TaskBridge] Filtered out ${filteredTasks.length - validTasks.length} tasks with null/undefined IDs`);
      }
      // Include both "pending" and "in-progress" tasks (in-progress means it was interrupted)
      const pending = validTasks.filter((t) => t.status === 'pending' || t.status === 'in-progress');

      // Filter out tasks that have exceeded max retries
      const eligibleTasks = pending.filter(t => {
        if (!t.id) return false; // Skip tasks without IDs
        return !this.hasExceededMaxRetries(t.id);
      });

      // Filter out tasks whose dependencies haven't been completed
      const completedTaskIds = new Set(
        tasks.filter(t => t.status === 'done').map(t => String(t.id))
      );
      const readyTasks = eligibleTasks.filter(t => {
        const deps = (t as any).dependencies || [];
        if (deps.length === 0) return true;
        // All dependencies must be completed
        return deps.every((depId: string | number) => completedTaskIds.has(String(depId)));
      });

      // Debug logging for contribution mode
      if (readyTasks.length === 0 && pending.length > 0) {
        console.log(`[TaskBridge] getPendingTasks: ${pending.length} pending tasks, but ${eligibleTasks.length} eligible after retry filter`);
        console.log(`[TaskBridge] Completed task IDs:`, Array.from(completedTaskIds).slice(0, 10));
        const blockedByDeps = eligibleTasks.filter(t => {
          const deps = (t as any).dependencies || [];
          if (deps.length === 0) return false;
          return !deps.every((depId: string | number) => completedTaskIds.has(String(depId)));
        });
        if (blockedByDeps.length > 0) {
          console.log(`[TaskBridge] ${blockedByDeps.length} tasks blocked by dependencies:`, blockedByDeps.map(t => ({ id: t.id, deps: (t as any).dependencies })).slice(0, 5));
        }
        // Show tasks with no dependencies that should be ready
        const noDepTasks = eligibleTasks.filter(t => {
          const deps = (t as any).dependencies || [];
          return deps.length === 0;
        });
        if (noDepTasks.length > 0) {
          console.log(`[TaskBridge] ${noDepTasks.length} tasks with no dependencies (should be ready):`, noDepTasks.map(t => ({ id: t.id, title: t.title?.substring(0, 50) })));
        } else if (eligibleTasks.length > 0) {
          console.log(`[TaskBridge] All ${eligibleTasks.length} eligible tasks have dependencies`);
        }
      }

      // Sort by priority and prefer original tasks over fix tasks
      return readyTasks.sort((a, b) => {
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
      // Compare as string since task IDs can be numbers or strings
      const task = tasks.find((t) => String(t.id) === String(taskId));
      if (task) {
        task.status = status;
        await this.saveTasks(tasks);
        logger.info(`[TaskBridge] Updated task ${taskId} status to ${status}`);
      } else {
        throw new Error(`Task not found: ${taskId}`);
      }
    } catch (error) {
      throw new Error(`Failed to update task status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update task properties (beyond just status)
   */
  async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
    try {
      const tasks = await this.loadTasks();
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        Object.assign(task, updates);
        await this.saveTasks(tasks);
      } else {
        throw new Error(`Task not found: ${taskId}`);
      }
    } catch (error) {
      throw new Error(`Failed to update task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async createTask(task: Omit<Task, 'status'> & { status?: TaskStatus }): Promise<Task> {
    try {
      const tasks = await this.loadTasks();

      // Defensive check - ensure tasks is an array
      if (!Array.isArray(tasks)) {
        throw new Error(`loadTasks returned non-array: ${typeof tasks}`);
      }

      // Check for duplicate task ID - skip if task with same ID already exists
      const existingTask = tasks.find(t => t.id === task.id);
      if (existingTask) {
        const existingPrdSetId = (existingTask as any).prdSetId;
        const newPrdSetId = (task as any).prdSetId;

        // If task exists but from different PRD set, update it to current PRD set
        if (existingPrdSetId && newPrdSetId && existingPrdSetId !== newPrdSetId) {
          console.log(`[TaskBridge] Task ${task.id} exists from PRD set ${existingPrdSetId}, updating to ${newPrdSetId}`);
          // Update prdSetId in task details
          const taskDetails = existingTask.details ? JSON.parse(existingTask.details) : {};
          taskDetails.prdSetId = newPrdSetId;
          await this.updateTask(task.id, {
            details: JSON.stringify(taskDetails),
          } as any);
          // Also update the task object directly if it has prdSetId property
          (existingTask as any).prdSetId = newPrdSetId;
          await this.saveTasks(tasks);
          return existingTask;
        }

        // Otherwise, skip as before
        console.log(`[TaskBridge] Task ${task.id} already exists (status: ${existingTask.status}), skipping creation`);
        return existingTask;
      }

      const newTask: Task = {
        ...task,
        status: (task.status || 'pending') as TaskStatus,
        // Infer task type if not explicitly provided
        taskType: task.taskType || this.inferTaskType(task as Task),
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
    const retryCount = await this.incrementRetryCount(originalTaskId);
    if (retryCount > this.maxRetries) {
      console.log(`[TaskBridge] Task ${originalTaskId} has exceeded max retries (${this.maxRetries}), marking as blocked`);

      // Emit task blocked event
      emitEvent('task:blocked', {
        taskId: originalTaskId,
        reason: `Exceeded max retries (${this.maxRetries})`,
        retryCount,
        maxRetries: this.maxRetries,
        lastError: errorDescription.substring(0, 500),
      }, {
        severity: 'error',
        taskId: originalTaskId,
      });

      // Mark the task as blocked instead of creating another fix task
      await this.updateTaskStatus(originalTaskId, 'blocked' as TaskStatus);
      return null;
    }

    // Check if a fix task already exists for this original task
    const existingTasks = await this.loadTasks();
    const existingFixTask = existingTasks.find(t =>
      t.id.startsWith(`fix-${originalTaskId}-`) &&
      (t.status === 'pending' || t.status === 'in-progress')
    );

    if (existingFixTask) {
      console.log(`[TaskBridge] Fix task already exists for ${originalTaskId}: ${existingFixTask.id}, skipping duplicate creation`);
      return existingFixTask;
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
    const errorGuidanceStart = Date.now();
    const guidance = this.getErrorGuidance(errorDescription);
    const errorGuidanceDuration = Date.now() - errorGuidanceStart;

    // Track error guidance feature if guidance was provided
    // Note: Feature tracking will be done at workflow level when fix task is executed
    // We track here that guidance was generated, but actual usage is tracked when applied

    return this.createTask({
      id: `fix-${originalTaskId}-${Date.now()}`,
      title: `Fix: ${originalTask.title} (attempt ${retryCount})`,
      description: `Fix issues in ${originalTask.title}\n\nAttempt: ${retryCount}/${this.maxRetries}\n\nError: ${errorDescription}${lineContext}${fileContext}${guidance}\n\nTest Output:\n${testOutput}`,
      priority: 'critical', // Fix tasks are always critical
      dependencies: [originalTaskId],
      details: originalTask.details, // Preserve original task details
      taskType: 'fix', // Fix tasks are explicitly 'fix' type
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
   * Assign IDs to tasks that have null/undefined IDs
   * This fixes issues with task-master generating tasks without proper IDs
   */
  private assignMissingIds(tasks: Task[]): Task[] {
    let modified = false;
    let nextId = 1;
    const timestamp = Date.now();

    // Load idPattern from active PRD set if available
    const idPattern = this.loadIdPatternFromPrdSet();

    for (const task of tasks) {
      if (task.id == null || task.id === undefined || task.id === '') {
        // Generate a unique ID
        if (idPattern) {
          // Use the PRD set's idPattern
          task.id = idPattern.replace('{id}', String(nextId));
        } else {
          // Fallback: use generic pattern
          task.id = `TASK-${nextId}-${timestamp}`;
        }
        console.log(`[TaskBridge] Assigned ID "${task.id}" to task: ${task.title?.substring(0, 50)}`);
        modified = true;
        nextId++;
      }
    }

    // If we modified any tasks, save them back to file
    if (modified) {
      console.log(`[TaskBridge] Assigned IDs to ${nextId - 1} tasks with missing IDs`);
      // Save asynchronously - don't block
      this.saveTasks(tasks).catch(err => {
        console.warn(`[TaskBridge] Failed to save tasks after ID assignment: ${err}`);
      });
    }

    return tasks;
  }

  /**
   * Load idPattern from active PRD set index file
   */
  private loadIdPatternFromPrdSet(): string | null {
    try {
      const planningDir = (this.config as any).taskMaster?.planningDir || '.taskmaster/planning';
      const cwd = process.cwd();
      const fullPlanningDir = path.join(cwd, planningDir);

      if (!fs.existsSync(fullPlanningDir)) {
        return null;
      }

      // Look for PRD set index files
      const entries = fs.readdirSync(fullPlanningDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const indexPath = path.join(fullPlanningDir, entry.name, 'index.md.yml');
          if (fs.existsSync(indexPath)) {
            try {
              const content = fs.readFileSync(indexPath, 'utf-8');
              // Simple YAML parse for idPattern
              const idPatternMatch = content.match(/idPattern:\s*["']?([^"'\n]+)["']?/);
              if (idPatternMatch) {
                const pattern = idPatternMatch[1].trim();
                if (pattern.includes('{id}')) {
                  console.log(`[TaskBridge] Found idPattern "${pattern}" from ${entry.name}`);
                  return pattern;
                }
              }
            } catch (parseError) {
              // Skip this PRD set
            }
          }
        }
      }

      return null;
    } catch (error) {
      return null;
    }
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
          // Infer task type if not set
          if (!task.taskType) {
            task.taskType = this.inferTaskType(task);
          }
          allTasks.push(task);
          // Add pending subtasks as separate tasks
          if (task.subtasks && Array.isArray(task.subtasks)) {
            for (const subtask of task.subtasks) {
              if (subtask.status === 'pending') {
                // Infer task type for subtask if not set
                const subtaskWithType: Task = {
                  ...subtask,
                  id: `${task.id}.${subtask.id}`,
                  parentId: task.id,
                  priority: subtask.priority || task.priority || 'medium',
                };
                if (!subtaskWithType.taskType) {
                  subtaskWithType.taskType = this.inferTaskType(subtaskWithType);
                }
                allTasks.push(subtaskWithType);
              }
            }
          }
        }

        // Assign IDs to tasks with null/undefined IDs
        const tasksWithIds = this.assignMissingIds(allTasks);

        // Ensure all tasks have taskType inferred (for any tasks without IDs that couldn't be inferred above)
        const tasksWithTypes = tasksWithIds.map(task => {
          if (!task.taskType) {
            task.taskType = this.inferTaskType(task);
          }
          return task;
        });

        const pending = tasksWithTypes.filter(t => t.status === 'pending');
        console.log(`[TaskBridge] Loaded ${rawTasks.length} tasks, ${pending.length} pending (including subtasks)`);
        return tasksWithTypes;
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

    // Defensive check - ensure tasks is an array
    if (!Array.isArray(tasks)) {
      console.error('[TaskBridge] saveTasks received non-array:', typeof tasks);
      throw new Error('saveTasks: tasks must be an array');
    }

    // Always use master format to preserve Task Master CLI compatibility
    const originalFormat = 'master';
    console.log(`[TaskBridge] Saving ${tasks.length} tasks in ${originalFormat} format`);

    // Reconstruct tasks with subtasks (tasks with parentId go back to parent's subtasks array)
    const mainTasks: Task[] = [];
    const subtaskMap = new Map<string, Task[]>();

    try {
      for (const task of tasks) {
        if (task.parentId) {
          // This is a subtask - add to parent's subtasks
          const parentId = String(task.parentId);
          if (!subtaskMap.has(parentId)) {
            subtaskMap.set(parentId, []);
          }
          // Remove parentId and restore original ID
          const { parentId: _, id, ...subtaskData } = task;
          // Defensive check for null/undefined IDs
          if (!id) {
            console.warn(`[TaskBridge] Skipping subtask with null/undefined ID for parent ${parentId}`);
            continue;
          }
          const originalSubtaskId = String(id).split('.').pop() || String(id);
          const subtaskArray = subtaskMap.get(parentId);
          if (subtaskArray) {
            subtaskArray.push({
              ...subtaskData,
              id: originalSubtaskId,
            } as Task);
          }
        } else {
          mainTasks.push(task);
        }
      }

      // Attach subtasks back to parent tasks
      for (const task of mainTasks) {
        // Defensive check for null/undefined IDs
        if (!task.id) {
          console.warn(`[TaskBridge] Skipping task with null/undefined ID: ${JSON.stringify(task.title || 'unknown')}`);
          continue;
        }
        const taskIdKey = String(task.id);
        if (subtaskMap.has(taskIdKey)) {
          task.subtasks = subtaskMap.get(taskIdKey)!;
        }
      }
    } catch (processError) {
      console.error('[TaskBridge] Error processing tasks for save:', processError);
      if (processError instanceof Error && processError.stack) {
        console.error('[TaskBridge] Stack:', processError.stack);
      }
      throw processError;
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

    // Atomic write: write to temp file first, then rename (unique per process/time to avoid conflicts)
    // Use crypto.randomUUID for better uniqueness in concurrent scenarios
    const crypto = require('crypto');
    let retries = 3;
    let lastError: Error | null = null;

    while (retries > 0) {
      const tempPath = `${this.tasksPath}.${process.pid}.${Date.now()}.${crypto.randomUUID().substring(0, 8)}.tmp`;
      try {
        // Validate JSON before writing
        const jsonString = JSON.stringify(output, null, 2);
        JSON.parse(jsonString); // Validate it's valid JSON

        await fs.writeFile(tempPath, jsonString, 'utf-8');

        // Retry rename with exponential backoff if file was deleted by another process
        let renameRetries = 3;
        while (renameRetries > 0) {
          try {
            await fs.rename(tempPath, this.tasksPath);
            return; // Success
          } catch (renameError: any) {
            if (renameError.code === 'ENOENT' && renameRetries > 1) {
              // File was deleted/renamed by another process, wait and retry
              await new Promise(resolve => setTimeout(resolve, 50 * (4 - renameRetries)));
              renameRetries--;
              continue;
            }
            throw renameError;
          }
        }
      } catch (error: any) {
        lastError = error;
        retries--;
        // Clean up temp file if it exists
        try {
          if (await fs.pathExists(tempPath)) {
            await fs.remove(tempPath);
          }
        } catch {
          // Ignore cleanup errors
        }
        if (retries > 0) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 100 * (4 - retries)));
        }
      }
    }

    // All retries failed
    throw new Error(`Failed to save tasks atomically after 3 retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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

  /**
   * Group tasks by dependency level for parallel execution
   *
   * Returns an array of arrays, where each inner array contains tasks
   * that can be executed in parallel (same dependency level).
   *
   * Level 0: Tasks with no dependencies
   * Level 1: Tasks that depend only on level 0 tasks
   * Level 2: Tasks that depend on level 0 or 1 tasks
   * etc.
   */
  async groupTasksByDependencyLevel(tasks: Task[]): Promise<Task[][]> {
    const levels: Task[][] = [];
    const processed = new Set<string>();
    const taskMap = new Map<string, Task>();

    // Build task map for quick lookup
    for (const task of tasks) {
      taskMap.set(String(task.id), task);
    }

    // Helper to check if all dependencies are satisfied (completed or in a previous level)
    const allDependenciesSatisfied = (task: Task, satisfiedIds: Set<string>): boolean => {
      if (!task.dependencies || task.dependencies.length === 0) {
        return true;
      }
      return task.dependencies.every(depId => satisfiedIds.has(String(depId)));
    };

    // Get all completed task IDs (these are always "satisfied")
    const allTasks = await this.getAllTasks();
    const completedTaskIds = new Set(
      allTasks
        .filter(t => t.status === 'done')
        .map(t => String(t.id))
    );

    let currentLevel = 0;
    let remainingTasks = [...tasks];
    const satisfiedIds = new Set<string>(completedTaskIds);

    while (remainingTasks.length > 0) {
      const levelTasks: Task[] = [];
      const newSatisfiedIds = new Set<string>(satisfiedIds);

      // Find tasks that can be executed at this level
      for (const task of remainingTasks) {
        const taskId = String(task.id);
        if (processed.has(taskId)) {
          continue;
        }

        if (allDependenciesSatisfied(task, satisfiedIds)) {
          levelTasks.push(task);
          processed.add(taskId);
          newSatisfiedIds.add(taskId);
        }
      }

      if (levelTasks.length === 0) {
        // No tasks can be executed - might be circular dependency or missing dependencies
        // Add remaining tasks to current level to prevent infinite loop
        console.warn(`[TaskBridge] No tasks can be executed at level ${currentLevel}. Remaining: ${remainingTasks.length}`);
        for (const task of remainingTasks) {
          if (!processed.has(String(task.id))) {
            levelTasks.push(task);
            processed.add(String(task.id));
          }
        }
      }

      if (levelTasks.length > 0) {
        levels.push(levelTasks);
        // Update satisfied IDs for next level
        for (const task of levelTasks) {
          satisfiedIds.add(String(task.id));
        }
      }

      // Update remaining tasks
      remainingTasks = remainingTasks.filter(t => !processed.has(String(t.id)));

      currentLevel++;
      if (currentLevel > 100) {
        // Safety check to prevent infinite loops
        console.error('[TaskBridge] Maximum dependency levels reached (100), stopping');
        break;
      }
    }

    return levels;
  }
}

