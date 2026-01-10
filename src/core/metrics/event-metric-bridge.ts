/**
 * Event-to-Metrics Bridge
 * 
 * Automatically updates metrics when events are emitted from the event stream.
 * Subscribes to event stream and maps event types to metric update functions.
 */

import { EventType, DevLoopEvent, getEventStream } from '../utils/event-stream';
import {
  JsonParsingMetrics,
  IpcMetrics,
  FileFilteringMetrics,
  ValidationMetrics,
  createDefaultJsonParsingMetrics,
  createDefaultIpcMetrics,
  createDefaultFileFilteringMetrics,
  createDefaultValidationMetrics,
} from './types';
import { PrdMetrics } from './prd';
import { PhaseMetrics } from './phase';
import { logger } from '../utils/logger';

export interface MetricUpdaterConfig {
  prdMetrics?: PrdMetrics;
  phaseMetrics?: PhaseMetrics;
  enabled?: boolean;
  debug?: boolean;
}

/**
 * Bridge between event stream and metrics collection
 * Automatically updates metrics when events are emitted
 */
export class EventMetricBridge {
  private prdMetrics?: PrdMetrics;
  private phaseMetrics?: PhaseMetrics;
  private enabled: boolean;
  private debug: boolean;
  private eventListener?: (event: DevLoopEvent) => void;
  private lastEventId: string | null = null;
  private saveTimer?: NodeJS.Timeout;
  private pendingSaves: Set<string> = new Set(); // Track which PRDs need saving

  constructor(config: MetricUpdaterConfig = {}) {
    this.prdMetrics = config.prdMetrics;
    this.phaseMetrics = config.phaseMetrics;
    this.enabled = config.enabled !== false; // Default to enabled
    this.debug = config.debug || false;
  }

  /**
   * Start listening to events and updating metrics
   */
  start(): void {
    if (!this.enabled) {
      logger.debug('[EventMetricBridge] Bridge disabled, not starting');
      return;
    }

    if (this.eventListener) {
      logger.warn('[EventMetricBridge] Already started, ignoring duplicate start');
      return;
    }

    const eventStream = getEventStream();
    
    // Create event listener
    this.eventListener = (event: DevLoopEvent) => {
      this.handleEvent(event);
    };

    // Subscribe to events using event stream listener API
    eventStream.addListener(this.eventListener);

    // Start batched save timer (save every 5 seconds)
    this.saveTimer = setInterval(() => {
      this.flushPendingSaves();
    }, 5000);
    
    if (this.debug) {
      logger.info('[EventMetricBridge] Started event-to-metrics bridge');
    }
  }

  /**
   * Stop listening to events
   */
  stop(): void {
    if (this.eventListener) {
      const eventStream = getEventStream();
      eventStream.removeListener(this.eventListener);
      this.eventListener = undefined;
      
      // Flush any pending saves
      this.flushPendingSaves();
      
      // Clear save timer
      if (this.saveTimer) {
        clearInterval(this.saveTimer);
        this.saveTimer = undefined;
      }
      
      if (this.debug) {
        logger.info('[EventMetricBridge] Stopped event-to-metrics bridge');
      }
    }
  }

  /**
   * Flush pending metric saves
   * Note: Metrics are saved by PrdMetrics when workflow explicitly saves them
   * This method just clears the pending saves tracking - actual persistence happens
   * when workflow calls saveMetrics() on PrdMetrics
   */
  private flushPendingSaves(): void {
    if (this.pendingSaves.size === 0) return;

    const count = this.pendingSaves.size;
    this.pendingSaves.clear();
    
    if (this.debug && count > 0) {
      logger.debug(`[EventMetricBridge] Cleared ${count} pending metric saves (metrics will persist on next workflow save)`);
    }
  }

  /**
   * Handle a single event and update relevant metrics
   */
  private handleEvent(event: DevLoopEvent): void {
    try {
      const prdId = event.prdId;
      const phaseId = event.phaseId;

      if (!prdId) {
        // No PRD context, can't update PRD/phase metrics
        return;
      }

      // Route event to appropriate metric updater
      if (event.type.startsWith('json:')) {
        this.updateJsonParsingMetrics(event, prdId, phaseId);
      } else if (event.type.startsWith('file:')) {
        this.updateFileFilteringMetrics(event, prdId, phaseId);
      } else if (event.type.startsWith('validation:')) {
        this.updateValidationMetrics(event, prdId, phaseId);
      } else if (event.type.startsWith('ipc:')) {
        this.updateIpcMetrics(event, prdId, phaseId);
      } else if (event.type.startsWith('intervention:')) {
        // Intervention metrics are handled by InterventionMetricsTracker directly
        // Just mark PRD for save if it has intervention context
        this.pendingSaves.add(prdId);
      }

      // Update phase/PRD timing if applicable
      if (event.type === 'phase:started' || event.type === 'phase:completed' ||
          event.type === 'prd:started' || event.type === 'prd:completed') {
        // Timing updates handled by phase/PRD metrics directly
      }
    } catch (error) {
      logger.warn(`[EventMetricBridge] Error handling event ${event.type}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update JSON parsing metrics from event
   */
  private updateJsonParsingMetrics(event: DevLoopEvent, prdId: string, phaseId?: number): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric) return;

    // Ensure jsonParsing metrics exist
    if (!prdMetric.jsonParsing) {
      prdMetric.jsonParsing = createDefaultJsonParsingMetrics();
    }

    const metrics = prdMetric.jsonParsing;
    const duration = (event.data.durationMs as number) || 0;
    const tokens = (event.data.tokens as { input: number; output: number }) || { input: 0, output: 0 };

    switch (event.type) {
      case 'json:parse_failed':
        metrics.totalAttempts++;
        const reason = (event.data.reason as string) || 
                       (event.data.attemptedStrategies as string[] || []).join(',') || 
                       'unknown';
        metrics.failuresByReason[reason] = (metrics.failuresByReason[reason] || 0) + 1;
        break;

      case 'json:parse_retry':
        metrics.totalAttempts++;
        metrics.successByStrategy.retry++;
        if (duration > 0) {
          metrics.totalParsingTimeMs += duration;
          const count = metrics.successByStrategy.retry;
          metrics.avgParsingTimeMs = metrics.totalParsingTimeMs / count;
        }
        break;

      case 'json:parse_success':
        metrics.totalAttempts++;
        // Determine strategy from retry count
        const retryCount = (event.data.retryCount as number) || 0;
        if (retryCount === 0) {
          metrics.successByStrategy.direct++;
        } else if (retryCount > 0) {
          metrics.successByStrategy.retry++;
        }
        // Check if sanitized was used (could be inferred from strategy)
        const strategy = (event.data.strategy as string) || '';
        if (strategy === 'sanitized' || strategy.includes('sanitize')) {
          metrics.successByStrategy.sanitized++;
        }
        if (duration > 0) {
          metrics.totalParsingTimeMs += duration;
          const count = Object.values(metrics.successByStrategy).reduce((a, b) => a + b, 0);
          metrics.avgParsingTimeMs = count > 0 ? metrics.totalParsingTimeMs / count : 0;
        }
        break;

      case 'json:sanitized':
        metrics.totalAttempts++;
        metrics.successByStrategy.sanitized++;
        if (duration > 0) {
          metrics.totalParsingTimeMs += duration;
          const count = metrics.successByStrategy.sanitized;
          metrics.avgParsingTimeMs = metrics.totalParsingTimeMs / count;
        }
        break;

      case 'json:ai_fallback_success':
        metrics.totalAttempts++;
        metrics.successByStrategy.aiFallback++;
        metrics.aiFallbackUsage.triggered++;
        metrics.aiFallbackUsage.succeeded++;
        if (duration > 0) {
          metrics.aiFallbackUsage.totalTimeMs += duration;
          const count = metrics.aiFallbackUsage.triggered;
          metrics.aiFallbackUsage.avgTimeMs = metrics.aiFallbackUsage.totalTimeMs / count;
        }
        if (tokens.input > 0 || tokens.output > 0) {
          metrics.aiFallbackUsage.tokensUsed.input += tokens.input;
          metrics.aiFallbackUsage.tokensUsed.output += tokens.output;
        }
        break;

      case 'json:ai_fallback_failed':
        metrics.totalAttempts++;
        metrics.aiFallbackUsage.triggered++;
        metrics.aiFallbackUsage.failed++;
        if (duration > 0) {
          metrics.aiFallbackUsage.totalTimeMs += duration;
          const count = metrics.aiFallbackUsage.triggered;
          metrics.aiFallbackUsage.avgTimeMs = metrics.aiFallbackUsage.totalTimeMs / count;
        }
        if (tokens.input > 0 || tokens.output > 0) {
          metrics.aiFallbackUsage.tokensUsed.input += tokens.input;
          metrics.aiFallbackUsage.tokensUsed.output += tokens.output;
        }
        break;

      case 'json:ai_fallback_error':
        metrics.totalAttempts++;
        metrics.aiFallbackUsage.triggered++;
        metrics.aiFallbackUsage.failed++;
        if (duration > 0) {
          metrics.aiFallbackUsage.totalTimeMs += duration;
          const count = metrics.aiFallbackUsage.triggered;
          metrics.aiFallbackUsage.avgTimeMs = metrics.aiFallbackUsage.totalTimeMs / count;
        }
        break;
    }

    // Mark PRD as needing save (metrics will be saved on next workflow save cycle)
    // Note: We don't save immediately to avoid performance issues with frequent saves
    // Metrics will be persisted when workflow explicitly saves them
    this.pendingSaves.add(prdId);
  }

  /**
   * Update file filtering metrics from event
   */
  private updateFileFilteringMetrics(event: DevLoopEvent, prdId: string, phaseId?: number): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric) return;

    // Ensure fileFiltering metrics exist
    if (!prdMetric.fileFiltering) {
      prdMetric.fileFiltering = createDefaultFileFilteringMetrics();
    }

    const metrics = prdMetric.fileFiltering;
    const duration = (event.data.durationMs as number) || 0;

    switch (event.type) {
      case 'file:filtered':
        metrics.filesFiltered++;
        if (duration > 0) {
          metrics.totalFilteringTimeMs += duration;
          const totalOps = metrics.filesFiltered + metrics.filesAllowed;
          metrics.avgFilteringTimeMs = totalOps > 0 ? metrics.totalFilteringTimeMs / totalOps : 0;
        }
        break;

      case 'file:filtered_predictive':
        metrics.filesFiltered++;
        metrics.predictiveFilters++;
        if (duration > 0) {
          metrics.totalFilteringTimeMs += duration;
          const totalOps = metrics.filesFiltered + metrics.filesAllowed;
          metrics.avgFilteringTimeMs = totalOps > 0 ? metrics.totalFilteringTimeMs / totalOps : 0;
        }
        break;

      case 'file:boundary_violation':
        metrics.boundaryViolations++;
        break;

      case 'file:created':
      case 'file:modified':
        metrics.filesAllowed++;
        if (duration > 0) {
          metrics.totalFilteringTimeMs += duration;
          const totalOps = metrics.filesFiltered + metrics.filesAllowed;
          metrics.avgFilteringTimeMs = totalOps > 0 ? metrics.totalFilteringTimeMs / totalOps : 0;
        }
        break;
    }

    // Mark PRD as needing save (metrics will be saved on next workflow save cycle)
    // Note: We don't save immediately to avoid performance issues with frequent saves
    // Metrics will be persisted when workflow explicitly saves them
    this.pendingSaves.add(prdId);
  }

  /**
   * Update validation metrics from event
   */
  private updateValidationMetrics(event: DevLoopEvent, prdId: string, phaseId?: number): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric) return;

    // Ensure validation metrics exist
    if (!prdMetric.validation) {
      prdMetric.validation = createDefaultValidationMetrics();
    }

    const metrics = prdMetric.validation;
    const duration = (event.data.durationMs as number) || 0;

    switch (event.type) {
      case 'validation:failed':
        metrics.preValidations++;
        metrics.preValidationFailures++;
        const category = (event.data.category as string) || 'unknown';
        metrics.errorsByCategory[category] = (metrics.errorsByCategory[category] || 0) + 1;
        if (duration > 0) {
          metrics.totalValidationTimeMs += duration;
          const totalValidations = metrics.preValidations + metrics.postValidations;
          metrics.avgValidationTimeMs = totalValidations > 0 ? metrics.totalValidationTimeMs / totalValidations : 0;
        }
        break;

      case 'validation:passed':
        metrics.preValidations++;
        if (duration > 0) {
          metrics.totalValidationTimeMs += duration;
          const totalValidations = metrics.preValidations + metrics.postValidations;
          metrics.avgValidationTimeMs = totalValidations > 0 ? metrics.totalValidationTimeMs / totalValidations : 0;
        }
        break;

      case 'validation:error_with_suggestion':
        metrics.preValidations++;
        metrics.preValidationFailures++;
        metrics.recoverySuggestionsGenerated++;
        const errorCategory = (event.data.category as string) || 'unknown';
        metrics.errorsByCategory[errorCategory] = (metrics.errorsByCategory[errorCategory] || 0) + 1;
        if (duration > 0) {
          metrics.totalValidationTimeMs += duration;
          const totalValidations = metrics.preValidations + metrics.postValidations;
          metrics.avgValidationTimeMs = totalValidations > 0 ? metrics.totalValidationTimeMs / totalValidations : 0;
        }
        break;
    }

    // Mark PRD as needing save (metrics will be saved on next workflow save cycle)
    // Note: We don't save immediately to avoid performance issues with frequent saves
    // Metrics will be persisted when workflow explicitly saves them
    this.pendingSaves.add(prdId);
  }

  /**
   * Update IPC metrics from event
   */
  private updateIpcMetrics(event: DevLoopEvent, prdId: string, phaseId?: number): void {
    if (!this.prdMetrics) return;

    const prdMetric = this.prdMetrics.getPrdMetrics(prdId);
    if (!prdMetric) return;

    // Ensure ipc metrics exist
    if (!prdMetric.ipc) {
      prdMetric.ipc = createDefaultIpcMetrics();
    }

    const metrics = prdMetric.ipc;
    const duration = (event.data.durationMs as number) || 0;

    switch (event.type) {
      case 'ipc:connection_failed':
        metrics.connectionsAttempted++;
        metrics.connectionsFailed++;
        if (duration > 0) {
          metrics.totalConnectionTimeMs += duration;
          const count = metrics.connectionsAttempted;
          metrics.avgConnectionTimeMs = count > 0 ? metrics.totalConnectionTimeMs / count : 0;
        }
        break;

      case 'ipc:connection_retry':
        metrics.retries++;
        const retryDuration = duration || (event.data.retryDurationMs as number) || 0;
        if (retryDuration > 0) {
          metrics.totalRetryTimeMs += retryDuration;
          metrics.avgRetryTimeMs = metrics.retries > 0 ? metrics.totalRetryTimeMs / metrics.retries : 0;
        }
        break;

      case 'ipc:health_check':
        metrics.healthChecksPerformed++;
        const failed = (event.data.failed as boolean) || false;
        if (failed) {
          metrics.healthCheckFailures++;
        }
        break;
    }

    // Note: ipc:connection_succeeded not explicitly emitted, but we can infer from successful operations
    // For now, we'll track explicit success if added to event types later

    // Mark PRD as needing save (metrics will be saved on next workflow save cycle)
    // Note: We don't save immediately to avoid performance issues with frequent saves
    // Metrics will be persisted when workflow explicitly saves them
    this.pendingSaves.add(prdId);
  }
}

// Global instance (will be initialized by workflow)
let globalBridge: EventMetricBridge | null = null;

/**
 * Initialize the global event-metric bridge
 */
export function initializeEventMetricBridge(config: MetricUpdaterConfig): EventMetricBridge {
  if (globalBridge) {
    globalBridge.stop();
  }
  globalBridge = new EventMetricBridge(config);
  globalBridge.start();
  return globalBridge;
}

/**
 * Get the global event-metric bridge
 */
export function getEventMetricBridge(): EventMetricBridge | null {
  return globalBridge;
}
