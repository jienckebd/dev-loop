/**
 * MCP Tools for observation analysis
 * Enables outer agents to analyze patterns and generate reports
 */

import { z } from 'zod';
import { ObservationAnalyzer, AnalyzerOptions } from '../../core/observation-analyzer';

const AnalyzerOptionsSchema = z.object({
  prdSetId: z.string().optional().describe('Filter by PRD set ID'),
  providerFilter: z.string().optional().describe('Filter by AI provider name'),
  typeFilter: z.enum(['failure-pattern', 'efficiency-issue', 'validation-trend', 'token-spike', 'json-parsing-failure'])
    .optional().describe('Filter by observation type'),
  severityFilter: z.enum(['low', 'medium', 'high']).optional().describe('Filter by severity'),
  timeRangeStart: z.string().optional().describe('Start time (ISO 8601)'),
  timeRangeEnd: z.string().optional().describe('End time (ISO 8601)'),
});

/**
 * Register observation analysis tools with MCP server
 */
export function registerObservationTools(server: any): void {
  // devloop_observations_analyze - Get comprehensive analysis
  server.tool(
    'devloop_observations_analyze',
    'Analyze observations to detect patterns, provider issues, and generate recommendations',
    AnalyzerOptionsSchema,
    async (params: z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new ObservationAnalyzer();
      const options: AnalyzerOptions = {
        prdSetId: params.prdSetId,
        providerFilter: params.providerFilter,
        typeFilter: params.typeFilter,
        severityFilter: params.severityFilter,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
      };

      const report = await analyzer.generateReport(options);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(report, null, 2),
        }],
      };
    }
  );

  // devloop_observations_patterns - Get pattern analysis
  server.tool(
    'devloop_observations_patterns',
    'Get pattern analysis from observations (most common failure patterns)',
    z.object({
      limit: z.number().optional().describe('Maximum patterns to return (default: 10)'),
      ...AnalyzerOptionsSchema.shape,
    }),
    async (params: { limit?: number } & z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new ObservationAnalyzer();
      const options: AnalyzerOptions = {
        prdSetId: params.prdSetId,
        providerFilter: params.providerFilter,
        typeFilter: params.typeFilter,
        severityFilter: params.severityFilter,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
      };

      let patterns = await analyzer.analyzePatterns(options);

      if (params.limit && params.limit > 0) {
        patterns = patterns.slice(0, params.limit);
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            patterns,
            count: patterns.length,
          }, null, 2),
        }],
      };
    }
  );

  // devloop_observations_by_provider - Get provider-specific analysis
  server.tool(
    'devloop_observations_by_provider',
    'Analyze observations grouped by AI provider',
    AnalyzerOptionsSchema,
    async (params: z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new ObservationAnalyzer();
      const options: AnalyzerOptions = {
        prdSetId: params.prdSetId,
        providerFilter: params.providerFilter,
        typeFilter: params.typeFilter,
        severityFilter: params.severityFilter,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
      };

      const providerAnalysis = await analyzer.analyzeByProvider(options);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            providerAnalysis,
            count: providerAnalysis.length,
          }, null, 2),
        }],
      };
    }
  );

  // devloop_observations_suggestions - Get improvement suggestions
  server.tool(
    'devloop_observations_suggestions',
    'Get aggregated improvement suggestions from observations',
    z.object({
      providerFilter: z.string().optional().describe('Filter by AI provider'),
      typeFilter: z.enum(['failure-pattern', 'efficiency-issue', 'validation-trend', 'token-spike', 'json-parsing-failure'])
        .optional().describe('Filter by observation type'),
    }),
    async (params: { providerFilter?: string; typeFilter?: string }) => {
      const analyzer = new ObservationAnalyzer();
      const options: AnalyzerOptions = {
        providerFilter: params.providerFilter,
        typeFilter: params.typeFilter as any,
      };

      const report = await analyzer.generateReport(options);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            recommendations: report.recommendations,
            topPatternSuggestions: report.patterns.slice(0, 5).flatMap(p => p.suggestedFixes),
          }, null, 2),
        }],
      };
    }
  );

  // devloop_observations_export - Export observations
  server.tool(
    'devloop_observations_export',
    'Export observations in various formats (json, csv, markdown)',
    z.object({
      format: z.enum(['json', 'csv', 'markdown']).describe('Export format'),
      ...AnalyzerOptionsSchema.shape,
    }),
    async (params: { format: 'json' | 'csv' | 'markdown' } & z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new ObservationAnalyzer();
      const options: AnalyzerOptions = {
        prdSetId: params.prdSetId,
        providerFilter: params.providerFilter,
        typeFilter: params.typeFilter,
        severityFilter: params.severityFilter,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
      };

      const exported = await analyzer.exportObservations(params.format, options);

      return {
        content: [{
          type: 'text',
          text: exported,
        }],
      };
    }
  );

  // devloop_observations_report_markdown - Generate markdown report
  server.tool(
    'devloop_observations_report_markdown',
    'Generate a comprehensive markdown report of observations',
    AnalyzerOptionsSchema,
    async (params: z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new ObservationAnalyzer();
      const options: AnalyzerOptions = {
        prdSetId: params.prdSetId,
        providerFilter: params.providerFilter,
        typeFilter: params.typeFilter,
        severityFilter: params.severityFilter,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
      };

      const markdown = await analyzer.generateMarkdownReport(options);

      return {
        content: [{
          type: 'text',
          text: markdown,
        }],
      };
    }
  );

  // devloop_observations_save_report - Save report to file
  server.tool(
    'devloop_observations_save_report',
    'Generate and save observation report to file',
    z.object({
      filename: z.string().optional().describe('Custom filename (default: auto-generated)'),
      ...AnalyzerOptionsSchema.shape,
    }),
    async (params: { filename?: string } & z.infer<typeof AnalyzerOptionsSchema>) => {
      const analyzer = new ObservationAnalyzer();
      const options: AnalyzerOptions = {
        prdSetId: params.prdSetId,
        providerFilter: params.providerFilter,
        typeFilter: params.typeFilter,
        severityFilter: params.severityFilter,
        timeRangeStart: params.timeRangeStart,
        timeRangeEnd: params.timeRangeEnd,
      };

      const report = await analyzer.generateReport(options);
      const savedPath = await analyzer.saveReport(report, params.filename);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            savedTo: savedPath,
            summary: report.summary,
          }, null, 2),
        }],
      };
    }
  );
}

