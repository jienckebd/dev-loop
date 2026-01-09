/**
 * MCP Tools for metrics analysis
 * Enables outer agents to analyze metrics, calculate costs, and export data
 */

import { z } from 'zod';
import { MetricsAnalyzer } from '../../core/metrics-analyzer';
import { PrdSetMetrics } from '../../core/prd-set-metrics';
import { PrdMetrics } from '../../core/prd-metrics';

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

  // ===== Enhanced Metrics Tools =====

  // devloop_metrics_json_parsing - Get JSON parsing metrics
  server.tool(
    'devloop_metrics_json_parsing',
    'Get JSON parsing success rates by strategy, AI fallback usage, and failure patterns',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              jsonParsing: enhancedMetrics?.jsonParsing || null,
            }, null, 2),
          }],
        };
      }

      // Get all sets and aggregate
      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const jsonParsingMetrics = allSets
        .filter(s => s.jsonParsing)
        .map(s => ({
          setId: s.setId,
          jsonParsing: s.jsonParsing,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(jsonParsingMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_ipc - Get IPC connection metrics
  server.tool(
    'devloop_metrics_ipc',
    'Get IPC connection health metrics, retries, and health check results',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              ipc: enhancedMetrics?.ipc || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const ipcMetrics = allSets
        .filter(s => s.ipc)
        .map(s => ({
          setId: s.setId,
          ipc: s.ipc,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(ipcMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_file_filtering - Get file filtering metrics
  server.tool(
    'devloop_metrics_file_filtering',
    'Get file filtering statistics, boundary violations, and predictive filter usage',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              fileFiltering: enhancedMetrics?.fileFiltering || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const fileFilteringMetrics = allSets
        .filter(s => s.fileFiltering)
        .map(s => ({
          setId: s.setId,
          fileFiltering: s.fileFiltering,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(fileFilteringMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_validation - Get validation gate metrics
  server.tool(
    'devloop_metrics_validation',
    'Get validation gate success rates, error categories, and recovery suggestions',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              validation: enhancedMetrics?.validation || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const validationMetrics = allSets
        .filter(s => s.validation)
        .map(s => ({
          setId: s.setId,
          validation: s.validation,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(validationMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_context - Get context management metrics
  server.tool(
    'devloop_metrics_context',
    'Get context building efficiency, search operations, and window utilization',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              context: enhancedMetrics?.context || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const contextMetrics = allSets
        .filter(s => s.context)
        .map(s => ({
          setId: s.setId,
          context: s.context,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(contextMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_codebase - Get codebase management metrics
  server.tool(
    'devloop_metrics_codebase',
    'Get codebase search, file discovery, file operations, and indexing metrics',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              codebase: enhancedMetrics?.codebase || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const codebaseMetrics = allSets
        .filter(s => s.codebase)
        .map(s => ({
          setId: s.setId,
          codebase: s.codebase,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(codebaseMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_session - Get session management metrics
  server.tool(
    'devloop_metrics_session',
    'Get session health, persistence, history management, and lifespan metrics',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              sessions: enhancedMetrics?.sessions || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const sessionMetrics = allSets
        .filter(s => s.sessions)
        .map(s => ({
          setId: s.setId,
          sessions: s.sessions,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(sessionMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_token_breakdown - Get token usage by feature
  server.tool(
    'devloop_metrics_token_breakdown',
    'Get token usage breakdown by feature (code generation, AI fallback, retry, error analysis)',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              tokenBreakdown: enhancedMetrics?.tokenBreakdown || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const tokenBreakdownMetrics = allSets
        .filter(s => s.tokens.byFeature)
        .map(s => ({
          setId: s.setId,
          tokenBreakdown: s.tokens.byFeature,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(tokenBreakdownMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_timing_breakdown - Get timing breakdown by operation
  server.tool(
    'devloop_metrics_timing_breakdown',
    'Get timing breakdown by operation type (JSON parsing, file filtering, validation, IPC, etc.)',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              timingBreakdown: enhancedMetrics?.timingBreakdown || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const timingBreakdownMetrics = allSets
        .filter(s => s.timing.breakdown)
        .map(s => ({
          setId: s.setId,
          timingBreakdown: s.timing.breakdown,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(timingBreakdownMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_contribution_mode - Get contribution mode metrics
  server.tool(
    'devloop_metrics_contribution_mode',
    'Get contribution mode metrics (outer agent observations, fixes applied, root cause vs workaround)',
    z.object({
      setId: z.string().optional().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId?: string }) => {
      const prdSetMetrics = new PrdSetMetrics();

      if (params.setId) {
        const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              setId: params.setId,
              contributionMode: enhancedMetrics?.contributionMode || null,
            }, null, 2),
          }],
        };
      }

      const allSets = prdSetMetrics.getAllPrdSetMetrics();
      const contributionModeMetrics = allSets
        .filter(s => s.contributionMode)
        .map(s => ({
          setId: s.setId,
          contributionMode: s.contributionMode,
        }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(contributionModeMetrics, null, 2),
        }],
      };
    }
  );

  // devloop_metrics_enhanced_summary - Get all enhanced metrics at once
  server.tool(
    'devloop_metrics_enhanced_summary',
    'Get a comprehensive summary of all enhanced metrics for a PRD set',
    z.object({
      setId: z.string().describe('PRD set ID to get metrics for'),
    }),
    async (params: { setId: string }) => {
      const prdSetMetrics = new PrdSetMetrics();
      const enhancedMetrics = prdSetMetrics.getEnhancedMetrics(params.setId);

      if (!enhancedMetrics) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: `No metrics found for PRD set ${params.setId}`,
            }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            setId: params.setId,
            ...enhancedMetrics,
          }, null, 2),
        }],
      };
    }
  );
}

