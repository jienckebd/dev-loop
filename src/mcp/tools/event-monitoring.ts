/**
 * MCP Tools for Proactive Event Monitoring
 * 
 * Provides tools for outer agents to control and monitor the event monitoring service.
 */

import { z } from 'zod';
import { initializeEventMonitor, EventMonitorService } from '../../core/monitoring/event-monitor';
import { loadConfig } from '../../config/loader';
import { logger } from '../../core/utils/logger';
import { getInterventionMetricsTracker } from '../../core/metrics/intervention-metrics';
import { getEventStream } from '../../core/utils/event-stream';

// Store monitor service instance (initialized lazily)
let monitorServiceInstance: EventMonitorService | null = null;

function getMonitorService(): EventMonitorService | null {
  if (!monitorServiceInstance) {
    // Lazy initialization - config will be loaded when needed
    // For now, return null if not initialized
    return null;
  }
  return monitorServiceInstance;
}

async function ensureMonitorService(): Promise<EventMonitorService> {
  if (!monitorServiceInstance) {
    const config = await loadConfig();
    monitorServiceInstance = initializeEventMonitor(config);
  }
  return monitorServiceInstance;
}

/**
 * Register event monitoring tools with MCP server
 */
export function registerEventMonitoringTools(server: any): void {
  // devloop_event_monitor_start - Start proactive event monitoring service
  server.tool(
    'devloop_event_monitor_start',
    'Start proactive event monitoring service that automatically detects issues and applies fixes',
    z.object({}),
    async () => {
      try {
        const monitor = await ensureMonitorService();
        monitor.start();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              status: 'started',
              message: 'Event monitoring service started',
              config: monitor.getStatus(),
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[EventMonitoring] Error starting monitor:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  // devloop_event_monitor_stop - Stop monitoring service
  server.tool(
    'devloop_event_monitor_stop',
    'Stop proactive event monitoring service',
    z.object({}),
    async () => {
      try {
        const monitor = getMonitorService();
        if (!monitor) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Monitor service not initialized',
              }, null, 2),
            }],
          };
        }

        monitor.stop();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              status: 'stopped',
              message: 'Event monitoring service stopped',
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[EventMonitoring] Error stopping monitor:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  // devloop_event_monitor_status - Get monitoring status and intervention statistics
  server.tool(
    'devloop_event_monitor_status',
    'Get event monitoring service status and intervention statistics',
    z.object({}),
    async () => {
      try {
        const monitor = getMonitorService();
        const tracker = getInterventionMetricsTracker();
        const eventStream = getEventStream();

        const status = monitor ? monitor.getStatus() : {
          isRunning: false,
          enabled: false,
          lastPollTimestamp: null,
          interventionCount: 0,
          interventionsThisHour: 0,
        };

        const metrics = tracker.getMetrics();
        const effectiveness = tracker.getEffectivenessAnalysis();

        // Get recent interventions
        const recentInterventions = tracker.getRecords(10);

        // Get recent intervention events
        const interventionEvents = eventStream.poll({
          types: [
            'intervention:triggered' as any,
            'intervention:successful' as any,
            'intervention:failed' as any,
            'intervention:rolled_back' as any,
          ],
          limit: 20,
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              status,
              metrics: {
                totalInterventions: metrics.totalInterventions,
                successRate: metrics.successRate,
                successfulInterventions: metrics.successfulInterventions,
                failedInterventions: metrics.failedInterventions,
                rolledBackInterventions: metrics.rolledBackInterventions,
              },
              effectiveness,
              recentInterventions,
              recentEvents: interventionEvents.map(e => ({
                type: e.type,
                timestamp: e.timestamp,
                data: e.data,
              })),
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[EventMonitoring] Error getting status:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  // devloop_event_monitor_configure - Configure intervention thresholds and actions
  server.tool(
    'devloop_event_monitor_configure',
    'Configure event monitoring thresholds and action settings',
    z.object({
      pollingInterval: z.number().optional().describe('Polling interval in milliseconds'),
      thresholds: z.record(z.object({
        count: z.number().optional(),
        rate: z.number().optional(),
        windowMs: z.number().optional(),
        autoAction: z.boolean().optional(),
        confidence: z.number().optional(),
      })).optional().describe('Threshold configurations by event type'),
      actions: z.object({
        requireApproval: z.array(z.string()).optional(),
        autoExecute: z.array(z.string()).optional(),
        maxInterventionsPerHour: z.number().optional(),
      }).optional(),
    }),
    async (params: any) => {
      try {
        const monitor = await ensureMonitorService();

        const config: any = {};
        if (params.pollingInterval !== undefined) {
          config.pollingInterval = params.pollingInterval;
        }
        if (params.thresholds !== undefined) {
          config.thresholds = params.thresholds;
        }
        if (params.actions !== undefined) {
          config.actions = params.actions;
        }

        monitor.updateConfig(config);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'Configuration updated',
              status: monitor.getStatus(),
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[EventMonitoring] Error configuring monitor:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  // devloop_event_monitor_interventions - Get list of recent interventions and their outcomes
  server.tool(
    'devloop_event_monitor_interventions',
    'Get list of recent interventions and their outcomes',
    z.object({
      limit: z.number().optional().describe('Maximum number of interventions to return (default: 50)'),
      issueType: z.string().optional().describe('Filter by issue type'),
      success: z.boolean().optional().describe('Filter by success status'),
    }),
    async (params: { limit?: number; issueType?: string; success?: boolean }) => {
      try {
        const tracker = getInterventionMetricsTracker();
        let records = tracker.getRecords(params.limit || 50);

        // Apply filters
        if (params.issueType) {
          records = records.filter(r => r.issueType === params.issueType);
        }

        if (params.success !== undefined) {
          records = records.filter(r => r.success === params.success);
        }

        // Group by issue type for summary
        const byIssueType: Record<string, number> = {};
        for (const record of records) {
          byIssueType[record.issueType] = (byIssueType[record.issueType] || 0) + 1;
        }

        // Calculate success rates
        const successRate = records.length > 0
          ? records.filter(r => r.success).length / records.length
          : 0;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              interventions: records,
              summary: {
                total: records.length,
                successful: records.filter(r => r.success).length,
                failed: records.filter(r => !r.success).length,
                rolledBack: records.filter(r => r.rollbackRequired).length,
                successRate,
                byIssueType,
              },
            }, null, 2),
          }],
        };
      } catch (error) {
        logger.error('[EventMonitoring] Error getting interventions:', error);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            }, null, 2),
          }],
        };
      }
    }
  );

  logger.info('[MCP] Registered event monitoring tools (start, stop, status, configure, interventions)');
}
