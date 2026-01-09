/**
 * MCP Tools for dev-loop event streaming
 * Enables outer agents to poll structured events instead of parsing logs
 */

import { z } from 'zod';
import { getEventStream, EventType, EventSeverity } from '../../core/event-stream';

/**
 * Schema for event poll parameters
 */
const EventPollSchema = z.object({
  since: z.string().optional().describe('Event ID to start from (exclusive)'),
  types: z.array(z.string()).optional().describe('Filter by event types'),
  severity: z.array(z.enum(['info', 'warn', 'error', 'critical'])).optional().describe('Filter by severity levels'),
  taskId: z.string().optional().describe('Filter by task ID'),
  prdId: z.string().optional().describe('Filter by PRD ID'),
  limit: z.number().optional().describe('Maximum number of events to return'),
});

/**
 * Register event streaming tools with MCP server
 */
export function registerEventTools(server: any): void {
  // devloop_events_poll - Get events since last check
  server.tool(
    'devloop_events_poll',
    'Poll for new events since last check. Returns structured events for outer agent observation.',
    EventPollSchema,
    async (params: z.infer<typeof EventPollSchema>) => {
      const eventStream = getEventStream();

      const filter = {
        since: params.since,
        types: params.types as EventType[] | undefined,
        severity: params.severity as EventSeverity[] | undefined,
        taskId: params.taskId,
        prdId: params.prdId,
        limit: params.limit,
      };

      const events = eventStream.poll(filter);
      const lastEventId = eventStream.getLastEventId();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            events,
            count: events.length,
            lastEventId,
            hasMore: events.length === (params.limit || Infinity),
          }, null, 2),
        }],
      };
    }
  );

  // devloop_events_latest - Get N most recent events
  server.tool(
    'devloop_events_latest',
    'Get the N most recent events (default: 10)',
    z.object({
      count: z.number().optional().describe('Number of events to return (default: 10)'),
    }),
    async (params: { count?: number }) => {
      const eventStream = getEventStream();
      const events = eventStream.getLatest(params.count || 10);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            events,
            count: events.length,
            totalEvents: eventStream.count(),
          }, null, 2),
        }],
      };
    }
  );

  // devloop_blocked_tasks - Get list of blocked tasks
  server.tool(
    'devloop_blocked_tasks',
    'Get list of tasks that are blocked (exceeded max retries)',
    z.object({}),
    async () => {
      const eventStream = getEventStream();
      const blockedEvents = eventStream.getBlockedTasks();

      // Extract unique blocked tasks
      const blockedTasks = blockedEvents.map(e => ({
        taskId: e.data.taskId,
        reason: e.data.reason,
        retryCount: e.data.retryCount,
        lastError: e.data.lastError,
        timestamp: e.timestamp,
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            blockedTasks,
            count: blockedTasks.length,
          }, null, 2),
        }],
      };
    }
  );

  // devloop_filtered_files - Get list of files that were filtered out
  server.tool(
    'devloop_filtered_files',
    'Get list of files that were filtered out (outside target module)',
    z.object({
      taskId: z.string().optional().describe('Filter by task ID'),
    }),
    async (params: { taskId?: string }) => {
      const eventStream = getEventStream();
      let filteredEvents = eventStream.getFilteredFiles();

      if (params.taskId) {
        filteredEvents = filteredEvents.filter(e => e.taskId === params.taskId);
      }

      const filteredFiles = filteredEvents.map(e => ({
        path: e.data.path,
        targetModule: e.data.targetModule,
        reason: e.data.reason,
        operation: e.data.operation,
        taskId: e.taskId,
        timestamp: e.timestamp,
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            filteredFiles,
            count: filteredFiles.length,
          }, null, 2),
        }],
      };
    }
  );

  // devloop_issues - Get all warning/error events
  server.tool(
    'devloop_issues',
    'Get all events with severity warn, error, or critical',
    z.object({
      limit: z.number().optional().describe('Maximum number of issues to return'),
    }),
    async (params: { limit?: number }) => {
      const eventStream = getEventStream();
      let issues = eventStream.getIssues();

      if (params.limit && params.limit > 0) {
        issues = issues.slice(-params.limit);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            issues,
            count: issues.length,
          }, null, 2),
        }],
      };
    }
  );

  // devloop_events_clear - Clear event buffer (for testing)
  server.tool(
    'devloop_events_clear',
    'Clear the event buffer (for testing/reset)',
    z.object({}),
    async () => {
      const eventStream = getEventStream();
      const previousCount = eventStream.count();
      eventStream.clear();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            cleared: true,
            previousCount,
          }, null, 2),
        }],
      };
    }
  );

  // devloop_events_analytics - Get analytics summary
  server.tool(
    'devloop_events_analytics',
    'Get analytics summary of all events (counts by type, severity, JSON parse stats)',
    z.object({}),
    async () => {
      const eventStream = getEventStream();
      const analytics = eventStream.getAnalytics();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            analytics,
            jsonParseSuccessRate: analytics.jsonParseSuccesses + analytics.jsonParseFailures > 0
              ? (analytics.jsonParseSuccesses / (analytics.jsonParseSuccesses + analytics.jsonParseFailures) * 100).toFixed(1) + '%'
              : 'N/A',
          }, null, 2),
        }],
      };
    }
  );

  // devloop_json_parsing_events - Get JSON parsing specific events
  server.tool(
    'devloop_json_parsing_events',
    'Get all JSON parsing events (failures, retries, successes, sanitizations)',
    z.object({
      limit: z.number().optional().describe('Maximum number of events to return'),
    }),
    async (params: { limit?: number }) => {
      const eventStream = getEventStream();
      let events = eventStream.getJsonParsingEvents();

      if (params.limit && params.limit > 0) {
        events = events.slice(-params.limit);
      }

      const summary = {
        failures: events.filter(e => e.type === 'json:parse_failed').length,
        retries: events.filter(e => e.type === 'json:parse_retry').length,
        successes: events.filter(e => e.type === 'json:parse_success').length,
        sanitizations: events.filter(e => e.type === 'json:sanitized').length,
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            events,
            summary,
            count: events.length,
          }, null, 2),
        }],
      };
    }
  );

  // devloop_events_by_time_range - Get events within time range
  server.tool(
    'devloop_events_by_time_range',
    'Get events within a specific time range',
    z.object({
      startTime: z.string().describe('Start time (ISO 8601 format)'),
      endTime: z.string().optional().describe('End time (ISO 8601 format, defaults to now)'),
    }),
    async (params: { startTime: string; endTime?: string }) => {
      const eventStream = getEventStream();
      const events = eventStream.getByTimeRange(params.startTime, params.endTime);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            events,
            count: events.length,
            timeRange: {
              start: params.startTime,
              end: params.endTime || new Date().toISOString(),
            },
          }, null, 2),
        }],
      };
    }
  );

  // devloop_events_aggregate - Aggregate events by key
  server.tool(
    'devloop_events_aggregate',
    'Aggregate events by type, taskId, or prdId',
    z.object({
      groupBy: z.enum(['type', 'taskId', 'prdId']).optional().describe('Field to group by (default: type)'),
    }),
    async (params: { groupBy?: 'type' | 'taskId' | 'prdId' }) => {
      const eventStream = getEventStream();
      const aggregated = eventStream.aggregateEvents(params.groupBy || 'type');

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            aggregated: aggregated.map(g => ({
              key: g.key,
              count: g.count,
              lastOccurrence: g.lastOccurrence,
            })),
            groupBy: params.groupBy || 'type',
            totalGroups: aggregated.length,
          }, null, 2),
        }],
      };
    }
  );
}

