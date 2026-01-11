/**
 * Enhanced Observation MCP Tools
 * 
 * Provides better observability of inner agent behavior and patterns.
 */

import { z } from 'zod';
import { getEventStream } from '../../core/utils/event-stream';
import { logger } from '../../core/utils/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Register enhanced observation tools with MCP server
 */
export function registerObservationEnhancedTools(server: any): void {
  // devloop_pattern_detection - Detect recurring patterns in failures/blocked tasks
  server.tool(
    'devloop_pattern_detection',
    'Detect recurring patterns in failures, blocked tasks, and errors. Identifies common root causes.',
    z.object({
      eventTypes: z.array(z.string()).optional().describe('Filter by event types (e.g., ["task:blocked", "validation:failed"])'),
      timeRange: z.number().optional().describe('Time range in hours to analyze (default: 24)'),
      minOccurrences: z.number().optional().describe('Minimum occurrences to be considered a pattern (default: 3)'),
    }),
    async (params: { eventTypes?: string[]; timeRange?: number; minOccurrences?: number }) => {
      try {
        const eventStream = getEventStream();
        const timeRangeMs = (params.timeRange || 24) * 3600000;
        const cutoffTime = new Date(Date.now() - timeRangeMs).toISOString();

        // Get events within time range
        let events = eventStream.getByTimeRange(cutoffTime);

        // Filter by event types if specified (cast to EventType for filtering)
        if (params.eventTypes && params.eventTypes.length > 0) {
          const eventTypeSet = new Set<string>(params.eventTypes);
          events = events.filter(e => eventTypeSet.has(e.type));
        }

        // Focus on failures and blocked tasks
        const failureEvents = events.filter(e => 
          (e.type === 'task:blocked' || 
          e.type === 'task:failed' || 
          e.type === 'validation:failed' ||
          e.severity === 'error' ||
          e.severity === 'critical') as boolean
        );

        // Group by error message/pattern
        const patterns = new Map<string, {
          occurrences: number;
          events: typeof failureEvents;
          firstSeen: string;
          lastSeen: string;
          commonContext: Record<string, unknown>;
        }>();

        for (const event of failureEvents) {
          // Extract pattern key from event
          let patternKey: string = event.type;
          
          if (event.data.reason && typeof event.data.reason === 'string') {
            patternKey = `${event.type}:${event.data.reason}`;
          } else if (event.data.error && typeof event.data.error === 'string') {
            patternKey = `${event.type}:${event.data.error.substring(0, 100)}`;
          }

          if (!patterns.has(patternKey)) {
            patterns.set(patternKey, {
              occurrences: 0,
              events: [],
              firstSeen: event.timestamp,
              lastSeen: event.timestamp,
              commonContext: {},
            });
          }

          const pattern = patterns.get(patternKey)!;
          pattern.occurrences++;
          pattern.events.push(event);
          
          if (event.timestamp < pattern.firstSeen) {
            pattern.firstSeen = event.timestamp;
          }
          if (event.timestamp > pattern.lastSeen) {
            pattern.lastSeen = event.timestamp;
          }
        }

        // Filter by minimum occurrences
        const minOccurrences = params.minOccurrences || 3;
        const significantPatterns = Array.from(patterns.entries())
          .filter(([_, pattern]) => pattern.occurrences >= minOccurrences)
          .map(([key, pattern]) => ({
            pattern: key,
            occurrences: pattern.occurrences,
            firstSeen: pattern.firstSeen,
            lastSeen: pattern.lastSeen,
            eventTypes: Array.from(new Set(pattern.events.map(e => e.type))),
            taskIds: Array.from(new Set(pattern.events.map(e => e.taskId).filter(Boolean))),
            severity: pattern.events[0].severity,
          }))
          .sort((a, b) => b.occurrences - a.occurrences);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              patterns: significantPatterns,
              totalPatterns: significantPatterns.length,
              totalEvents: failureEvents.length,
              timeRange: params.timeRange || 24,
              minOccurrences,
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[ObservationEnhanced] Error detecting patterns:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  // devloop_codebase_health - Analyze codebase health metrics
  server.tool(
    'devloop_codebase_health',
    'Analyze codebase health metrics including test coverage, complexity, and tech debt indicators',
    z.object({
      targetModule: z.string().optional().describe('Specific module to analyze (if not provided, analyzes all)'),
      metrics: z.array(z.enum(['coverage', 'complexity', 'tech-debt', 'test-quality'])).optional().describe('Specific metrics to analyze'),
    }),
    async (params: { targetModule?: string; metrics?: string[] }) => {
      try {
        // This would integrate with code quality scanning tools
        // For now, provide a placeholder that returns structured response
        
        const healthMetrics: any = {
          coverage: {
            enabled: false,
            message: 'Coverage analysis requires integration with test coverage tools',
          },
          complexity: {
            enabled: false,
            message: 'Complexity analysis requires integration with static analysis tools',
          },
          techDebt: {
            enabled: false,
            message: 'Tech debt analysis requires integration with code quality tools',
          },
          testQuality: {
            enabled: false,
            message: 'Test quality analysis requires test execution data',
          },
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              targetModule: params.targetModule || 'all',
              metrics: healthMetrics,
              note: 'Full codebase health analysis requires Phase 3 code quality tools integration',
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[ObservationEnhanced] Error analyzing codebase health:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  // devloop_session_analysis - Analyze session usage patterns and identify pollution
  server.tool(
    'devloop_session_analysis',
    'Analyze session usage patterns to detect session pollution (sessions shared across modules)',
    z.object({
      timeRange: z.number().optional().describe('Time range in hours to analyze (default: 24)'),
    }),
    async (params: { timeRange?: number }) => {
      try {
        const sessionsPath = path.join(process.cwd(), '.devloop/execution-state.json'); // Sessions now in execution-state.json
        
        if (!fs.existsSync(sessionsPath)) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                sessions: [],
                pollution: [],
                message: 'No session data found',
              }, null, 2),
            }],
          };
        }

        const sessionsData = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
        const sessions = sessionsData.sessions || [];

        // Analyze session pollution (sessions used for multiple modules)
        const sessionModules = new Map<string, Set<string>>();
        const pollution: Array<{
          sessionId: string;
          modules: string[];
          taskIds: string[];
          timestamp: string;
        }> = [];

        for (const session of sessions) {
          const sessionId = session.sessionId || session.id;
          if (!sessionId) continue;

          const modules = new Set<string>();
          const taskIds: string[] = [];

          // Extract modules and tasks from session history
          const history = session.history || [];
          for (const entry of history) {
            if (entry.targetModule && typeof entry.targetModule === 'string') {
              modules.add(entry.targetModule);
            }
            if (entry.taskId && typeof entry.taskId === 'string') {
              taskIds.push(entry.taskId);
            }
          }

          if (modules.size > 1) {
            pollution.push({
              sessionId,
              modules: Array.from(modules),
              taskIds: Array.from(new Set(taskIds.filter((id): id is string => typeof id === 'string' && id.length > 0))),
              timestamp: session.createdAt || session.timestamp || new Date().toISOString(),
            });
          }

          sessionModules.set(sessionId, modules);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalSessions: sessions.length,
              pollutedSessions: pollution.length,
              pollutionRate: sessions.length > 0 ? pollution.length / sessions.length : 0,
              pollution,
              sessionsByModule: Object.fromEntries(
                Array.from(sessionModules.entries()).map(([id, modules]) => [id, Array.from(modules)])
              ),
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[ObservationEnhanced] Error analyzing sessions:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  // devloop_context_gap_detection - Identify missing context that causes failures
  server.tool(
    'devloop_context_gap_detection',
    'Identify missing context that causes task failures. Analyzes failed tasks to find common missing context patterns.',
    z.object({
      taskIds: z.array(z.string()).optional().describe('Specific task IDs to analyze (if not provided, analyzes all failed tasks)'),
      timeRange: z.number().optional().describe('Time range in hours to analyze (default: 24)'),
    }),
    async (params: { taskIds?: string[]; timeRange?: number }) => {
      try {
        const eventStream = getEventStream();
        const timeRangeMs = (params.timeRange || 24) * 3600000;
        const cutoffTime = new Date(Date.now() - timeRangeMs).toISOString();

        // Get failed task events
        let failedEvents = eventStream.getByTimeRange(cutoffTime)
          .filter(e => e.type === 'task:failed' || e.type === 'task:blocked');

        // Filter by task IDs if specified
        if (params.taskIds && params.taskIds.length > 0) {
          failedEvents = failedEvents.filter(e => params.taskIds!.includes(e.taskId || ''));
        }

        // Extract context gaps from error messages
        const contextGaps: Array<{
          pattern: string;
          occurrences: number;
          affectedTasks: string[];
          suggestedContext: string;
        }> = [];

        const gapPatterns = [
          { pattern: /missing.*module|module.*not found/i, suggested: 'Target module context' },
          { pattern: /undefined|not defined/i, suggested: 'Variable/function definitions' },
          { pattern: /cannot read property|cannot access/i, suggested: 'Object structure context' },
          { pattern: /file not found|does not exist/i, suggested: 'File path context' },
          { pattern: /import.*error|require.*error/i, suggested: 'Import/dependency context' },
        ];

        for (const gapPattern of gapPatterns) {
          const matchingEvents = failedEvents.filter(e => {
            const error = (e.data.error as string) || (e.data.reason as string) || '';
            return gapPattern.pattern.test(error);
          });

          if (matchingEvents.length > 0) {
            contextGaps.push({
              pattern: gapPattern.pattern.source,
              occurrences: matchingEvents.length,
              affectedTasks: Array.from(new Set(matchingEvents.map(e => e.taskId).filter((id): id is string => typeof id === 'string' && id.length > 0))),
              suggestedContext: gapPattern.suggested,
            });
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              totalFailedTasks: failedEvents.length,
              contextGaps,
              recommendations: contextGaps.length > 0
                ? [
                    'Consider enhancing code context provider with missing information',
                    'Add target module information to all task prompts',
                    'Include file structure context in AI prompts',
                  ]
                : ['No clear context gaps detected'],
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[ObservationEnhanced] Error detecting context gaps:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  // devloop_dependency_graph - Visualize task and code dependencies
  server.tool(
    'devloop_dependency_graph',
    'Generate dependency graph for tasks and code. Shows relationships between tasks and code files.',
    z.object({
      taskIds: z.array(z.string()).optional().describe('Specific task IDs to include in graph'),
      format: z.enum(['json', 'dot', 'mermaid']).optional().describe('Output format (default: json)'),
    }),
    async (params: { taskIds?: string[]; format?: string }) => {
      try {
        // Load task dependencies from tasks.json
        const tasksPath = path.join(process.cwd(), '.taskmaster/tasks/tasks.json');
        
        if (!fs.existsSync(tasksPath)) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Tasks file not found',
              }, null, 2),
            }],
          };
        }

        const tasksData = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
        const tasks = tasksData.tasks || [];

        // Build dependency graph
        const graph: {
          nodes: Array<{ id: string; label: string; type: string }>;
          edges: Array<{ from: string; to: string; type: string }>;
        } = {
          nodes: [],
          edges: [],
        };

        // Filter tasks if specified
        const relevantTasks = params.taskIds && params.taskIds.length > 0
          ? tasks.filter((t: any) => params.taskIds!.includes(t.id))
          : tasks;

        for (const task of relevantTasks) {
          graph.nodes.push({
            id: task.id,
            label: task.title || task.id,
            type: task.status || 'unknown',
          });

          // Add dependencies
          if (task.dependsOn && Array.isArray(task.dependsOn)) {
            for (const depId of task.dependsOn) {
              graph.edges.push({
                from: depId,
                to: task.id,
                type: 'depends_on',
              });
            }
          }
        }

        // Format output
        if (params.format === 'mermaid') {
          let mermaid = 'graph TD\n';
          for (const node of graph.nodes) {
            mermaid += `  ${node.id}["${node.label}"]\n`;
          }
          for (const edge of graph.edges) {
            mermaid += `  ${edge.from} --> ${edge.to}\n`;
          }

          return {
            content: [{
              type: 'text',
              text: mermaid,
            }],
          };
        } else if (params.format === 'dot') {
          let dot = 'digraph dependencies {\n';
          for (const node of graph.nodes) {
            dot += `  "${node.id}" [label="${node.label}"];\n`;
          }
          for (const edge of graph.edges) {
            dot += `  "${edge.from}" -> "${edge.to}";\n`;
          }
          dot += '}\n';

          return {
            content: [{
              type: 'text',
              text: dot,
            }],
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              graph,
              totalNodes: graph.nodes.length,
              totalEdges: graph.edges.length,
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[ObservationEnhanced] Error generating dependency graph:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  logger.info('[MCP] Registered enhanced observation tools (pattern_detection, codebase_health, session_analysis, context_gap_detection, dependency_graph)');
}
