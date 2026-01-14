/**
 * Agentic Recovery System
 *
 * Attempts automatic recovery from common failure patterns using
 * framework CLI commands and predefined strategies.
 */

import { CLICommandExecutor, CLIExecutionResult } from './cli-executor';
import { FrameworkPlugin, FrameworkCLICommand } from '../../frameworks/interface';
import { logger } from '../utils/logger';
import { emitEvent } from '../utils/event-stream';

/**
 * Recovery strategy definition
 */
export interface RecoveryStrategy {
  /** Pattern to match against error messages */
  pattern: string | RegExp;
  /** Human-readable name for the strategy */
  name: string;
  /** CLI commands to execute for recovery */
  commands: string[];
  /** Maximum number of recovery attempts */
  maxAttempts: number;
  /** Whether to retry the original operation after recovery */
  retryAfterRecovery: boolean;
  /** Optional: Module name to extract from error */
  extractModule?: RegExp;
}

/**
 * Recovery attempt result
 */
export interface RecoveryResult {
  attempted: boolean;
  success: boolean;
  strategy?: string;
  commandsExecuted: CLIExecutionResult[];
  error?: string;
  suggestedAction?: 'retry' | 'skip' | 'escalate';
}

/**
 * Recovery metrics for tracking effectiveness
 */
export interface RecoveryMetrics {
  totalAttempts: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  byPattern: Record<string, { attempts: number; successes: number }>;
  byCommand: Record<string, { attempts: number; successes: number }>;
  avgRecoveryTimeMs: number;
  totalRecoveryTimeMs: number;
}

/**
 * Agentic Recovery System
 *
 * Provides automatic recovery from common failure patterns like:
 * - wrong-import-path: Module not enabled, service not found
 * - patch-not-found: Search string mismatch
 * - service-not-found: Missing dependency, cache stale
 */
export class RecoverySystem {
  private cliExecutor: CLICommandExecutor;
  private strategies: RecoveryStrategy[] = [];
  private metrics: RecoveryMetrics;
  private attemptCounts: Map<string, number> = new Map();
  private debug: boolean;

  constructor(
    cliExecutor: CLICommandExecutor,
    frameworkPlugin?: FrameworkPlugin,
    debug: boolean = false
  ) {
    this.cliExecutor = cliExecutor;
    this.debug = debug;
    this.metrics = this.createDefaultMetrics();

    // Register framework CLI commands if available
    if (frameworkPlugin?.getCLICommands) {
      this.cliExecutor.registerCommands(frameworkPlugin.getCLICommands());
    }

    // Initialize default recovery strategies
    this.initializeDefaultStrategies();
  }

  /**
   * Initialize default recovery strategies for common patterns
   */
  private initializeDefaultStrategies(): void {
    // Strategy 1: Wrong import path / Module not enabled
    this.strategies.push({
      pattern: /wrong.import.path|module.*not.*enabled|class.*not.*found|service.*not.*found/i,
      name: 'module-enable-recovery',
      commands: ['cache-rebuild'],
      maxAttempts: 2,
      retryAfterRecovery: true,
      extractModule: /module[:\s]+['"]?(\w+)['"]?/i,
    });

    // Strategy 2: Service not found
    this.strategies.push({
      pattern: /service.*not.*found|cannot.*get.*service|undefined.*service/i,
      name: 'service-recovery',
      commands: ['cache-rebuild'],
      maxAttempts: 2,
      retryAfterRecovery: true,
    });

    // Strategy 3: Entity type not found
    this.strategies.push({
      pattern: /entity.*type.*not.*found|unknown.*entity.*type/i,
      name: 'entity-recovery',
      commands: ['cache-rebuild'],
      maxAttempts: 2,
      retryAfterRecovery: true,
    });

    // Strategy 4: Config schema validation failed
    this.strategies.push({
      pattern: /schema.*validation|config.*invalid|yaml.*error/i,
      name: 'config-recovery',
      commands: ['cache-rebuild'],
      maxAttempts: 1,
      retryAfterRecovery: false, // Don't retry, schema needs fixing
    });

    // Strategy 5: Patch not found - this typically needs code changes, not CLI
    // But we can try cache clear first in case it's a stale file issue
    this.strategies.push({
      pattern: /patch.not.found|search.*string.*not.*found|exact.*match.*failed/i,
      name: 'patch-recovery',
      commands: ['cache-rebuild'],
      maxAttempts: 1,
      retryAfterRecovery: false, // Patch failures usually need code review
    });
  }

  /**
   * Add a custom recovery strategy
   */
  addStrategy(strategy: RecoveryStrategy): void {
    this.strategies.push(strategy);
    if (this.debug) {
      logger.debug(`[RecoverySystem] Added strategy: ${strategy.name}`);
    }
  }

  /**
   * Attempt recovery for a given error
   */
  async attemptRecovery(
    taskId: string,
    errorMessage: string,
    errorType?: string
  ): Promise<RecoveryResult> {
    const startTime = Date.now();
    const result: RecoveryResult = {
      attempted: false,
      success: false,
      commandsExecuted: [],
    };

    // Find matching strategy
    const strategy = this.findMatchingStrategy(errorMessage, errorType);
    if (!strategy) {
      if (this.debug) {
        logger.debug(`[RecoverySystem] No matching strategy for: ${errorMessage.substring(0, 100)}`);
      }
      return result;
    }

    // Check attempt count
    const attemptKey = `${taskId}:${strategy.name}`;
    const currentAttempts = this.attemptCounts.get(attemptKey) || 0;
    if (currentAttempts >= strategy.maxAttempts) {
      if (this.debug) {
        logger.debug(`[RecoverySystem] Max attempts (${strategy.maxAttempts}) reached for ${strategy.name}`);
      }
      result.error = `Max recovery attempts reached for ${strategy.name}`;
      result.suggestedAction = 'escalate';
      return result;
    }

    // Update attempt count
    this.attemptCounts.set(attemptKey, currentAttempts + 1);
    result.attempted = true;
    result.strategy = strategy.name;

    if (this.debug) {
      logger.info(`[RecoverySystem] Attempting recovery: ${strategy.name} (attempt ${currentAttempts + 1}/${strategy.maxAttempts})`);
    }

    // Execute recovery commands
    let allSucceeded = true;
    for (const commandName of strategy.commands) {
      // Extract module name if needed
      const args: Record<string, string> = {};
      if (strategy.extractModule && commandName === 'module-enable') {
        const moduleMatch = errorMessage.match(strategy.extractModule);
        if (moduleMatch?.[1]) {
          args.module = moduleMatch[1];
        } else {
          // Skip module-enable if we can't extract module name
          if (this.debug) {
            logger.debug(`[RecoverySystem] Cannot extract module name, skipping module-enable`);
          }
          continue;
        }
      }

      const cmdResult = await this.cliExecutor.execute(commandName, args);
      result.commandsExecuted.push(cmdResult);

      if (!cmdResult.success) {
        allSucceeded = false;
        if (this.debug) {
          logger.warn(`[RecoverySystem] Command failed: ${commandName} - ${cmdResult.error}`);
        }
        // Continue with other commands even if one fails
      } else if (this.debug) {
        logger.debug(`[RecoverySystem] Command succeeded: ${commandName}`);
      }
    }

    result.success = allSucceeded;
    result.suggestedAction = strategy.retryAfterRecovery && allSucceeded ? 'retry' : 'escalate';

    // Update metrics
    const duration = Date.now() - startTime;
    this.recordMetrics(strategy.name, result.commandsExecuted, allSucceeded, duration);

    // Emit recovery event for metrics tracking
    emitEvent('recovery:attempted', {
      taskId,
      strategy: strategy.name,
      success: allSucceeded,
      durationMs: duration,
      commandsExecuted: result.commandsExecuted.length,
      suggestedAction: result.suggestedAction,
      errorType: errorType || 'unknown',
    });

    if (this.debug) {
      logger.info(`[RecoverySystem] Recovery ${allSucceeded ? 'succeeded' : 'failed'}: ${strategy.name} (${duration}ms)`);
    }

    return result;
  }

  /**
   * Find a matching recovery strategy for an error
   */
  private findMatchingStrategy(errorMessage: string, errorType?: string): RecoveryStrategy | null {
    for (const strategy of this.strategies) {
      const pattern = strategy.pattern;
      const testString = errorType ? `${errorType} ${errorMessage}` : errorMessage;

      if (typeof pattern === 'string') {
        if (testString.toLowerCase().includes(pattern.toLowerCase())) {
          return strategy;
        }
      } else if (pattern.test(testString)) {
        return strategy;
      }
    }
    return null;
  }

  /**
   * Reset attempt counts for a task (call when task succeeds)
   */
  resetAttempts(taskId: string): void {
    for (const key of this.attemptCounts.keys()) {
      if (key.startsWith(`${taskId}:`)) {
        this.attemptCounts.delete(key);
      }
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): RecoveryMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.createDefaultMetrics();
    this.attemptCounts.clear();
  }

  // ===== Private Methods =====

  private createDefaultMetrics(): RecoveryMetrics {
    return {
      totalAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      byPattern: {},
      byCommand: {},
      avgRecoveryTimeMs: 0,
      totalRecoveryTimeMs: 0,
    };
  }

  private recordMetrics(
    strategyName: string,
    commands: CLIExecutionResult[],
    success: boolean,
    durationMs: number
  ): void {
    this.metrics.totalAttempts++;
    if (success) {
      this.metrics.successfulRecoveries++;
    } else {
      this.metrics.failedRecoveries++;
    }

    // Track by pattern
    if (!this.metrics.byPattern[strategyName]) {
      this.metrics.byPattern[strategyName] = { attempts: 0, successes: 0 };
    }
    this.metrics.byPattern[strategyName].attempts++;
    if (success) {
      this.metrics.byPattern[strategyName].successes++;
    }

    // Track by command
    for (const cmd of commands) {
      if (!this.metrics.byCommand[cmd.commandName]) {
        this.metrics.byCommand[cmd.commandName] = { attempts: 0, successes: 0 };
      }
      this.metrics.byCommand[cmd.commandName].attempts++;
      if (cmd.success) {
        this.metrics.byCommand[cmd.commandName].successes++;
      }
    }

    // Update timing
    this.metrics.totalRecoveryTimeMs += durationMs;
    this.metrics.avgRecoveryTimeMs = this.metrics.totalRecoveryTimeMs / this.metrics.totalAttempts;
  }
}
