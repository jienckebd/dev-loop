/**
 * Analyze Failure Node
 *
 * LangGraph node that analyzes test failures and error logs.
 * Uses AI to identify root causes and recommend fixes.
 */

import { LogAnalysis } from '../../../../types';
import { WorkflowState } from '../state';
import { AIProvider } from '../../../../providers/ai/interface';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';

export interface AnalyzeFailureNodeConfig {
  aiProvider: AIProvider;
  config: Config;
  debug?: boolean;
  // Optional log analyzer for parsing logs
  logAnalyzer?: {
    analyze: (logs: string) => Promise<LogAnalysis>;
  };
}

/**
 * Create the analyze failure node function
 */
export function analyzeFailure(nodeConfig: AnalyzeFailureNodeConfig) {
  const { aiProvider, config, debug, logAnalyzer } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    // Skip if tests passed
    if (state.testResult?.success) {
      logger.warn('[AnalyzeFailure] Tests passed, no analysis needed');
      return {
        status: 'analyzing',
        logAnalysis: null,
      };
    }

    try {
      if (debug) {
        logger.debug('[AnalyzeFailure] Analyzing test failure');
      }

      // Get error content from test output
      const errorContent = extractErrorContent(state);

      if (!errorContent) {
        logger.warn('[AnalyzeFailure] No error content to analyze');
        return {
          status: 'analyzing',
          logAnalysis: {
            errors: ['Test failed but no error details available'],
            warnings: [],
            summary: 'Test failure with no error details',
            recommendations: ['Check test output manually'],
          },
        };
      }

      // Analyze using log analyzer or AI
      let analysis: LogAnalysis;

      if (logAnalyzer) {
        analysis = await logAnalyzer.analyze(errorContent);
      } else {
        // Use AI provider for analysis
        analysis = await analyzeWithAI(aiProvider, errorContent, state.context, debug);
      }

      logger.info(`[AnalyzeFailure] Found ${analysis.errors.length} error(s), ${analysis.warnings.length} warning(s)`);

      return {
        status: 'analyzing',
        logAnalysis: analysis,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[AnalyzeFailure] Error: ${errorMessage}`);

      return {
        status: 'failed',
        logAnalysis: {
          errors: [`Analysis failed: ${errorMessage}`],
          warnings: [],
          summary: 'Error analysis failed',
          recommendations: ['Review test output manually'],
        },
        error: `Failure analysis failed: ${errorMessage}`,
      };
    }
  };
}

/**
 * Extract error content from state
 */
function extractErrorContent(state: WorkflowState): string {
  const parts: string[] = [];

  // Test output
  if (state.testResult?.output) {
    parts.push('## Test Output');
    parts.push(state.testResult.output);
  }

  // State error
  if (state.error) {
    parts.push('## Error');
    parts.push(state.error);
  }

  // Validation errors
  if (state.validationResult?.errors?.length) {
    parts.push('## Validation Errors');
    parts.push(state.validationResult.errors.join('\n'));
  }

  return parts.join('\n\n');
}

/**
 * Analyze errors using AI provider
 */
async function analyzeWithAI(
  aiProvider: AIProvider,
  errorContent: string,
  context: any,
  debug?: boolean
): Promise<LogAnalysis> {
  try {
    // Use the AI provider's analyzeError method
    const analysis = await aiProvider.analyzeError(errorContent, context);
    return analysis;
  } catch (error) {
    if (debug) {
      logger.debug(`[AnalyzeFailure] AI analysis failed: ${error}`);
    }

    // Fallback to pattern-based analysis
    return patternBasedAnalysis(errorContent);
  }
}

/**
 * Pattern-based error analysis (fallback when AI unavailable)
 */
function patternBasedAnalysis(errorContent: string): LogAnalysis {
  const errors: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Common error patterns
  const patterns = [
    {
      pattern: /SQLSTATE\[(\w+)\]/,
      type: 'error',
      message: 'Database error',
      recommendation: 'Check database connection and query',
    },
    {
      pattern: /Class ['"]([^'"]+)['"] not found/,
      type: 'error',
      message: 'Missing class',
      recommendation: 'Check autoloading and class namespace',
    },
    {
      pattern: /undefined (method|property|variable|index)/i,
      type: 'error',
      message: 'Undefined reference',
      recommendation: 'Check variable initialization and method existence',
    },
    {
      pattern: /syntax error/i,
      type: 'error',
      message: 'Syntax error',
      recommendation: 'Check code syntax, especially brackets and semicolons',
    },
    {
      pattern: /permission denied/i,
      type: 'error',
      message: 'Permission error',
      recommendation: 'Check file permissions',
    },
    {
      pattern: /timeout|timed out/i,
      type: 'error',
      message: 'Timeout',
      recommendation: 'Check for infinite loops or slow operations',
    },
    {
      pattern: /deprecated/i,
      type: 'warning',
      message: 'Deprecation warning',
      recommendation: 'Update deprecated code',
    },
  ];

  for (const { pattern, type, message, recommendation } of patterns) {
    if (pattern.test(errorContent)) {
      if (type === 'error') {
        errors.push(message);
      } else {
        warnings.push(message);
      }
      recommendations.push(recommendation);
    }
  }

  // Extract actual error lines
  const errorLines = errorContent.split('\n').filter(line =>
    /error|exception|fatal|failed/i.test(line) &&
    line.length < 200
  );

  for (const line of errorLines.slice(0, 5)) {
    if (!errors.some(e => line.includes(e))) {
      errors.push(line.trim());
    }
  }

  return {
    errors: errors.length > 0 ? errors : ['Unknown error'],
    warnings,
    summary: errors[0] || 'Test failure',
    recommendations: recommendations.length > 0 ? recommendations : ['Review error details'],
  };
}
