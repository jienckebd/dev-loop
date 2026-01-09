import { PrdCoordinator, PrdState } from '../coordination/coordinator';
import { PrdSetExecutionResult } from './orchestrator';
import { logger } from '../../utils/logger';

export interface ErrorRecoveryOptions {
  maxRetries?: number;
  retryBackoff?: 'exponential' | 'linear' | 'fixed';
  retryOn?: string[]; // Error types to retry on
  rollbackEnabled?: boolean;
  rollbackStrategy?: 'phase-level' | 'task-level' | 'checkpoint';
}

export interface ErrorAnalysis {
  errorType: 'prd-failure' | 'phase-failure' | 'task-failure' | 'dependency-failure' | 'validation-failure';
  retryable: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  context: Record<string, any>;
}

/**
 * PRD Set Error Handler
 *
 * Handles errors during PRD set execution with retry logic and rollback support.
 */
export class PrdSetErrorHandler {
  private coordinator: PrdCoordinator;
  private debug: boolean;

  constructor(coordinator: PrdCoordinator, debug: boolean = false) {
    this.coordinator = coordinator;
    this.debug = debug;
  }

  /**
   * Analyze error and determine recovery strategy
   */
  analyzeError(
    prdId: string,
    error: Error,
    context: Record<string, any> = {}
  ): ErrorAnalysis {
    const errorMessage = error.message.toLowerCase();
    let errorType: ErrorAnalysis['errorType'] = 'prd-failure';
    let retryable = false;
    let severity: ErrorAnalysis['severity'] = 'medium';

    // Classify error type
    if (errorMessage.includes('test') || errorMessage.includes('validation')) {
      errorType = 'task-failure';
      retryable = true;
      severity = 'low';
    } else if (errorMessage.includes('phase')) {
      errorType = 'phase-failure';
      retryable = true;
      severity = 'medium';
    } else if (errorMessage.includes('dependency') || errorMessage.includes('prerequisite')) {
      errorType = 'dependency-failure';
      retryable = false;
      severity = 'high';
    } else if (errorMessage.includes('validation') || errorMessage.includes('schema')) {
      errorType = 'validation-failure';
      retryable = false;
      severity = 'high';
    } else {
      errorType = 'prd-failure';
      retryable = true;
      severity = 'medium';
    }

    // Determine if retryable based on error patterns
    const retryablePatterns = [
      'timeout',
      'network',
      'temporary',
      'rate limit',
      'test failure',
      'flaky',
    ];

    const nonRetryablePatterns = [
      'syntax error',
      'compilation error',
      'schema error',
      'validation error',
      'circular dependency',
    ];

    if (retryablePatterns.some(pattern => errorMessage.includes(pattern))) {
      retryable = true;
    }

    if (nonRetryablePatterns.some(pattern => errorMessage.includes(pattern))) {
      retryable = false;
      severity = 'high';
    }

    return {
      errorType,
      retryable,
      severity,
      message: error.message,
      context: {
        prdId,
        ...context,
      },
    };
  }

  /**
   * Handle PRD execution error with retry logic
   */
  async handlePrdError(
    prdId: string,
    error: Error,
    options: ErrorRecoveryOptions = {},
    retryFn: () => Promise<any>
  ): Promise<{ success: boolean; error?: Error }> {
    const {
      maxRetries = 3,
      retryBackoff = 'exponential',
      retryOn = ['test-timeout', 'schema-validation-failure'],
    } = options;

    const analysis = this.analyzeError(prdId, error);

    if (!analysis.retryable) {
      if (this.debug) {
        logger.debug(`[PrdSetErrorHandler] Error not retryable: ${analysis.message}`);
      }
      await this.coordinator.updatePrdState(prdId, {
        status: 'failed',
        error: analysis.message,
      });
      return { success: false, error };
    }

    // Check if error type is in retry list
    const shouldRetry = retryOn.some(type =>
      analysis.errorType.includes(type.replace('-', '')) ||
      error.message.toLowerCase().includes(type.replace('-', ' '))
    );

    if (!shouldRetry) {
      if (this.debug) {
        logger.debug(`[PrdSetErrorHandler] Error type not in retry list: ${analysis.errorType}`);
      }
      await this.coordinator.updatePrdState(prdId, {
        status: 'failed',
        error: analysis.message,
      });
      return { success: false, error };
    }

    // Retry with backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const delay = this.calculateBackoff(attempt, retryBackoff);

      if (this.debug) {
        logger.debug(`[PrdSetErrorHandler] Retrying PRD ${prdId} (attempt ${attempt}/${maxRetries}) after ${delay}ms`);
      }

      await new Promise(resolve => setTimeout(resolve, delay));

      try {
        const result = await retryFn();
        await this.coordinator.updatePrdState(prdId, {
          status: 'complete',
        });
        return { success: true };
      } catch (retryError: any) {
        if (attempt === maxRetries) {
          await this.coordinator.updatePrdState(prdId, {
            status: 'failed',
            error: retryError.message,
          });
          return { success: false, error: retryError };
        }
        // Continue to next retry
      }
    }

    return { success: false, error };
  }

  /**
   * Calculate backoff delay
   */
  private calculateBackoff(attempt: number, strategy: 'exponential' | 'linear' | 'fixed'): number {
    const baseDelay = 1000; // 1 second

    switch (strategy) {
      case 'exponential':
        return baseDelay * Math.pow(2, attempt - 1);
      case 'linear':
        return baseDelay * attempt;
      case 'fixed':
        return baseDelay;
      default:
        return baseDelay;
    }
  }

  /**
   * Propagate error up the hierarchy
   */
  async propagateError(
    prdId: string,
    error: Error,
    executionResult: PrdSetExecutionResult
  ): Promise<void> {
    const analysis = this.analyzeError(prdId, error);

    // Mark PRD as failed
    executionResult.failedPrds.push(prdId);
    executionResult.errors.push(`PRD ${prdId}: ${error.message}`);

    // Update status based on severity
    if (analysis.severity === 'critical') {
      executionResult.status = 'failed';
    } else if (executionResult.status === 'complete') {
      executionResult.status = 'blocked';
    }

    if (this.debug) {
      logger.debug(`[PrdSetErrorHandler] Propagated error for PRD ${prdId}: ${analysis.message}`);
    }
  }
}






