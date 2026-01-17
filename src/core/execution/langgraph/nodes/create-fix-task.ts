/**
 * Create Fix Task Node
 *
 * LangGraph node that creates a fix task when tests fail.
 * The fix task will be picked up in the next iteration.
 */

import { Task } from '../../../../types';
import { WorkflowState } from '../state';
import { TaskMasterBridge } from '../../task-bridge';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';
import { emitEvent } from '../../../utils/event-stream';

export interface CreateFixTaskNodeConfig {
  taskBridge: TaskMasterBridge;
  config: Config;
  debug?: boolean;
}

/**
 * Create the create fix task node function
 */
export function createFixTask(nodeConfig: CreateFixTaskNodeConfig) {
  const { taskBridge, config, debug } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    // Skip if tests passed
    if (state.testResult?.success) {
      logger.warn('[CreateFixTask] Tests passed, no fix task needed');
      return {
        status: 'creating-fix',
        fixTask: null,
      };
    }

    // Skip if no analysis available
    if (!state.logAnalysis) {
      logger.warn('[CreateFixTask] No failure analysis, cannot create fix task');
      return {
        status: 'creating-fix',
        fixTask: null,
      };
    }

    try {
      if (debug) {
        logger.debug('[CreateFixTask] Creating fix task');
      }

      // Build fix task from analysis
      const originalTask = state.task;
      const analysis = state.logAnalysis;

      const fixTask: Task = {
        id: `fix-${originalTask?.id || Date.now()}`,
        title: `Fix: ${analysis.summary || 'Test failure'}`,
        description: buildFixDescription(state),
        status: 'pending',
        priority: 'high',
        dependencies: originalTask ? [originalTask.id] : undefined,
        details: JSON.stringify({
          originalTaskId: originalTask?.id,
          errors: analysis.errors,
          recommendations: analysis.recommendations,
          testOutput: state.testResult?.output?.substring(0, 2000),
          prdId: state.prdId,
          phaseId: state.phaseId,
          prdSetId: state.prdSetId,
        }),
        taskType: 'fix',
      };

      // Add fix task to TaskBridge
      await taskBridge.createTask(fixTask);

      logger.info(`[CreateFixTask] Created fix task: ${fixTask.id}`);

      // Emit fix_task:created event
      emitEvent('fix_task:created', {
        taskId: fixTask.id,
        originalTaskId: originalTask?.id,
        errorCount: analysis.errors?.length || 0,
        recommendationCount: analysis.recommendations?.length || 0,
      }, {
        taskId: originalTask ? String(originalTask.id) : undefined,
        prdId: state.prdId,
        phaseId: state.phaseId,
      });

      return {
        status: 'creating-fix',
        fixTask,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CreateFixTask] Error: ${errorMessage}`);

      return {
        status: 'failed',
        fixTask: null,
        error: `Failed to create fix task: ${errorMessage}`,
      };
    }
  };
}

/**
 * Build fix task description from state
 */
function buildFixDescription(state: WorkflowState): string {
  const parts: string[] = [];

  // Original task context
  if (state.task) {
    parts.push(`Original task: ${state.task.title}`);
    parts.push('');
  }

  // Errors
  if (state.logAnalysis?.errors?.length) {
    parts.push('## Errors');
    for (const error of state.logAnalysis.errors) {
      parts.push(`- ${error}`);
    }
    parts.push('');
  }

  // Recommendations
  if (state.logAnalysis?.recommendations?.length) {
    parts.push('## Recommendations');
    for (const rec of state.logAnalysis.recommendations) {
      parts.push(`- ${rec}`);
    }
    parts.push('');
  }

  // Files modified
  if (state.filesModified?.length) {
    parts.push('## Files to Review');
    for (const file of state.filesModified) {
      parts.push(`- ${file}`);
    }
    parts.push('');
  }

  // Test output summary
  if (state.testResult?.output) {
    parts.push('## Test Output (truncated)');
    const output = state.testResult.output;
    // Extract key error lines
    const errorLines = output.split('\n')
      .filter(line => /error|failed|exception/i.test(line))
      .slice(0, 10);
    parts.push('```');
    parts.push(errorLines.join('\n') || output.substring(0, 500));
    parts.push('```');
  }

  return parts.join('\n');
}

/**
 * Check if we should create a fix task
 */
export function shouldCreateFixTask(state: WorkflowState): boolean {
  // No fix task if tests passed
  if (state.testResult?.success) {
    return false;
  }

  // No fix task if no analysis
  if (!state.logAnalysis) {
    return false;
  }

  // Check for stall (too many retries)
  if (state.metrics?.stallDetected) {
    return false; // Let suggestImprovements handle this
  }

  return true;
}
