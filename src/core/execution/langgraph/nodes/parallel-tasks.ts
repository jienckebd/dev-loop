/**
 * Parallel Tasks Node
 *
 * LangGraph node that executes multiple tasks at the same dependency level concurrently.
 * Uses Promise.all with configurable concurrency limit.
 * Integrates with ParallelMetricsTracker for observability.
 */

import { Task } from '../../../../types';
import { WorkflowState, IterationLearning } from '../state';
import { TaskMasterBridge } from '../../task-bridge';
import { Config } from '../../../../config/schema/core';
import { getParallelMetricsTracker } from '../../../metrics/parallel';
import { logger } from '../../../utils/logger';

export interface ParallelTasksNodeConfig {
  taskBridge: TaskMasterBridge;
  config: Config;
  maxConcurrency: number;
  debug?: boolean;
}

export interface ParallelTaskResult {
  taskId: string;
  success: boolean;
  filesModified: string[];
  learnings: IterationLearning[];
  error?: string;
}

/**
 * Create the parallel tasks fetch node function
 *
 * This node fetches all tasks at the current dependency level and prepares them
 * for parallel execution. The actual parallel execution happens in the graph
 * by spawning multiple workflow branches.
 */
export function parallelTasks(nodeConfig: ParallelTasksNodeConfig) {
  const { taskBridge, maxConcurrency, debug } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const parallelMetrics = getParallelMetricsTracker();

    try {
      if (debug) {
        logger.debug('[ParallelTasks] Fetching tasks for parallel execution');
      }

      // Get pending tasks
      const pendingTasks = await taskBridge.getPendingTasks();

      if (pendingTasks.length === 0) {
        logger.info('[ParallelTasks] No pending tasks found');
        return {
          task: null,
          parallelTasks: [],
          status: 'complete',
        };
      }

      // Filter to code-generation tasks only (skip validation-only tasks)
      const validationOnlyStrategies = ['browser', 'drush', 'playwright', 'manual'];
      const codeTasks = pendingTasks.filter(t => {
        const testStrategy = (t as any).testStrategy as string | undefined;
        return !testStrategy || !validationOnlyStrategies.includes(testStrategy);
      });

      if (codeTasks.length === 0) {
        logger.info('[ParallelTasks] No code-generation tasks available');
        return {
          task: null,
          parallelTasks: [],
          status: 'complete',
        };
      }

      // Group tasks by dependency level
      const dependencyLevels = await taskBridge.groupTasksByDependencyLevel(codeTasks);

      if (dependencyLevels.length === 0 || dependencyLevels[0].length === 0) {
        return {
          task: null,
          parallelTasks: [],
          status: 'complete',
        };
      }

      // Get tasks from first level, limited by maxConcurrency
      const tasksToExecute = dependencyLevels[0].slice(0, maxConcurrency);

      logger.info(
        `[ParallelTasks] Selected ${tasksToExecute.length} tasks for parallel execution at level 0 (max: ${maxConcurrency})`
      );

      // Track parallel execution metrics for each task
      for (const task of tasksToExecute) {
        parallelMetrics.startAgent(
          `task-${task.id}`,
          String(task.id),
          state.prdId || 'unknown',
          state.phaseId
        );

        if (debug) {
          logger.debug(`[ParallelTasks] Queued task: ${task.id} - ${task.title}`);
        }
      }

      // Extract PRD/phase context from first task
      const firstTask = tasksToExecute[0];
      const taskDetails = firstTask.details ? JSON.parse(firstTask.details) : {};
      const prdId = taskDetails.prdId || (firstTask as any).prdId;
      const phaseId = taskDetails.phaseId || (firstTask as any).phaseId;
      const prdSetId = taskDetails.prdSetId || (firstTask as any).prdSetId;

      return {
        task: firstTask, // Primary task for fallback to sequential
        parallelTasks: tasksToExecute,
        status: 'fetching',
        dependencyLevel: 0,
        prdId,
        phaseId,
        prdSetId,
        metrics: {
          startTime: Date.now(),
          tokensUsed: { input: 0, output: 0 },
          filesChanged: 0,
          testsRun: 0,
          testsPassed: 0,
          testsFailed: 0,
          retryCount: 0,
          stallDetected: false,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[ParallelTasks] Error fetching tasks: ${errorMessage}`);

      return {
        task: null,
        parallelTasks: [],
        status: 'failed',
        error: `Failed to fetch parallel tasks: ${errorMessage}`,
      };
    }
  };
}

/**
 * Aggregate results from parallel task execution
 */
export function aggregateParallelResults(results: ParallelTaskResult[]): {
  allSuccess: boolean;
  totalFilesModified: string[];
  allLearnings: IterationLearning[];
  errors: string[];
} {
  const allSuccess = results.every(r => r.success);
  const totalFilesModified = [...new Set(results.flatMap(r => r.filesModified))];
  const allLearnings = results.flatMap(r => r.learnings);
  const errors = results.filter(r => r.error).map(r => `Task ${r.taskId}: ${r.error}`);

  return {
    allSuccess,
    totalFilesModified,
    allLearnings,
    errors,
  };
}

/**
 * Check if parallel execution should be used based on task count and config
 */
export function shouldUseParallelExecution(
  taskCount: number,
  maxConcurrency: number,
  parallelThreshold: number = 2
): boolean {
  return taskCount >= parallelThreshold && maxConcurrency > 1;
}
