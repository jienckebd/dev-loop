/**
 * Proactive Event Monitoring Service
 * 
 * Continuously monitors event stream and triggers automated corrective actions
 * when thresholds are exceeded for specific event types.
 */

import { getEventStream, DevLoopEvent, EventType, EventSeverity } from '../utils/event-stream';
import { logger } from '../utils/logger';
import { Config } from '../../config/schema/core';
import { IssueClassifier } from './issue-classifier';
import { ActionExecutor } from './action-executor';

export interface ThresholdConfig {
  count?: number;        // Number of events before triggering
  rate?: number;         // Percentage rate (0-1) before triggering
  windowMs?: number;     // Time window in milliseconds (0 = no time limit)
  autoAction: boolean;   // Whether to auto-execute fix
  confidence: number;    // Confidence level required (0-1)
}

export interface EventMonitoringConfig {
  enabled: boolean;
  pollingInterval: number;  // Milliseconds between polls
  thresholds: Record<string, ThresholdConfig>;
  actions: {
    requireApproval: EventType[];  // Events that require approval before action
    autoExecute: EventType[];      // Events that can auto-execute
    maxInterventionsPerHour: number;
  };
  metrics: {
    trackInterventions: boolean;
    trackSuccessRate: boolean;
    trackRollbacks: boolean;
  };
}

export interface InterventionResult {
  success: boolean;
  interventionId: string;
  issueType: string;
  eventType: EventType;
  action: string;
  fixApplied: boolean;
  rollbackRequired: boolean;
  error?: string;
}

export class EventMonitorService {
  private isRunning = false;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastPollTimestamp: string | null = null;
  private interventionCount = 0;
  private interventionResetTime = Date.now();
  private config: EventMonitoringConfig;
  private issueClassifier: IssueClassifier;
  private actionExecutor: ActionExecutor;

  constructor(config: Config) {
    const monitoringConfig = (config.mcp as any)?.eventMonitoring;
    
    this.config = {
      enabled: monitoringConfig?.enabled ?? false,
      pollingInterval: monitoringConfig?.pollingInterval ?? 5000,
      thresholds: monitoringConfig?.thresholds ?? {},
      actions: {
        requireApproval: monitoringConfig?.actions?.requireApproval ?? [],
        autoExecute: monitoringConfig?.actions?.autoExecute ?? [],
        maxInterventionsPerHour: monitoringConfig?.actions?.maxInterventionsPerHour ?? 10,
      },
      metrics: {
        trackInterventions: monitoringConfig?.metrics?.trackInterventions ?? true,
        trackSuccessRate: monitoringConfig?.metrics?.trackSuccessRate ?? true,
        trackRollbacks: monitoringConfig?.metrics?.trackRollbacks ?? true,
      },
    };

    this.issueClassifier = new IssueClassifier();
    this.actionExecutor = new ActionExecutor(config);
  }

  /**
   * Start monitoring service
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[EventMonitor] Already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('[EventMonitor] Monitoring disabled in config');
      return;
    }

    this.isRunning = true;
    logger.info('[EventMonitor] Starting proactive event monitoring service');

    // Start polling immediately, then every N seconds
    this.pollEvents();

    this.pollingInterval = setInterval(() => {
      this.pollEvents();
    }, this.config.pollingInterval);

    // Reset intervention counter every hour
    setInterval(() => {
      this.interventionCount = 0;
      this.interventionResetTime = Date.now();
    }, 3600000);
  }

  /**
   * Stop monitoring service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    logger.info('[EventMonitor] Stopped proactive event monitoring service');
  }

  /**
   * Get monitoring status
   */
  getStatus(): {
    isRunning: boolean;
    enabled: boolean;
    lastPollTimestamp: string | null;
    interventionCount: number;
    interventionsThisHour: number;
  } {
    return {
      isRunning: this.isRunning,
      enabled: this.config.enabled,
      lastPollTimestamp: this.lastPollTimestamp,
      interventionCount: this.interventionCount,
      interventionsThisHour: this.interventionCount,
    };
  }

  /**
   * Poll events and check thresholds
   */
  private async pollEvents(): Promise<void> {
    try {
      const eventStream = getEventStream();
      
      // Get events since last poll
      const filter = {
        since: this.lastPollTimestamp || undefined,
        severity: ['warn', 'error', 'critical'] as EventSeverity[],
      };

      const events = eventStream.poll(filter);
      
      if (events.length === 0) {
        this.lastPollTimestamp = eventStream.getLastEventId();
        return;
      }

      // Update last poll timestamp
      this.lastPollTimestamp = eventStream.getLastEventId();

      // Group events by type for threshold checking
      const eventsByType = new Map<EventType, DevLoopEvent[]>();
      for (const event of events) {
        if (!eventsByType.has(event.type)) {
          eventsByType.set(event.type, []);
        }
        eventsByType.get(event.type)!.push(event);
      }

      // Check thresholds for each event type
      for (const [eventType, typeEvents] of eventsByType.entries()) {
        const threshold = this.config.thresholds[eventType];
        
        if (!threshold) {
          continue; // No threshold configured for this event type
        }

        const exceeded = await this.checkThreshold(eventType, typeEvents, threshold);
        
        if (exceeded) {
          await this.handleThresholdExceeded(eventType, typeEvents, threshold);
        }
      }
    } catch (error) {
      logger.error('[EventMonitor] Error polling events:', error);
    }
  }

  /**
   * Check if threshold is exceeded for an event type
   */
  private async checkThreshold(
    eventType: EventType,
    events: DevLoopEvent[],
    threshold: ThresholdConfig
  ): Promise<boolean> {
    // Check rate limit
    if (this.interventionCount >= this.config.actions.maxInterventionsPerHour) {
      logger.warn(`[EventMonitor] Rate limit exceeded (${this.interventionCount} interventions this hour)`);
      return false;
    }

    // Count-based threshold
    if (threshold.count !== undefined) {
      const relevantEvents = this.filterByWindow(events, threshold.windowMs);
      if (relevantEvents.length >= threshold.count) {
        return true;
      }
    }

    // Rate-based threshold (percentage)
    if (threshold.rate !== undefined && threshold.windowMs) {
      // Need to get total events in window for rate calculation
      const eventStream = getEventStream();
      const now = Date.now();
      const windowStart = new Date(now - threshold.windowMs).toISOString();
      const allEvents = eventStream.getByTimeRange(windowStart);
      
      // Calculate rate for this event type
      const relevantEvents = this.filterByWindow(events, threshold.windowMs);
      const rate = allEvents.length > 0 ? relevantEvents.length / allEvents.length : 0;
      
      if (rate >= threshold.rate) {
        return true;
      }
    }

    // No threshold exceeded
    return false;
  }

  /**
   * Filter events by time window
   */
  private filterByWindow(events: DevLoopEvent[], windowMs?: number): DevLoopEvent[] {
    if (!windowMs || windowMs === 0) {
      return events; // No time limit
    }

    const now = Date.now();
    const cutoff = now - windowMs;

    return events.filter(event => {
      const eventTime = new Date(event.timestamp).getTime();
      return eventTime >= cutoff;
    });
  }

  /**
   * Handle threshold exceeded - classify issue and execute action
   */
  private async handleThresholdExceeded(
    eventType: EventType,
    events: DevLoopEvent[],
    threshold: ThresholdConfig
  ): Promise<void> {
    logger.info(`[EventMonitor] Threshold exceeded for ${eventType} (${events.length} events)`);

    try {
      // Classify issue
      const classification = await this.issueClassifier.classify(eventType, events);
      
      logger.info(`[EventMonitor] Classified issue: ${classification.issueType}, confidence: ${classification.confidence}`);

      // Check if confidence meets threshold
      if (classification.confidence < threshold.confidence) {
        logger.warn(`[EventMonitor] Confidence ${classification.confidence} below threshold ${threshold.confidence}, skipping auto-action`);
        return;
      }

      // Check if approval required
      if (this.config.actions.requireApproval.includes(eventType) && !threshold.autoAction) {
        logger.info(`[EventMonitor] Approval required for ${eventType}, logging for manual intervention`);
        // Emit event for manual intervention
        getEventStream().emit(
          'intervention:approval_required' as any,
          {
            eventType,
            classification,
            threshold,
          },
          { severity: 'warn' }
        );
        return;
      }

      // Check rate limit before executing
      if (this.interventionCount >= this.config.actions.maxInterventionsPerHour) {
        logger.warn(`[EventMonitor] Rate limit exceeded, skipping intervention for ${eventType}`);
        getEventStream().emit(
          'intervention:rate_limited',
          {
            eventType,
            interventionCount: this.interventionCount,
            maxInterventionsPerHour: this.config.actions.maxInterventionsPerHour,
          },
          { severity: 'warn' }
        );
        return;
      }

      // Execute action
      this.interventionCount++;
      
      const interventionStartTime = Date.now();
      
      // Emit intervention triggered event
      getEventStream().emit(
        'intervention:triggered',
        {
          eventType,
          issueType: classification.issueType,
          confidence: classification.confidence,
          strategy: classification.suggestedAction,
        },
        { severity: 'info' }
      );
      
      const result = await this.actionExecutor.execute(
        eventType,
        classification,
        events
      );

      const interventionDuration = Date.now() - interventionStartTime;

      // Track intervention
      if (this.config.metrics.trackInterventions) {
        // Record intervention with metrics tracker
        const { getInterventionMetricsTracker } = await import('../metrics/intervention-metrics.js');
        const tracker = getInterventionMetricsTracker();
        
        const eventStream = getEventStream();
        const firstEvent = events[0];
        const detectionTime = firstEvent ? Date.now() - new Date(firstEvent.timestamp).getTime() : 0;
        
        tracker.recordIntervention({
          interventionId: result.interventionId,
          timestamp: new Date().toISOString(),
          eventType,
          issueType: classification.issueType,
          strategy: result.action,
          confidence: classification.confidence,
          success: result.success,
          fixApplied: result.fixApplied,
          rollbackRequired: result.rollbackRequired,
          error: result.error,
          detectionTimeMs: detectionTime,
          fixTimeMs: interventionDuration,
        });

        // Emit events
        eventStream.emit(
          result.success ? 'intervention:successful' : 'intervention:failed',
          {
            interventionId: result.interventionId,
            issueType: classification.issueType,
            eventType,
            action: result.action,
            fixApplied: result.fixApplied,
            durationMs: interventionDuration,
          },
          { severity: result.success ? 'info' : 'error' }
        );

        if (result.rollbackRequired && this.config.metrics.trackRollbacks) {
          eventStream.emit(
            'intervention:rolled_back',
            {
              interventionId: result.interventionId,
              issueType: classification.issueType,
              eventType,
              error: result.error,
            },
            { severity: 'warn' }
          );
        }

        // Track threshold exceeded
        tracker.recordThresholdExceeded(eventType);
        
        // If successful and fix applied, track as prevented issue
        if (result.success && result.fixApplied) {
          tracker.recordIssuePrevented(eventType);
        }
      }
    } catch (error) {
      logger.error(`[EventMonitor] Error handling threshold exceeded for ${eventType}:`, error);
      
      getEventStream().emit(
        'intervention:error',
        {
          eventType,
          error: error instanceof Error ? error.message : String(error),
        },
        { severity: 'error' }
      );
    }
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(newConfig: Partial<EventMonitoringConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    if (newConfig.enabled !== undefined && newConfig.enabled !== this.config.enabled) {
      if (newConfig.enabled) {
        this.start();
      } else {
        this.stop();
      }
    } else if (newConfig.pollingInterval !== undefined && this.isRunning) {
      // Restart with new polling interval
      this.stop();
      this.start();
    }

    logger.info('[EventMonitor] Configuration updated');
  }
}

/**
 * Initialize event monitor service
 */
export function initializeEventMonitor(config: Config): EventMonitorService {
  return new EventMonitorService(config);
}

// Store global monitor instance
let globalMonitorInstance: EventMonitorService | null = null;

/**
 * Get global monitor service instance (if initialized)
 */
export function getMonitorService(): EventMonitorService | null {
  return globalMonitorInstance;
}

/**
 * Set global monitor service instance
 */
export function setMonitorService(monitor: EventMonitorService): void {
  globalMonitorInstance = monitor;
}
