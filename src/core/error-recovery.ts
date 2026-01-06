import { logger } from './logger';

export interface ErrorContext {
  error: Error;
  phaseId?: number;
  taskId?: string;
  prdId?: string;
  attemptCount: number;
  previousAttempts: Array<{ strategy: string; result: string }>;
}

export interface RecoveryResult {
  success: boolean;
  strategy: string;
  action: 'retry' | 'rollback' | 'investigate' | 'skip';
  message: string;
  nextSteps?: string[];
}

export interface RecoveryStrategy {
  type: string;
  condition: (error: Error, context: ErrorContext) => boolean;
  action: (error: Error, context: ErrorContext) => Promise<RecoveryResult>;
  maxRetries?: number;
}

export interface InvestigationResult {
  rootCause: string;
  suggestedFix: string;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * ErrorRecovery provides intelligent error recovery strategies.
 *
 * Supports:
 * - Multiple recovery strategies per error type
 * - Retry with exponential backoff
 * - Investigation and fix task creation
 * - Framework-specific error guidance
 */
export class ErrorRecovery {
  private strategies: RecoveryStrategy[] = [];
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
    this.registerDefaultStrategies();
  }

  /**
   * Recover from an error.
   */
  async recoverFromError(error: Error, context: ErrorContext): Promise<RecoveryResult> {
    // Find applicable strategies
    const applicableStrategies = this.strategies.filter(s => s.condition(error, context));

    if (applicableStrategies.length === 0) {
      return {
        success: false,
        strategy: 'none',
        action: 'investigate',
        message: 'No recovery strategy found for this error',
        nextSteps: ['Investigate root cause', 'Create fix task'],
      };
    }

    // Try strategies in order
    for (const strategy of applicableStrategies) {
      // Check max retries
      if (strategy.maxRetries && context.attemptCount >= strategy.maxRetries) {
        continue;
      }

      try {
        const result = await strategy.action(error, context);
        if (result.success) {
          return result;
        }
      } catch (strategyError: any) {
        if (this.debug) {
          logger.debug(`[ErrorRecovery] Strategy ${strategy.type} failed: ${strategyError.message}`);
        }
      }
    }

    // All strategies failed
    return {
      success: false,
      strategy: 'all-failed',
      action: 'investigate',
      message: 'All recovery strategies failed',
      nextSteps: ['Investigate root cause', 'Create fix task', 'Consider manual intervention'],
    };
  }

  /**
   * Apply a specific recovery strategy.
   */
  async applyRecoveryStrategy(strategy: RecoveryStrategy, context: ErrorContext): Promise<RecoveryResult> {
    return strategy.action(context.error, context);
  }

  /**
   * Retry with fix.
   */
  async retryWithFix(error: Error, maxRetries: number): Promise<RecoveryResult> {
    // This would implement retry logic with exponential backoff
    return {
      success: false,
      strategy: 'retry-with-fix',
      action: 'retry',
      message: 'Retry with fix not implemented',
    };
  }

  /**
   * Investigate and fix.
   */
  async investigateAndFix(error: Error): Promise<InvestigationResult> {
    // Analyze error and suggest fix
    const errorMessage = error.message.toLowerCase();

    let rootCause = 'Unknown error';
    let suggestedFix = 'Review error logs and code';
    let confidence: 'low' | 'medium' | 'high' = 'low';

    // Pattern matching for common errors
    if (errorMessage.includes('schema validation')) {
      rootCause = 'Schema validation failure';
      suggestedFix = 'Check schema syntax and TypedConfigManager discovery';
      confidence = 'medium';
    } else if (errorMessage.includes('plugin')) {
      rootCause = 'Plugin discovery failure';
      suggestedFix = 'Verify plugin_type.yml and annotation format';
      confidence = 'medium';
    } else if (errorMessage.includes('service')) {
      rootCause = 'Service not found';
      suggestedFix = 'Check service definition in services.yml';
      confidence = 'high';
    } else if (errorMessage.includes('method')) {
      rootCause = 'Method not found';
      suggestedFix = 'Verify method exists in class';
      confidence = 'high';
    }

    return {
      rootCause,
      suggestedFix,
      confidence,
    };
  }

  /**
   * Register a recovery strategy.
   */
  registerStrategy(strategy: RecoveryStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Register default recovery strategies.
   */
  private registerDefaultStrategies(): void {
    // Retry strategy for transient errors
    this.registerStrategy({
      type: 'retry',
      condition: (error, context) => {
        const errorMessage = error.message.toLowerCase();
        return errorMessage.includes('timeout') ||
               errorMessage.includes('network') ||
               errorMessage.includes('connection');
      },
      action: async (error, context) => {
        return {
          success: true,
          strategy: 'retry',
          action: 'retry',
          message: 'Transient error detected, will retry',
        };
      },
      maxRetries: 3,
    });

    // Rollback strategy for critical failures
    this.registerStrategy({
      type: 'rollback',
      condition: (error, context) => {
        const errorMessage = error.message.toLowerCase();
        return errorMessage.includes('fatal') ||
               errorMessage.includes('syntax error') ||
               errorMessage.includes('parse error');
      },
      action: async (error, context) => {
        return {
          success: true,
          strategy: 'rollback',
          action: 'rollback',
          message: 'Critical error detected, rolling back',
        };
      },
    });
  }
}


