/**
 * Generate Code Node
 *
 * LangGraph node that invokes the AI provider to generate code changes.
 * Uses the AIProvider interface to support multiple backends (Anthropic, OpenAI, Cursor, Amp).
 */

import { CodeChanges, TaskContext } from '../../../../types';
import { WorkflowState, RunMetrics } from '../state';
import { AIProvider } from '../../../../providers/ai/interface';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';
import { getParallelMetricsTracker } from '../../../metrics/parallel';

export interface GenerateCodeNodeConfig {
  aiProvider: AIProvider;
  config: Config;
  debug?: boolean;
  // Callbacks for metrics
  onCodeGenerated?: (tokensUsed: { input: number; output: number }, duration: number) => void;
}

/**
 * Create the generate code node function
 */
export function generateCode(nodeConfig: GenerateCodeNodeConfig) {
  const { aiProvider, config, debug, onCodeGenerated } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    const startTime = Date.now();

    // Skip if no task or context
    if (!state.task || !state.context) {
      logger.warn('[GenerateCode] No task or context in state');
      return {
        status: 'generating',
        codeChanges: null,
        error: 'No task or context available for code generation',
      };
    }

    try {
      if (debug) {
        logger.debug(`[GenerateCode] Generating code for task: ${state.task.id}`);
      }

      // Build the prompt with context
      const prompt = buildPrompt(state.task, state.context, config);

      // Call AI provider
      const codeChanges = await aiProvider.generateCode(prompt, state.context);

      const duration = Date.now() - startTime;

      // Get token usage
      let tokensUsed = { input: 0, output: 0 };
      if ('getLastTokens' in aiProvider && typeof aiProvider.getLastTokens === 'function') {
        const tokens = aiProvider.getLastTokens();
        tokensUsed = {
          input: tokens.input || 0,
          output: tokens.output || 0,
        };
      }

      // Track in parallel metrics
      try {
        const parallelMetrics = getParallelMetricsTracker();
        const execution = parallelMetrics.getCurrentExecution();
        if (execution) {
          execution.tokens.totalInput += tokensUsed.input;
          execution.tokens.totalOutput += tokensUsed.output;
        }
      } catch {
        // Ignore metrics errors
      }

      // Track via callback
      if (onCodeGenerated) {
        onCodeGenerated(tokensUsed, duration);
      }

      // Update metrics in state
      const updatedMetrics: Partial<RunMetrics> = {
        ...state.metrics,
        tokensUsed: {
          input: (state.metrics?.tokensUsed?.input || 0) + tokensUsed.input,
          output: (state.metrics?.tokensUsed?.output || 0) + tokensUsed.output,
        },
      };

      // Validate code changes
      if (!codeChanges || !codeChanges.files || codeChanges.files.length === 0) {
        logger.warn('[GenerateCode] AI returned no code changes');
        return {
          status: 'generating',
          codeChanges: null,
          metrics: updatedMetrics as RunMetrics,
        };
      }

      // Filter files to ensure they're within project boundaries
      const filteredChanges = filterCodeChanges(codeChanges, state.context, config);

      logger.info(`[GenerateCode] Generated ${filteredChanges.files.length} file change(s) in ${duration}ms`);

      return {
        status: 'generating',
        codeChanges: filteredChanges,
        metrics: updatedMetrics as RunMetrics,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[GenerateCode] Error generating code: ${errorMessage}`);

      return {
        status: 'failed',
        codeChanges: null,
        error: `Code generation failed: ${errorMessage}`,
      };
    }
  };
}

/**
 * Build the prompt for code generation
 */
function buildPrompt(task: any, context: TaskContext, config: Config): string {
  const parts: string[] = [];

  // Task description
  parts.push(`# Task: ${task.title}`);
  parts.push('');
  parts.push(task.description);

  if (task.details) {
    parts.push('');
    parts.push('## Details');
    parts.push(task.details);
  }

  // Codebase context
  if (context.codebaseContext) {
    parts.push('');
    parts.push('## Relevant Code');
    parts.push(context.codebaseContext);
  }

  // Target module constraint
  if (context.targetModule) {
    parts.push('');
    parts.push(`## IMPORTANT: Target Module Constraint`);
    parts.push(`Only modify files within: ${context.targetModule}`);
    parts.push('Do NOT modify files outside this module path.');
  }

  // Framework-specific rules
  const frameworkRules = (config as any).framework?.rules;
  if (frameworkRules && frameworkRules.length > 0) {
    parts.push('');
    parts.push('## Framework Rules');
    for (const rule of frameworkRules) {
      parts.push(`- ${rule}`);
    }
  }

  return parts.join('\n');
}

/**
 * Filter code changes to respect project boundaries
 */
function filterCodeChanges(
  changes: CodeChanges,
  context: TaskContext,
  config: Config
): CodeChanges {
  // If no target module specified, return all changes
  if (!context.targetModule) {
    return changes;
  }

  const targetModule = context.targetModule;

  // Filter files to only those within target module
  const filteredFiles = changes.files.filter(file => {
    // Allow if file path contains the target module
    if (file.path.includes(targetModule)) {
      return true;
    }

    // Allow config files
    if (file.path.startsWith('config/')) {
      return true;
    }

    // Log skipped files
    logger.warn(`[GenerateCode] Skipping file outside target module: ${file.path}`);
    return false;
  });

  return {
    ...changes,
    files: filteredFiles,
  };
}

/**
 * Estimate token count from text
 */
export function estimateTokens(text: string): number {
  // Rough estimate: ~4 characters per token
  return Math.ceil(text.length / 4);
}
