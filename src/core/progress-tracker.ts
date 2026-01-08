/**
 * Progress Tracker
 *
 * Provides real-time progress tracking for dev-loop operations,
 * including task status updates, progress bars, and event emission.
 */

import { EventEmitter } from 'events';
import { Task, TaskStatus } from '../types';
import { logger } from './logger';

export interface ProgressEvent {
  type: 'task-start' | 'task-complete' | 'task-fail' | 'task-update' | 'progress';
  taskId?: string;
  taskTitle?: string;
  status?: TaskStatus;
  progress?: number;
  total?: number;
  message?: string;
  error?: string;
  timestamp: number;
}

export interface ProgressBarOptions {
  total: number;
  current: number;
  width?: number;
  showPercentage?: boolean;
  showCount?: boolean;
}

/**
 * Progress tracker for dev-loop operations
 */
export class ProgressTracker extends EventEmitter {
  private activeTasks: Map<string, { task: Task; startTime: number }> = new Map();
  private completedTasks: number = 0;
  private failedTasks: number = 0;
  private totalTasks: number = 0;

  /**
   * Track task start
   */
  trackTaskStart(task: Task): void {
    this.activeTasks.set(task.id, {
      task,
      startTime: Date.now(),
    });

    this.emit('task-start', {
      type: 'task-start',
      taskId: task.id,
      taskTitle: task.title,
      status: task.status,
      timestamp: Date.now(),
    } as ProgressEvent);

    logger.info(`[ProgressTracker] Task started: ${task.id} - ${task.title}`);
  }

  /**
   * Track task completion
   */
  trackTaskComplete(taskId: string, success: boolean = true): void {
    const activeTask = this.activeTasks.get(taskId);
    if (!activeTask) {
      logger.warn(`[ProgressTracker] Task ${taskId} not found in active tasks`);
      return;
    }

    const duration = Date.now() - activeTask.startTime;
    this.activeTasks.delete(taskId);

    if (success) {
      this.completedTasks++;
    } else {
      this.failedTasks++;
    }

    this.emit('task-complete', {
      type: success ? 'task-complete' : 'task-fail',
      taskId,
      taskTitle: activeTask.task.title,
      status: success ? 'done' : 'blocked',
      timestamp: Date.now(),
      message: success ? 'Task completed successfully' : 'Task failed',
    } as ProgressEvent);

    logger.info(`[ProgressTracker] Task ${success ? 'completed' : 'failed'}: ${taskId} (${duration}ms)`);

    // Emit progress update
    this.emitProgress();
  }

  /**
   * Track task failure
   */
  trackTaskFail(taskId: string, error: string): void {
    this.trackTaskComplete(taskId, false);

    this.emit('task-fail', {
      type: 'task-fail',
      taskId,
      error,
      timestamp: Date.now(),
    } as ProgressEvent);
  }

  /**
   * Track task status update
   */
  trackTaskUpdate(taskId: string, status: TaskStatus, message?: string): void {
    const activeTask = this.activeTasks.get(taskId);

    this.emit('task-update', {
      type: 'task-update',
      taskId,
      taskTitle: activeTask?.task.title,
      status,
      message,
      timestamp: Date.now(),
    } as ProgressEvent);

    logger.debug(`[ProgressTracker] Task update: ${taskId} -> ${status}${message ? `: ${message}` : ''}`);
  }

  /**
   * Set total number of tasks
   */
  setTotalTasks(total: number): void {
    this.totalTasks = total;
    this.emitProgress();
    logger.info(`[ProgressTracker] Total tasks: ${total}`);
  }

  /**
   * Get current progress percentage
   */
  getProgress(): number {
    if (this.totalTasks === 0) {
      return 0;
    }
    const completed = this.completedTasks + this.failedTasks;
    return Math.round((completed / this.totalTasks) * 100);
  }

  /**
   * Get progress summary
   */
  getProgressSummary(): {
    total: number;
    completed: number;
    failed: number;
    active: number;
    progress: number;
  } {
    return {
      total: this.totalTasks,
      completed: this.completedTasks,
      failed: this.failedTasks,
      active: this.activeTasks.size,
      progress: this.getProgress(),
    };
  }

  /**
   * Emit progress event
   */
  private emitProgress(): void {
    const summary = this.getProgressSummary();

    this.emit('progress', {
      type: 'progress',
      progress: summary.progress,
      total: summary.total,
      message: `${summary.completed + summary.failed}/${summary.total} tasks completed (${summary.progress}%)`,
      timestamp: Date.now(),
    } as ProgressEvent);
  }

  /**
   * Generate progress bar string
   */
  generateProgressBar(options: ProgressBarOptions): string {
    const {
      total,
      current,
      width = 40,
      showPercentage = true,
      showCount = true,
    } = options;

    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
    const filled = Math.round((current / total) * width);
    const empty = width - filled;

    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    let result = `[${bar}]`;

    if (showPercentage) {
      result += ` ${percentage}%`;
    }

    if (showCount) {
      result += ` (${current}/${total})`;
    }

    return result;
  }

  /**
   * Display progress bar to console
   */
  displayProgressBar(): void {
    const summary = this.getProgressSummary();
    if (summary.total === 0) {
      return;
    }

    const bar = this.generateProgressBar({
      total: summary.total,
      current: summary.completed + summary.failed,
      width: 30,
      showPercentage: true,
      showCount: true,
    });

    const activeInfo = summary.active > 0 ? ` | ${summary.active} active` : '';
    const failedInfo = summary.failed > 0 ? ` | ${summary.failed} failed` : '';

    process.stdout.write(`\r${bar}${activeInfo}${failedInfo}`);
  }

  /**
   * Reset tracker
   */
  reset(): void {
    this.activeTasks.clear();
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.totalTasks = 0;
    logger.debug('[ProgressTracker] Reset');
  }

  /**
   * Get active tasks
   */
  getActiveTasks(): Task[] {
    return Array.from(this.activeTasks.values()).map(t => t.task);
  }
}
