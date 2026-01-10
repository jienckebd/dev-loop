/**
 * Event Stream for dev-loop contribution mode
 * Provides structured real-time events for outer agent observation
 */

export type EventType =
  // Task lifecycle
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'task:blocked'
  // Agent events
  | 'agent:started'
  | 'agent:response'
  | 'agent:error'
  | 'agent:prompt_sent'
  | 'agent:response_received'
  // JSON parsing events
  | 'json:parse_failed'
  | 'json:parse_retry'
  | 'json:parse_success'
  | 'json:sanitized'
  | 'json:ai_fallback_success'
  | 'json:ai_fallback_failed'
  | 'json:ai_fallback_error'
  // File filtering
  | 'file:filtered'
  | 'file:filtered_predictive'
  | 'file:created'
  | 'file:modified'
  | 'file:boundary_violation'
  // Validation
  | 'validation:failed'
  | 'validation:passed'
  | 'validation:error_with_suggestion'
  // Unauthorized changes
  | 'change:unauthorized'
  | 'change:reverted'
  // Site health
  | 'health:check_failed'
  | 'health:check_passed'
  // Phase/PRD
  | 'phase:started'
  | 'phase:completed'
  | 'prd:started'
  | 'prd:completed'
  // Metrics/Reports
  | 'metrics:finalized'
  | 'metrics:aggregated'
  | 'report:generated'
  // IPC
  | 'ipc:connection_failed'
  | 'ipc:connection_retry'
  | 'ipc:health_check'
  // Contribution mode issues
  | 'contribution:issue_detected'
  | 'contribution:fix_applied'
  | 'contribution:agent_unblocked'
  | 'contribution:agent_reset'
  // Intervention events (proactive monitoring)
  | 'intervention:triggered'
  | 'intervention:successful'
  | 'intervention:failed'
  | 'intervention:rolled_back'
  | 'intervention:approval_required'
  | 'intervention:rate_limited'
  | 'intervention:possible_regression'
  | 'intervention:fix_applied'
  | 'intervention:error'
  | 'intervention:threshold_exceeded'
  | 'intervention:issue_prevented';

export type EventSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface DevLoopEvent {
  id: string;
  type: EventType;
  timestamp: string;
  severity: EventSeverity;
  data: Record<string, unknown>;
  // Context
  taskId?: string;
  prdId?: string;
  phaseId?: number;
  targetModule?: string;
}

export interface EventFilter {
  types?: EventType[];
  severity?: EventSeverity[];
  since?: string; // Event ID to start from
  taskId?: string;
  prdId?: string;
  limit?: number;
}

/**
 * Singleton event stream for dev-loop
 * Buffers events and provides polling interface
 */
class EventStreamImpl {
  private events: DevLoopEvent[] = [];
  private maxEvents: number = 1000;
  private eventCounter: number = 0;
  private listeners: Array<(event: DevLoopEvent) => void> = [];

  /**
   * Emit a new event to the stream
   */
  emit(
    type: EventType,
    data: Record<string, unknown>,
    options: {
      severity?: EventSeverity;
      taskId?: string;
      prdId?: string;
      phaseId?: number;
      targetModule?: string;
    } = {}
  ): DevLoopEvent {
    const event: DevLoopEvent = {
      id: `evt-${Date.now()}-${++this.eventCounter}`,
      type,
      timestamp: new Date().toISOString(),
      severity: options.severity || 'info',
      data,
      taskId: options.taskId,
      prdId: options.prdId,
      phaseId: options.phaseId,
      targetModule: options.targetModule,
    };

    this.events.push(event);

    // Trim buffer if needed
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // Don't let listener errors break event emission
        console.error('[EventStream] Listener error:', error);
      }
    }

    return event;
  }

  /**
   * Poll for events matching filter criteria
   */
  poll(filter: EventFilter = {}): DevLoopEvent[] {
    let result = [...this.events];

    // Filter by 'since' event ID
    if (filter.since) {
      const sinceIndex = result.findIndex(e => e.id === filter.since);
      if (sinceIndex !== -1) {
        result = result.slice(sinceIndex + 1);
      }
    }

    // Filter by types
    if (filter.types && filter.types.length > 0) {
      result = result.filter(e => filter.types!.includes(e.type));
    }

    // Filter by severity
    if (filter.severity && filter.severity.length > 0) {
      result = result.filter(e => filter.severity!.includes(e.severity));
    }

    // Filter by taskId
    if (filter.taskId) {
      result = result.filter(e => e.taskId === filter.taskId);
    }

    // Filter by prdId
    if (filter.prdId) {
      result = result.filter(e => e.prdId === filter.prdId);
    }

    // Apply limit
    if (filter.limit && filter.limit > 0) {
      result = result.slice(-filter.limit);
    }

    return result;
  }

  /**
   * Get the latest N events
   */
  getLatest(count: number = 10): DevLoopEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Get all events of a specific type
   */
  getByType(type: EventType): DevLoopEvent[] {
    return this.events.filter(e => e.type === type);
  }

  /**
   * Get events with severity >= warn (warnings and errors)
   */
  getIssues(): DevLoopEvent[] {
    return this.events.filter(e => e.severity === 'warn' || e.severity === 'error' || e.severity === 'critical');
  }

  /**
   * Get blocked task events
   */
  getBlockedTasks(): DevLoopEvent[] {
    return this.events.filter(e => e.type === 'task:blocked');
  }

  /**
   * Get filtered file events
   */
  getFilteredFiles(): DevLoopEvent[] {
    return this.events.filter(e => e.type === 'file:filtered');
  }

  /**
   * Add an event listener (callback when events are emitted)
   */
  addListener(listener: (event: DevLoopEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Remove an event listener
   */
  removeListener(listener: (event: DevLoopEvent) => void): void {
    const index = this.listeners.indexOf(listener);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
    this.eventCounter = 0;
  }

  /**
   * Get event count
   */
  count(): number {
    return this.events.length;
  }

  /**
   * Get the last event ID (for polling continuation)
   */
  getLastEventId(): string | null {
    if (this.events.length === 0) return null;
    return this.events[this.events.length - 1].id;
  }

  /**
   * Get events within a time range
   */
  getByTimeRange(startTime: string, endTime?: string): DevLoopEvent[] {
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();

    return this.events.filter(e => {
      const eventTime = new Date(e.timestamp).getTime();
      return eventTime >= start && eventTime <= end;
    });
  }

  /**
   * Get JSON parsing events
   */
  getJsonParsingEvents(): DevLoopEvent[] {
    return this.events.filter(e =>
      e.type === 'json:parse_failed' ||
      e.type === 'json:parse_retry' ||
      e.type === 'json:parse_success' ||
      e.type === 'json:sanitized' ||
      e.type === 'json:ai_fallback_success' ||
      e.type === 'json:ai_fallback_failed' ||
      e.type === 'json:ai_fallback_error'
    );
  }

  /**
   * Get analytics summary for events
   */
  getAnalytics(): {
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    byPrdId: Record<string, number>;
    totalEvents: number;
    issueCount: number;
    jsonParseFailures: number;
    jsonParseSuccesses: number;
    fileFilteredCount: number;
  } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byPrdId: Record<string, number> = {};
    let issueCount = 0;
    let jsonParseFailures = 0;
    let jsonParseSuccesses = 0;
    let fileFilteredCount = 0;

    for (const event of this.events) {
      // Count by type
      byType[event.type] = (byType[event.type] || 0) + 1;

      // Count by severity
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;

      // Count by PRD ID
      if (event.prdId) {
        byPrdId[event.prdId] = (byPrdId[event.prdId] || 0) + 1;
      }

      // Track issues
      if (event.severity === 'warn' || event.severity === 'error' || event.severity === 'critical') {
        issueCount++;
      }

      // Track JSON parsing
      if (event.type === 'json:parse_failed') {
        jsonParseFailures++;
      } else if (event.type === 'json:parse_success') {
        jsonParseSuccesses++;
      }

      // Track file filtering
      if (event.type === 'file:filtered' || event.type === 'file:filtered_predictive') {
        fileFilteredCount++;
      }
    }

    return {
      byType,
      bySeverity,
      byPrdId,
      totalEvents: this.events.length,
      issueCount,
      jsonParseFailures,
      jsonParseSuccesses,
      fileFilteredCount,
    };
  }

  /**
   * Aggregate similar events (group by type and data key)
   */
  aggregateEvents(groupBy: 'type' | 'taskId' | 'prdId' = 'type'): Array<{
    key: string;
    count: number;
    lastOccurrence: string;
    events: DevLoopEvent[];
  }> {
    const groups: Record<string, DevLoopEvent[]> = {};

    for (const event of this.events) {
      let key: string;
      switch (groupBy) {
        case 'type':
          key = event.type;
          break;
        case 'taskId':
          key = event.taskId || 'no-task';
          break;
        case 'prdId':
          key = event.prdId || 'no-prd';
          break;
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(event);
    }

    return Object.entries(groups).map(([key, events]) => ({
      key,
      count: events.length,
      lastOccurrence: events[events.length - 1].timestamp,
      events,
    }));
  }
}

// Singleton instance
let eventStreamInstance: EventStreamImpl | null = null;

/**
 * Get the global event stream instance
 */
export function getEventStream(): EventStreamImpl {
  if (!eventStreamInstance) {
    eventStreamInstance = new EventStreamImpl();
  }
  return eventStreamInstance;
}

/**
 * Convenience function to emit an event
 */
export function emitEvent(
  type: EventType,
  data: Record<string, unknown>,
  options: {
    severity?: EventSeverity;
    taskId?: string;
    prdId?: string;
    phaseId?: number;
    targetModule?: string;
  } = {}
): DevLoopEvent {
  return getEventStream().emit(type, data, options);
}

export { EventStreamImpl };

