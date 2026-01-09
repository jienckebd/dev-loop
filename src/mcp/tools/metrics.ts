/**
 * MCP Tools for metrics analysis
 * Enables outer agents to analyze metrics, calculate costs, and export data
 */

import { z } from 'zod';
import { MetricsAnalyzer } from '../../core/metrics-analyzer';

const AnalyzerOptionsSchema = z.object({
  prdSetId: z.string().optional().describe('Filter by PRD set ID'),
  timeRangeStart: z.string().optional().describe('Start time (ISO 8601)'),
  timeRangeEnd: z.string().optional().describe('End time (ISO 8601)'),
  limit: z.number().optional().describe('Maximum number of runs to analyze'),
});

/**
 * Register metrics analysis tools with MCP server
 */
export function registerMetricsTools(server: any): void {
  // devloop_metrics_analyze - Get comprehensive metrics analysis
  server.tool(
    'devloop_metrics_analyze',
    'Analyze metrics to get token costs, timing analysis, success rate trends, and recommendations',
    AnalyzerOptionsSchema,
    async (params: z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new MetricsAnalyzer();
      const report = await analyzer.generateAnalysisReport({
        prdSetId: params.prdSetId,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
        limit: params.limit,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(report, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_summary - Get quick summary of metrics
  server.tool(
    'devloop_metrics_summary',
    'Get a quick summary of metrics with key stats and recommendations',
    z.object({}),
    async () => {
      const analyzer = new MetricsAnalyzer();
      const summary = await analyzer.getMetricsSummary();

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(summary, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_token_costs - Get token cost analysis
  server.tool(
    'devloop_metrics_token_costs',
    'Analyze token usage and costs, identify high-cost tasks',
    AnalyzerOptionsSchema,
    async (params: z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new MetricsAnalyzer();
      const tokenCosts = await analyzer.analyzeTokenCosts({
        prdSetId: params.prdSetId,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
        limit: params.limit,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(tokenCosts, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_timing - Get timing analysis
  server.tool(
    'devloop_metrics_timing',
    'Analyze timing patterns, find slowest and fastest tasks',
    AnalyzerOptionsSchema,
    async (params: z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new MetricsAnalyzer();
      const timing = await analyzer.analyzeTimings({
        prdSetId: params.prdSetId,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
        limit: params.limit,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(timing, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_trends - Get success rate trends
  server.tool(
    'devloop_metrics_trends',
    'Get success rate trends over time',
    z.object({
      periodDays: z.number().optional().describe('Number of days per period (default: 7)'),
      ...AnalyzerOptionsSchema.shape,
    }),
    async (params: { periodDays?: number } & z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new MetricsAnalyzer();
      const trends = await analyzer.analyzeSuccessRateTrends(
        params.periodDays || 7,
        {
          prdSetId: params.prdSetId,
          timeRangeStart: params.timeRangeStart,
          timeRangeEnd: params.timeRangeEnd,
          limit: params.limit,
        }
      );

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            trends,
            count: trends.length,
          }, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_export - Export metrics in various formats
  server.tool(
    'devloop_metrics_export',
    'Export metrics in JSON, CSV, or Markdown format',
    z.object({
      format: z.enum(['json', 'csv', 'markdown']).describe('Export format'),
      ...AnalyzerOptionsSchema.shape,
    }),
    async (params: { format: 'json' | 'csv' | 'markdown' } & z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new MetricsAnalyzer();
      const exported = await analyzer.exportMetrics(params.format, {
        prdSetId: params.prdSetId,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
        limit: params.limit,
      });

      return {
        content: [{
          type: 'text',
          text: exported,
        }],
      };
    }
  );
}

