/**
 * Build Context Node
 *
 * LangGraph node that builds the codebase context for a task.
 * Extracts relevant files, generates file guidance, and creates the TaskContext.
 */

import { TaskContext, Task } from '../../../../types';
import { WorkflowState } from '../state';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';
import { CodeContextProvider } from '../../../analysis/code/context-provider';
import { getParallelMetricsTracker } from '../../../metrics/parallel';

export interface BuildContextNodeConfig {
  config: Config;
  codeContextProvider: CodeContextProvider;
  debug?: boolean;
  // Callbacks for metrics tracking
  onContextBuilt?: (contextSize: number, filesIncluded: number, duration: number) => void;
}

export interface ContextBuildResult {
  codebaseContext: string;
  targetFiles?: string;
  existingCode?: string;
  fileGuidance?: string;
}

/**
 * Create the build context node function
 */
export function buildContext(nodeConfig: BuildContextNodeConfig) {
  const { config, codeContextProvider, debug, onContextBuilt } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const startTime = Date.now();

    // Skip if no task
    if (!state.task) {
      logger.warn('[BuildContext] No task in state, skipping context build');
      return {
        status: 'building-context',
        context: null,
      };
    }

    try {
      if (debug) {
        logger.debug(`[BuildContext] Building context for task: ${state.task.id}`);
      }

      // Build codebase context using CodeContextProvider
      const contextResult = await buildCodebaseContext(
        state.task,
        codeContextProvider,
        config,
        debug
      );

      const contextBuildDuration = Date.now() - startTime;
      const contextSize = contextResult.codebaseContext?.length || 0;
      const filesIncluded = contextResult.targetFiles
        ? contextResult.targetFiles.split('\n').filter(f => f.trim()).length
        : 0;

      // Track metrics
      if (onContextBuilt) {
        onContextBuilt(contextSize, filesIncluded, contextBuildDuration);
      }

      // Track context metrics in parallel metrics tracker
      try {
        const parallelMetrics = getParallelMetricsTracker();
        const execution = parallelMetrics.getCurrentExecution();
        if (execution) {
          // Context size contributes to token usage estimation
          const estimatedTokens = Math.ceil(contextSize / 4); // ~4 chars per token
          execution.tokens.totalInput += estimatedTokens;
        }
      } catch {
        // Ignore metrics errors
      }

      // Generate file-specific guidance
      let fileGuidance = '';
      if ((config as any).context?.includeSkeleton !== false && contextResult.targetFiles) {
        const primaryFile = contextResult.targetFiles.split('\n')[0];
        if (primaryFile) {
          try {
            fileGuidance = await codeContextProvider.generateFileGuidance(primaryFile);
          } catch (error) {
            if (debug) {
              logger.debug(`[BuildContext] Failed to generate file guidance: ${error}`);
            }
          }
        }
      }

      // Create task context
      const taskContext: TaskContext = {
        task: state.task,
        codebaseContext: contextResult.codebaseContext,
        projectFiles: contextResult.targetFiles?.split('\n').filter(Boolean),
        prdId: state.prdId,
        phaseId: state.phaseId,
        prdSetId: state.prdSetId,
      };

      logger.info(`[BuildContext] Built context: ${contextSize} chars, ${filesIncluded} files, ${contextBuildDuration}ms`);

      return {
        context: taskContext,
        status: 'building-context',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[BuildContext] Error building context: ${errorMessage}`);

      return {
        context: null,
        status: 'failed',
        error: `Failed to build context: ${errorMessage}`,
      };
    }
  };
}

/**
 * Build codebase context for a task
 * Simplified version of workflow.ts getCodebaseContext()
 */
async function buildCodebaseContext(
  task: Task,
  codeContextProvider: CodeContextProvider,
  config: Config,
  debug?: boolean
): Promise<ContextBuildResult> {
  const taskText = `${task.title} ${task.description} ${task.details || ''}`;

  try {
    // Extract file paths mentioned in the task
    const mentionedFiles = extractFilePaths(taskText);

    if (mentionedFiles.length === 0) {
      if (debug) {
        logger.debug('[BuildContext] No files mentioned in task');
      }
      return {
        codebaseContext: '',
        targetFiles: '',
      };
    }

    // Build context from files using CodeContextProvider
    const fileContents: string[] = [];
    const targetFiles: string[] = [];

    for (const file of mentionedFiles) {
      try {
        // Get file context (skeleton with imports and signatures)
        const fileContext = await codeContextProvider.getFileContext(file);
        if (fileContext) {
          const contextStr = [
            `\n### File: ${file}`,
            `#### Imports:`,
            fileContext.imports.join('\n'),
            `#### Structure:`,
            fileContext.skeleton,
          ].join('\n');
          fileContents.push(contextStr);
          targetFiles.push(file);
        }
      } catch (error) {
        if (debug) {
          logger.debug(`[BuildContext] Failed to get context for ${file}: ${error}`);
        }
      }
    }

    // Apply max context limit
    const maxContextChars = config.ai.maxContextChars || 100000;
    let codebaseContext = fileContents.join('\n');

    if (codebaseContext.length > maxContextChars) {
      codebaseContext = codebaseContext.substring(0, maxContextChars);
      if (debug) {
        logger.debug(`[BuildContext] Truncated context to ${maxContextChars} chars`);
      }
    }

    return {
      codebaseContext,
      targetFiles: targetFiles.join('\n'),
    };
  } catch (error) {
    logger.warn(`[BuildContext] Error building context: ${error}`);
    return {
      codebaseContext: '',
      targetFiles: '',
    };
  }
}

/**
 * Extract file paths from text
 */
function extractFilePaths(text: string): string[] {
  const paths: string[] = [];

  // Match common file path patterns
  const patterns = [
    /(?:docroot|config|src|modules)\/[\w\-\/\.]+\.\w+/g,
    /[\w\-]+\.(ts|js|php|yml|yaml|json|md)/g,
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      paths.push(...matches);
    }
  }

  return [...new Set(paths)];
}

/**
 * Extract required file paths from task details
 */
export function extractRequiredFilePaths(taskDetails: string): string[] {
  const paths: string[] = [];

  // Match common file path patterns
  const patterns = [
    /(?:docroot|config)\/[\w\-\/\.]+/g,
    /src\/[\w\-\/\.]+/g,
    /modules\/[\w\-\/\.]+/g,
  ];

  for (const pattern of patterns) {
    const matches = taskDetails.match(pattern);
    if (matches) {
      paths.push(...matches);
    }
  }

  return [...new Set(paths)];
}
