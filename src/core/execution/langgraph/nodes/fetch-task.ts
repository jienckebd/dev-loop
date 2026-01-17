/**
 * Fetch Task Node
 *
 * LangGraph node that fetches the next pending task from TaskBridge.
 * Supports dependency level awareness and maxConcurrency for parallel execution.
 */

import { Task } from '../../../../types';
import { WorkflowState, RunMetrics } from '../state';
import { TaskMasterBridge } from '../../task-bridge';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';
import { emitEvent } from '../../../utils/event-stream';

export interface FetchTaskNodeConfig {
  taskBridge: TaskMasterBridge;
  config: Config;
  maxConcurrency?: number;
  debug?: boolean;
}

export interface FetchTaskResult {
  task: Task | null;
  parallelTasks?: Task[];
  context: null;
  status: 'fetching' | 'complete';
  error?: string;
  metrics?: Partial<RunMetrics>;
  dependencyLevel?: number;
  prdId?: string;
  phaseId?: number;
  prdSetId?: string;
}

/**
 * Create the fetch task node function
 */
export function fetchTask(nodeConfig: FetchTaskNodeConfig) {
  const { taskBridge, config, debug } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const startTime = Date.now();

    try {
      if (debug) {
        logger.debug('[FetchTask] Fetching next pending task');
      }

      // Get pending tasks
      const tasks = await taskBridge.getPendingTasks();

      if (tasks.length === 0) {
        logger.info('[FetchTask] No pending tasks found');
        return {
          task: null,
          status: 'complete',
          metrics: {
            startTime,
            tokensUsed: { input: 0, output: 0 },
            filesChanged: 0,
            testsRun: 0,
            testsPassed: 0,
            testsFailed: 0,
            retryCount: 0,
            stallDetected: false,
          },
        };
      }

      // Filter to code-generation tasks only (skip validation-only tasks)
      const validationOnlyStrategies = ['browser', 'drush', 'playwright', 'manual'];
      const codeTasks = tasks.filter(t => {
        const testStrategy = (t as any).testStrategy as string | undefined;
        return !testStrategy || !validationOnlyStrategies.includes(testStrategy);
      });

      const skippedValidationTasks = tasks.filter(t => {
        const testStrategy = (t as any).testStrategy as string | undefined;
        return testStrategy && validationOnlyStrategies.includes(testStrategy);
      });

      // Log skipped validation tasks
      if (skippedValidationTasks.length > 0 && debug) {
        logger.debug(`[FetchTask] Skipping ${skippedValidationTasks.length} validation task(s)`);
      }

      if (codeTasks.length === 0) {
        logger.info('[FetchTask] No code-generation tasks available');
        return {
          task: null,
          status: 'complete',
          error: skippedValidationTasks.length > 0
            ? `Only validation tasks remain (${skippedValidationTasks.length} pending)`
            : undefined,
        };
      }

      // Group tasks by dependency level
      const dependencyLevels = await taskBridge.groupTasksByDependencyLevel(codeTasks);
      const maxConcurrency = nodeConfig.maxConcurrency ||
        (config as any).autonomous?.maxConcurrency || 1;

      logger.info(`[FetchTask] Found ${codeTasks.length} task(s) in ${dependencyLevels.length} level(s), max concurrency: ${maxConcurrency}`);

      // Get tasks from first available level
      const firstLevel = dependencyLevels[0];
      if (!firstLevel || firstLevel.length === 0) {
        return {
          task: null,
          parallelTasks: [],
          status: 'complete',
        };
      }

      // Collect tasks for parallel execution (up to maxConcurrency)
      const tasksToReturn = firstLevel.slice(0, maxConcurrency);
      const selectedTask = tasksToReturn[0];

      // Extract PRD/phase context if available
      const taskDetails = selectedTask.details ? JSON.parse(selectedTask.details) : {};
      const prdId = taskDetails.prdId || (selectedTask as any).prdId;
      const phaseId = taskDetails.phaseId || (selectedTask as any).phaseId;
      const prdSetId = taskDetails.prdSetId || (selectedTask as any).prdSetId;

      // Log parallel task selection
      if (tasksToReturn.length > 1) {
        logger.info(`[FetchTask] Selected ${tasksToReturn.length} parallel tasks at level 0`);
        for (const task of tasksToReturn) {
          logger.info(`  - Task ${task.id}: ${task.title}`);
        }
      } else {
        logger.info(`[FetchTask] Selected task: ${selectedTask.id} - ${selectedTask.title}`);
      }

      // Emit task:started event for metrics tracking
      emitEvent('task:started', {
        taskId: String(selectedTask.id),
        title: selectedTask.title,
        parallelTaskCount: tasksToReturn.length,
        dependencyLevel: 0,
        durationMs: Date.now() - startTime,
      }, {
        taskId: String(selectedTask.id),
        prdId,
        phaseId,
      });

      return {
        task: selectedTask,             // Primary task for sequential processing
        parallelTasks: tasksToReturn,   // All tasks for parallel processing
        status: 'fetching',
        dependencyLevel: 0,
        prdId,
        phaseId,
        prdSetId,
        metrics: {
          startTime,
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
      logger.error(`[FetchTask] Error fetching task: ${errorMessage}`);

      return {
        task: null,
        status: 'failed',
        error: `Failed to fetch task: ${errorMessage}`,
      };
    }
  };
}

/**
 * Check if a task should be skipped based on test strategy
 */
export function isValidationOnlyTask(task: Task): boolean {
  const testStrategy = (task as any).testStrategy as string | undefined;
  const validationOnlyStrategies = ['browser', 'drush', 'playwright', 'manual'];
  return !!testStrategy && validationOnlyStrategies.includes(testStrategy);
}

/**
 * Extract PRD context from task details
 */
export function extractPrdContext(task: Task): {
  prdId?: string;
  phaseId?: number;
  prdSetId?: string;
} {
  try {
    const taskDetails = task.details ? JSON.parse(task.details) : {};
    return {
      prdId: taskDetails.prdId || (task as any).prdId,
      phaseId: taskDetails.phaseId || (task as any).phaseId,
      prdSetId: taskDetails.prdSetId || (task as any).prdSetId,
    };
  } catch {
    return {};
  }
}
