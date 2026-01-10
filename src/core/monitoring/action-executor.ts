/**
 * Action Executor
 * 
 * Executes corrective actions based on issue classifications.
 * Uses MCP tools to apply fixes with validation and rollback.
 */

import { DevLoopEvent, EventType } from '../utils/event-stream';
import { logger } from '../utils/logger';
import { Config } from '../../config/schema/core';
import { IssueClassification } from './issue-classifier';
import {
  ActionStrategy,
  createJsonParsingStrategy,
  createTaskBlockingStrategy,
  createBoundaryViolationStrategy,
  createValidationFailureStrategy,
  createContributionModeStrategy,
  createIPCConnectionStrategy,
} from './action-strategies';
import { InterventionResult } from './event-monitor';

export class ActionExecutor {
  private strategies: Map<string, ActionStrategy>;
  private strategiesInitialized: boolean = false;

  constructor(private config: Config) {
    // Initialize action strategies lazily
    this.strategies = new Map();
  }

  /**
   * Ensure strategies are initialized
   */
  private ensureStrategiesInitialized(): void {
    if (this.strategiesInitialized) {
      return;
    }

    // Register strategies
    const strategies = this.loadActionStrategies();
    for (const strategy of strategies) {
      this.strategies.set(strategy.issueType, strategy);
    }

    this.strategiesInitialized = true;
  }

  /**
   * Execute corrective action for an issue
   */
  async execute(
    eventType: EventType,
    classification: IssueClassification,
    events: DevLoopEvent[]
  ): Promise<InterventionResult> {
    const interventionId = `int-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    logger.info(`[ActionExecutor] Executing intervention ${interventionId} for ${classification.issueType}`);

      try {
        // Ensure strategies are initialized
        this.ensureStrategiesInitialized();
        
        // Get strategy for this issue type
        const strategy = this.strategies.get(classification.issueType);
        
        if (!strategy) {
        logger.warn(`[ActionExecutor] No strategy found for issue type: ${classification.issueType}`);
        return {
          success: false,
          interventionId,
          issueType: classification.issueType,
          eventType,
          action: 'none',
          fixApplied: false,
          rollbackRequired: false,
          error: `No strategy found for issue type: ${classification.issueType}`,
        };
      }

      // Execute strategy
      const result = await strategy.execute(classification, events);

      // Monitor effectiveness (async - don't block)
      this.monitorEffectiveness(interventionId, eventType, classification, result).catch(error => {
        logger.error(`[ActionExecutor] Error monitoring effectiveness:`, error);
      });

      return {
        success: result.success,
        interventionId,
        issueType: classification.issueType,
        eventType,
        action: strategy.name,
        fixApplied: result.fixApplied,
        rollbackRequired: result.rollbackRequired,
        error: result.error,
      };
    } catch (error) {
      logger.error(`[ActionExecutor] Error executing intervention:`, error);
      
      return {
        success: false,
        interventionId,
        issueType: classification.issueType,
        eventType,
        action: 'error',
        fixApplied: false,
        rollbackRequired: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Monitor intervention effectiveness by checking subsequent events
   */
  private async monitorEffectiveness(
    interventionId: string,
    eventType: EventType,
    classification: IssueClassification,
    result: { success: boolean; fixApplied: boolean; rollbackRequired: boolean }
  ): Promise<void> {
    if (!result.fixApplied || !result.success) {
      return; // No fix applied, nothing to monitor
    }

      // Wait a bit for events to occur
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds

    const { getEventStream } = await import('../utils/event-stream.js');
    const eventStream = getEventStream();

    // Check for regression (same type of events occurring)
    const recentEvents = eventStream.poll({
      types: [eventType],
      limit: 10,
    });

    // If same issue occurs again quickly, might need rollback
    if (recentEvents.length >= 3) {
      logger.warn(`[ActionExecutor] Possible regression detected for ${classification.issueType} (${recentEvents.length} events after intervention)`);
      
      eventStream.emit(
        'intervention:possible_regression',
        {
          interventionId,
          issueType: classification.issueType,
          eventType,
          eventsAfterIntervention: recentEvents.length,
        },
        { severity: 'warn' }
      );
    } else {
      logger.info(`[ActionExecutor] Intervention ${interventionId} appears effective (no regression)`);
    }
  }

  /**
   * Load action strategies
   */
  private loadActionStrategies(): ActionStrategy[] {
    // Import strategies - using dynamic import to avoid circular dependencies
    const strategies = [
      createJsonParsingStrategy(this.config),
      createTaskBlockingStrategy(this.config),
      createBoundaryViolationStrategy(this.config),
      createValidationFailureStrategy(this.config),
      createContributionModeStrategy(this.config),
      createIPCConnectionStrategy(this.config),
    ];

    return strategies;
  }
}
