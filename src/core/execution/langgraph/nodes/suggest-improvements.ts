/**
 * Suggest Improvements Node
 *
 * LangGraph node that suggests improvements when workflow is stalled.
 * Used for escalation when fix tasks repeatedly fail.
 */

import { WorkflowState, IterationLearning } from '../state';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';
import { emitEvent } from '../../../utils/event-stream';

export interface SuggestImprovementsNodeConfig {
  config: Config;
  debug?: boolean;
  // Maximum retry count before suggesting improvements
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 3;

/**
 * Create the suggest improvements node function
 */
export function suggestImprovements(nodeConfig: SuggestImprovementsNodeConfig) {
  const { config, debug, maxRetries = DEFAULT_MAX_RETRIES } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    // Check if stall is detected
    const isStalled = state.metrics?.stallDetected ||
      (state.metrics?.retryCount || 0) >= maxRetries;

    if (!isStalled) {
      if (debug) {
        logger.debug('[SuggestImprovements] No stall detected');
      }
      return {
        status: 'suggesting',
      };
    }

    try {
      if (debug) {
        logger.debug('[SuggestImprovements] Generating improvement suggestions');
      }

      // Analyze the failure pattern
      const suggestions = generateSuggestions(state);

      // Create learning entries for suggestions
      const learnings: IterationLearning[] = suggestions.map(suggestion => ({
        type: 'gotcha' as const,
        name: suggestion.title,
        guidance: suggestion.recommendation,
        evidence: suggestion.evidence,
      }));

      // Emit stall event for external handlers
      emitEvent('workflow:stalled', {
        taskId: state.task?.id,
        retryCount: state.metrics?.retryCount || 0,
        suggestions: suggestions.map(s => s.recommendation),
        timestamp: new Date().toISOString(),
      });

      logger.warn(`[SuggestImprovements] Workflow stalled after ${state.metrics?.retryCount || 0} retries`);
      logger.info('[SuggestImprovements] Suggestions:');
      for (const suggestion of suggestions) {
        logger.info(`  - ${suggestion.title}: ${suggestion.recommendation}`);
      }

      return {
        status: 'suggesting',
        learnings,
        // Mark as failed with suggestions
        error: `Workflow stalled after ${state.metrics?.retryCount || 0} retries. See suggestions.`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[SuggestImprovements] Error: ${errorMessage}`);

      return {
        status: 'failed',
        error: `Failed to generate suggestions: ${errorMessage}`,
      };
    }
  };
}

interface Suggestion {
  title: string;
  recommendation: string;
  evidence?: string;
}

/**
 * Generate improvement suggestions based on failure patterns
 */
function generateSuggestions(state: WorkflowState): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Analyze error patterns
  const errors = state.logAnalysis?.errors || [];
  const testOutput = state.testResult?.output || '';

  // Common stall patterns
  if (errors.some(e => /syntax error/i.test(e))) {
    suggestions.push({
      title: 'Syntax Validation',
      recommendation: 'Add syntax validation before applying changes. Consider using AST parsing.',
      evidence: 'Repeated syntax errors in generated code',
    });
  }

  if (errors.some(e => /class.*not found/i.test(e))) {
    suggestions.push({
      title: 'Dependency Resolution',
      recommendation: 'Ensure all required classes are properly imported and autoloaded.',
      evidence: 'Missing class dependencies',
    });
  }

  if (errors.some(e => /undefined/i.test(e))) {
    suggestions.push({
      title: 'Context Completeness',
      recommendation: 'Include more context files in the prompt. The AI may be missing required type definitions.',
      evidence: 'Undefined references in generated code',
    });
  }

  if (testOutput.includes('timeout')) {
    suggestions.push({
      title: 'Performance Issue',
      recommendation: 'Review generated code for infinite loops or blocking operations.',
      evidence: 'Test timeout',
    });
  }

  // File-related suggestions
  if (state.filesModified?.length === 0) {
    suggestions.push({
      title: 'No Changes Applied',
      recommendation: 'The AI may not be generating valid file changes. Review prompt structure.',
      evidence: 'No files were modified',
    });
  }

  // Generic suggestions if no specific patterns found
  if (suggestions.length === 0) {
    suggestions.push({
      title: 'Manual Review Needed',
      recommendation: 'The failure pattern is unclear. Consider manually reviewing the task requirements.',
      evidence: `${state.metrics?.retryCount || 0} failed attempts`,
    });

    suggestions.push({
      title: 'Task Decomposition',
      recommendation: 'Consider breaking this task into smaller, more specific subtasks.',
      evidence: 'Repeated failures may indicate task complexity',
    });
  }

  // Always suggest context improvement
  if (!suggestions.some(s => s.title.includes('Context'))) {
    suggestions.push({
      title: 'Improve Context',
      recommendation: 'Review and improve the codebase context provided to the AI.',
      evidence: 'Context quality affects AI performance',
    });
  }

  return suggestions;
}

/**
 * Check if workflow is stalled
 */
export function isStalled(state: WorkflowState, maxRetries: number = DEFAULT_MAX_RETRIES): boolean {
  return state.metrics?.stallDetected ||
    (state.metrics?.retryCount || 0) >= maxRetries;
}
