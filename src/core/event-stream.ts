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
  // File filtering
  | 'file:filtered'
  | 'file:created'
  | 'file:modified'
  // Validation
  | 'validation:failed'
  | 'validation:passed'
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
  | 'prd:completed';

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

