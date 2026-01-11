/**
 * PRD Report Generator
 *
 * Automatically generates comprehensive reports after PRD set completion.
 * Supports multiple formats: markdown, JSON, HTML.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  PrdSetMetricsData,
  JsonParsingMetrics,
  IpcMetrics,
  FileFilteringMetrics,
  ValidationMetrics,
  ContextMetrics,
  CodebaseMetrics,
  SessionMetrics,
  ContributionModeMetrics,
  TimingBreakdown,
  TokenBreakdown,
} from '../metrics/types';
import { PrdSetMetrics } from '../metrics/prd-set';
import { ObservationAnalyzer } from '../analysis/observation-analyzer';
import { getEventStream } from '../utils/event-stream';
import { logger } from '../utils/logger';

export type ReportFormat = 'markdown' | 'json' | 'html';

export interface ReportOptions {
  format: ReportFormat;
  includeObservations?: boolean;
  includeEvents?: boolean;
  includeTokenBreakdown?: boolean;
  includeTimingAnalysis?: boolean;
  outputPath?: string;
  output?: string; // Alias for outputPath (CLI compatibility)
  compareWith?: string; // For comparison reports
}

export interface PrdSetReport {
  generatedAt: string;
  setId: string;
  status: string;
  summary: {
    duration: string;
    prdsCompleted: number;
    prdsTotal: number;
    successRate: string;
    totalTokens: number;
    estimatedCost: string;
    testsPassed: number;
    testsFailed: number;
  };
  tokenBreakdown?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    byFeature?: TokenBreakdown;
  };
  timingAnalysis?: {
    totalDurationMs: number;
    avgPrdMs: number;
    avgTaskMs: number;
    breakdown?: TimingBreakdown;
  };
  observationSummary?: {
    totalObservations: number;
    byType: Record<string, number>;
    topPatterns: string[];
    recommendations: string[];
  };
  eventsSummary?: {
    totalEvents: number;
    byType: Record<string, number>;
    jsonParseFailures: number;
    filesFiltered: number;
  };
  prdDetails: Array<{
    prdId: string;
    status: string;
    phasesCompleted: number;
    phasesTotal: number;
  }>;
  // Enhanced metrics
  enhancedMetrics?: {
    jsonParsing?: JsonParsingMetrics;
    ipc?: IpcMetrics;
    fileFiltering?: FileFilteringMetrics;
    validation?: ValidationMetrics;
    context?: ContextMetrics;
    codebase?: CodebaseMetrics;
    sessions?: SessionMetrics;
    contributionMode?: ContributionModeMetrics;
  };
}

export class PrdReportGenerator {
  private reportsPath: string;
  private prdSetMetrics: PrdSetMetrics;
  private observationAnalyzer: ObservationAnalyzer;

  constructor(reportsPath: string = '.devloop/reports') {
    this.reportsPath = path.resolve(process.cwd(), reportsPath);
    this.prdSetMetrics = new PrdSetMetrics();
    this.observationAnalyzer = new ObservationAnalyzer();
  }

  /**
   * Generate a comprehensive report for a PRD set
   * Returns the report path (string) for CLI compatibility
   * Use generatePrdSetReportFull for full report data
   */
  async generatePrdSetReport(
    setId: string,
    options: Partial<ReportOptions> = {}
  ): Promise<{ report: PrdSetReport; path: string }> {
    const fullOptions: ReportOptions = {
      format: options.format || 'markdown',
      includeObservations: options.includeObservations ?? true,
      includeEvents: options.includeEvents ?? true,
      includeTokenBreakdown: options.includeTokenBreakdown ?? true,
      includeTimingAnalysis: options.includeTimingAnalysis ?? true,
      outputPath: options.outputPath || options.output,
    };
    const metrics = this.prdSetMetrics.getPrdSetMetrics(setId);

    if (!metrics) {
      throw new Error(`PRD set metrics not found: ${setId}`);
    }

    // Build report data
    const report = await this.buildReportData(metrics, fullOptions);

    // Generate output based on format
    let content: string;
    let extension: string;

    switch (fullOptions.format) {
      case 'json':
        content = JSON.stringify(report, null, 2);
        extension = 'json';
        break;
      case 'html':
        content = this.generateHtmlReport(report);
        extension = 'html';
        break;
      case 'markdown':
      default:
        content = this.generateMarkdownReport(report);
        extension = 'md';
    }

    // Save report
    const filename = `prd-set-${setId}-${Date.now()}.${extension}`;
    const reportPath = fullOptions.outputPath || path.join(this.reportsPath, filename);

    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeFile(reportPath, content, 'utf-8');

    logger.info(`[PrdReportGenerator] Report saved: ${reportPath}`);

    // Emit report generated event
    try {
      const { emitEvent } = require('./event-stream');
      emitEvent('report:generated', {
        setId,
        format: fullOptions.format,
        path: reportPath,
        summaryStats: report.summary,
      }, { severity: 'info' });
    } catch {
      // Event stream not available
    }

    return { report, path: reportPath };
  }

  /**
   * Build comprehensive report data from metrics and other sources
   */
  private async buildReportData(
    metrics: PrdSetMetricsData,
    options: ReportOptions
  ): Promise<PrdSetReport> {
    const report: PrdSetReport = {
      generatedAt: new Date().toISOString(),
      setId: metrics.setId,
      status: metrics.status,
      summary: {
        duration: this.formatDuration(metrics.duration || 0),
        prdsCompleted: metrics.prds.completed,
        prdsTotal: metrics.prds.total,
        successRate: `${(metrics.prds.successRate * 100).toFixed(1)}%`,
        totalTokens: (metrics.tokens.totalInput || 0) + (metrics.tokens.totalOutput || 0),
        estimatedCost: `$${(metrics.tokens.totalCost || 0).toFixed(4)}`,
        testsPassed: metrics.tests.passing,
        testsFailed: metrics.tests.failing,
      },
      prdDetails: [],
    };

    // Add token breakdown if requested
    if (options.includeTokenBreakdown) {
      report.tokenBreakdown = {
        inputTokens: metrics.tokens.totalInput || 0,
        outputTokens: metrics.tokens.totalOutput || 0,
        estimatedCost: metrics.tokens.totalCost || 0,
        byFeature: metrics.tokens.byFeature,
      };
    }

    // Add timing analysis if requested
    if (options.includeTimingAnalysis) {
      report.timingAnalysis = {
        totalDurationMs: metrics.duration || 0,
        avgPrdMs: metrics.timing.avgPrdMs || 0,
        avgTaskMs: metrics.timing.avgTaskMs || 0,
        breakdown: metrics.timing.breakdown,
      };
    }

    // Add enhanced metrics
    if (metrics.jsonParsing || metrics.ipc || metrics.fileFiltering ||
        metrics.validation || metrics.context || metrics.codebase ||
        metrics.sessions || metrics.contributionMode) {
      report.enhancedMetrics = {
        jsonParsing: metrics.jsonParsing,
        ipc: metrics.ipc,
        fileFiltering: metrics.fileFiltering,
        validation: metrics.validation,
        context: metrics.context,
        codebase: metrics.codebase,
        sessions: metrics.sessions,
        contributionMode: metrics.contributionMode,
      };
    }

    // Add observation summary if requested
    if (options.includeObservations) {
      try {
        const analysisReport = await this.observationAnalyzer.generateReport({
          prdSetId: metrics.setId,
        });

        report.observationSummary = {
          totalObservations: analysisReport.summary.totalObservations,
          byType: analysisReport.summary.byType,
          topPatterns: analysisReport.patterns.slice(0, 5).map(p => p.pattern),
          recommendations: analysisReport.recommendations,
        };
      } catch (error) {
        logger.warn(`[PrdReportGenerator] Failed to include observations: ${error}`);
      }
    }

    // Add events summary if requested
    if (options.includeEvents) {
      try {
        const eventStream = getEventStream();
        const analytics = eventStream.getAnalytics();

        report.eventsSummary = {
          totalEvents: analytics.totalEvents,
          byType: analytics.byType,
          jsonParseFailures: analytics.jsonParseFailures,
          filesFiltered: analytics.fileFilteredCount,
        };
      } catch (error) {
        logger.warn(`[PrdReportGenerator] Failed to include events: ${error}`);
      }
    }

    return report;
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(report: PrdSetReport): string {
    let md = `# PRD Set Execution Report\n\n`;
    md += `**Set ID**: ${report.setId}\n`;
    md += `**Generated**: ${report.generatedAt}\n`;
    md += `**Status**: ${report.status}\n\n`;

    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Duration | ${report.summary.duration} |\n`;
    md += `| PRDs Completed | ${report.summary.prdsCompleted}/${report.summary.prdsTotal} |\n`;
    md += `| Success Rate | ${report.summary.successRate} |\n`;
    md += `| Total Tokens | ${report.summary.totalTokens.toLocaleString()} |\n`;
    md += `| Estimated Cost | ${report.summary.estimatedCost} |\n`;
    md += `| Tests Passed | ${report.summary.testsPassed} |\n`;
    md += `| Tests Failed | ${report.summary.testsFailed} |\n\n`;

    if (report.tokenBreakdown) {
      md += `## Token Breakdown\n\n`;
      md += `- **Input Tokens**: ${report.tokenBreakdown.inputTokens.toLocaleString()}\n`;
      md += `- **Output Tokens**: ${report.tokenBreakdown.outputTokens.toLocaleString()}\n`;
      md += `- **Estimated Cost**: $${report.tokenBreakdown.estimatedCost.toFixed(4)}\n\n`;
    }

    if (report.timingAnalysis) {
      md += `## Timing Analysis\n\n`;
      md += `- **Total Duration**: ${this.formatDuration(report.timingAnalysis.totalDurationMs)}\n`;
      md += `- **Average PRD Time**: ${this.formatDuration(report.timingAnalysis.avgPrdMs)}\n`;
      md += `- **Average Task Time**: ${this.formatDuration(report.timingAnalysis.avgTaskMs)}\n\n`;
    }

    if (report.observationSummary) {
      md += `## Observations\n\n`;
      md += `**Total Observations**: ${report.observationSummary.totalObservations}\n\n`;

      if (Object.keys(report.observationSummary.byType).length > 0) {
        md += `### By Type\n\n`;
        for (const [type, count] of Object.entries(report.observationSummary.byType)) {
          md += `- ${type}: ${count}\n`;
        }
        md += `\n`;
      }

      if (report.observationSummary.topPatterns.length > 0) {
        md += `### Top Patterns\n\n`;
        for (const pattern of report.observationSummary.topPatterns) {
          md += `- ${pattern}\n`;
        }
        md += `\n`;
      }

      if (report.observationSummary.recommendations.length > 0) {
        md += `### Recommendations\n\n`;
        for (const rec of report.observationSummary.recommendations) {
          md += `- ${rec}\n`;
        }
        md += `\n`;
      }
    }

    if (report.eventsSummary) {
      md += `## Events Summary\n\n`;
      md += `- **Total Events**: ${report.eventsSummary.totalEvents}\n`;
      md += `- **JSON Parse Failures**: ${report.eventsSummary.jsonParseFailures}\n`;
      md += `- **Files Filtered**: ${report.eventsSummary.filesFiltered}\n\n`;
    }

    // Enhanced metrics sections
    if (report.enhancedMetrics) {
      md += `## Enhanced Metrics\n\n`;

      if (report.enhancedMetrics.jsonParsing) {
        const jp = report.enhancedMetrics.jsonParsing;
        md += `### JSON Parsing\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Total Attempts | ${jp.totalAttempts} |\n`;
        md += `| Direct Success | ${jp.successByStrategy.direct} |\n`;
        md += `| Retry Success | ${jp.successByStrategy.retry} |\n`;
        md += `| AI Fallback Success | ${jp.successByStrategy.aiFallback} |\n`;
        md += `| Sanitized Success | ${jp.successByStrategy.sanitized} |\n`;
        md += `| Avg Parsing Time | ${jp.avgParsingTimeMs.toFixed(2)}ms |\n\n`;

        if (jp.aiFallbackUsage.triggered > 0) {
          md += `#### AI Fallback Usage\n\n`;
          md += `- **Triggered**: ${jp.aiFallbackUsage.triggered}\n`;
          md += `- **Succeeded**: ${jp.aiFallbackUsage.succeeded}\n`;
          md += `- **Failed**: ${jp.aiFallbackUsage.failed}\n`;
          md += `- **Avg Time**: ${jp.aiFallbackUsage.avgTimeMs.toFixed(2)}ms\n`;
          md += `- **Tokens Used**: ${jp.aiFallbackUsage.tokensUsed.input + jp.aiFallbackUsage.tokensUsed.output}\n\n`;
        }
      }

      if (report.enhancedMetrics.ipc) {
        const ipc = report.enhancedMetrics.ipc;
        md += `### IPC Connections\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Connections Attempted | ${ipc.connectionsAttempted} |\n`;
        md += `| Connections Succeeded | ${ipc.connectionsSucceeded} |\n`;
        md += `| Connections Failed | ${ipc.connectionsFailed} |\n`;
        md += `| Health Checks | ${ipc.healthChecksPerformed} |\n`;
        md += `| Health Check Failures | ${ipc.healthCheckFailures} |\n`;
        md += `| Avg Connection Time | ${ipc.avgConnectionTimeMs.toFixed(2)}ms |\n`;
        md += `| Retries | ${ipc.retries} |\n\n`;
      }

      if (report.enhancedMetrics.fileFiltering) {
        const ff = report.enhancedMetrics.fileFiltering;
        md += `### File Filtering\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Files Filtered | ${ff.filesFiltered} |\n`;
        md += `| Files Allowed | ${ff.filesAllowed} |\n`;
        md += `| Boundary Violations | ${ff.boundaryViolations} |\n`;
        md += `| Predictive Filters | ${ff.predictiveFilters} |\n`;
        md += `| Suggestions Generated | ${ff.filterSuggestionsGenerated} |\n`;
        md += `| Avg Filtering Time | ${ff.avgFilteringTimeMs.toFixed(2)}ms |\n\n`;
      }

      if (report.enhancedMetrics.validation) {
        const v = report.enhancedMetrics.validation;
        md += `### Validation Gate\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Pre-Validations | ${v.preValidations} |\n`;
        md += `| Pre-Validation Failures | ${v.preValidationFailures} |\n`;
        md += `| Post-Validations | ${v.postValidations} |\n`;
        md += `| Post-Validation Failures | ${v.postValidationFailures} |\n`;
        md += `| Recovery Suggestions | ${v.recoverySuggestionsGenerated} |\n`;
        md += `| Avg Validation Time | ${v.avgValidationTimeMs.toFixed(2)}ms |\n\n`;
      }

      if (report.enhancedMetrics.context) {
        const ctx = report.enhancedMetrics.context;
        md += `### Context Management\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Total Builds | ${ctx.totalBuilds} |\n`;
        md += `| Avg Build Time | ${ctx.avgBuildTimeMs.toFixed(2)}ms |\n`;
        md += `| Avg Context Size | ${(ctx.avgContextSizeChars / 1024).toFixed(2)}KB |\n`;
        md += `| Avg Files Included | ${ctx.avgFilesIncluded.toFixed(1)} |\n`;
        md += `| Avg Files Truncated | ${ctx.avgFilesTruncated.toFixed(1)} |\n`;
        md += `| Window Utilization | ${(ctx.contextWindowUtilization * 100).toFixed(1)}% |\n`;
        md += `| Search Efficiency | ${(ctx.searchOperations.efficiency * 100).toFixed(1)}% |\n\n`;
      }

      if (report.enhancedMetrics.codebase) {
        const cb = report.enhancedMetrics.codebase;
        md += `### Codebase Operations\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Search Operations | ${cb.searchOperations.total} |\n`;
        md += `| Search Success Rate | ${(cb.searchOperations.successRate * 100).toFixed(1)}% |\n`;
        md += `| Files Found | ${cb.searchOperations.filesFound} |\n`;
        md += `| File Reads | ${cb.fileOperations.reads} |\n`;
        md += `| File Writes | ${cb.fileOperations.writes} |\n`;
        md += `| File Errors | ${cb.fileOperations.errors} |\n`;
        md += `| Error Rate | ${(cb.fileOperations.errorRate * 100).toFixed(1)}% |\n`;
        md += `| Cache Hit Rate | ${(cb.indexing.cacheHitRate * 100).toFixed(1)}% |\n\n`;
      }

      if (report.enhancedMetrics.sessions) {
        const s = report.enhancedMetrics.sessions;
        md += `### Session Management\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Total Sessions | ${s.totalSessions} |\n`;
        md += `| Session Rotations | ${s.sessionRotations} |\n`;
        md += `| Health Checks | ${s.sessionHealthChecks} |\n`;
        md += `| Unhealthy Sessions | ${s.unhealthySessions} |\n`;
        md += `| Persistence Success Rate | ${(s.sessionPersistence.successRate * 100).toFixed(1)}% |\n`;
        md += `| History Prunings | ${s.historyManagement.prunings} |\n`;
        md += `| Expired Sessions | ${s.sessionLifespan.expiredSessions} |\n\n`;
      }

      if (report.enhancedMetrics.contributionMode) {
        const cm = report.enhancedMetrics.contributionMode;
        md += `### Contribution Mode\n\n`;
        md += `| Metric | Value |\n|--------|-------|\n`;
        md += `| Outer Agent Observations | ${cm.outerAgentObservations} |\n`;
        md += `| Dev-Loop Fixes Applied | ${cm.devLoopFixesApplied} |\n`;
        md += `| Root Cause Fixes | ${cm.rootCauseFixes} |\n`;
        md += `| Workaround Fixes | ${cm.workaroundFixes} |\n`;
        md += `| Improvements Identified | ${cm.improvementsIdentified} |\n`;
        md += `| Session Duration | ${this.formatDuration(cm.sessionDuration)} |\n\n`;
      }
    }

    // Timing breakdown
    if (report.timingAnalysis?.breakdown) {
      const tb = report.timingAnalysis.breakdown;
      md += `## Timing Breakdown\n\n`;
      md += `| Operation | Total (ms) | Avg (ms) | Count |\n|-----------|------------|----------|-------|\n`;
      md += `| JSON Parsing | ${tb.jsonParsing.totalMs.toFixed(2)} | ${tb.jsonParsing.avgMs.toFixed(2)} | ${tb.jsonParsing.count} |\n`;
      md += `| File Filtering | ${tb.fileFiltering.totalMs.toFixed(2)} | ${tb.fileFiltering.avgMs.toFixed(2)} | ${tb.fileFiltering.count} |\n`;
      md += `| Validation | ${tb.validation.totalMs.toFixed(2)} | ${tb.validation.avgMs.toFixed(2)} | ${tb.validation.count} |\n`;
      md += `| IPC | ${tb.ipc.totalMs.toFixed(2)} | ${tb.ipc.avgMs.toFixed(2)} | ${tb.ipc.count} |\n`;
      md += `| AI Fallback | ${tb.aiFallback.totalMs.toFixed(2)} | ${tb.aiFallback.avgMs.toFixed(2)} | ${tb.aiFallback.count} |\n`;
      md += `| Context Building | ${tb.contextBuilding.totalMs.toFixed(2)} | ${tb.contextBuilding.avgMs.toFixed(2)} | ${tb.contextBuilding.count} |\n`;
      md += `| Codebase Search | ${tb.codebaseSearch.totalMs.toFixed(2)} | ${tb.codebaseSearch.avgMs.toFixed(2)} | ${tb.codebaseSearch.count} |\n`;
      md += `| File Operations | ${tb.fileOperations.totalMs.toFixed(2)} | ${tb.fileOperations.avgMs.toFixed(2)} | ${tb.fileOperations.count} |\n`;
      md += `| Session Management | ${tb.sessionManagement.totalMs.toFixed(2)} | ${tb.sessionManagement.avgMs.toFixed(2)} | ${tb.sessionManagement.count} |\n\n`;
    }

    // Token breakdown by feature
    if (report.tokenBreakdown?.byFeature) {
      const tf = report.tokenBreakdown.byFeature;
      md += `## Token Breakdown by Feature\n\n`;
      md += `| Feature | Input | Output | Total |\n|---------|-------|--------|-------|\n`;
      md += `| Code Generation | ${tf.codeGeneration.input} | ${tf.codeGeneration.output} | ${tf.codeGeneration.input + tf.codeGeneration.output} |\n`;
      md += `| AI Fallback | ${tf.aiFallback.input} | ${tf.aiFallback.output} | ${tf.aiFallback.input + tf.aiFallback.output} |\n`;
      md += `| Retry | ${tf.retry.input} | ${tf.retry.output} | ${tf.retry.input + tf.retry.output} |\n`;
      md += `| Error Analysis | ${tf.errorAnalysis.input} | ${tf.errorAnalysis.output} | ${tf.errorAnalysis.input + tf.errorAnalysis.output} |\n\n`;
    }

    return md;
  }

  /**
   * Generate HTML report
   */
  private generateHtmlReport(report: PrdSetReport): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PRD Set Report - ${report.setId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { color: #333; }
    h2 { color: #555; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
    .status-completed { color: #28a745; }
    .status-failed { color: #dc3545; }
    .status-blocked { color: #ffc107; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
    .metric { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 6px; }
    .metric-value { font-size: 2em; font-weight: bold; color: #007bff; }
    .metric-label { color: #666; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; }
    .timestamp { color: #999; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>PRD Set Execution Report</h1>
  <p class="timestamp">Generated: ${report.generatedAt}</p>

  <div class="card">
    <h2>Summary</h2>
    <p><strong>Set ID:</strong> ${report.setId}</p>
    <p><strong>Status:</strong> <span class="status-${report.status}">${report.status}</span></p>

    <div class="metric-grid">
      <div class="metric">
        <div class="metric-value">${report.summary.prdsCompleted}/${report.summary.prdsTotal}</div>
        <div class="metric-label">PRDs Completed</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.successRate}</div>
        <div class="metric-label">Success Rate</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.duration}</div>
        <div class="metric-label">Duration</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.totalTokens.toLocaleString()}</div>
        <div class="metric-label">Total Tokens</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.estimatedCost}</div>
        <div class="metric-label">Estimated Cost</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.testsPassed}/${report.summary.testsPassed + report.summary.testsFailed}</div>
        <div class="metric-label">Tests Passed</div>
      </div>
    </div>
  </div>

  ${report.observationSummary ? `
  <div class="card">
    <h2>Observations</h2>
    <p><strong>Total Observations:</strong> ${report.observationSummary.totalObservations}</p>
    ${report.observationSummary.recommendations.length > 0 ? `
    <h3>Recommendations</h3>
    <ul>
      ${report.observationSummary.recommendations.map(r => `<li>${r}</li>`).join('')}
    </ul>
    ` : ''}
  </div>
  ` : ''}

</body>
</html>`;
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(1)}h`;
  }

  /**
   * Auto-generate report after PRD set completion
   * Called by PrdSetOrchestrator after completion
   */
  static async autoGenerateReport(setId: string): Promise<string | null> {
    try {
      const generator = new PrdReportGenerator();
      const { path: reportPath } = await generator.generatePrdSetReport(setId, {
        format: 'markdown',
        includeObservations: true,
        includeEvents: true,
        includeTokenBreakdown: true,
        includeTimingAnalysis: true,
      });

      // Also generate JSON version for programmatic access
      await generator.generatePrdSetReport(setId, {
        format: 'json',
        includeObservations: true,
        includeEvents: true,
        includeTokenBreakdown: true,
      });

      return reportPath;
    } catch (error) {
      logger.warn(`[PrdReportGenerator] Auto-generation failed: ${error}`);
      return null;
    }
  }

  /**
   * Generate report for a single PRD (CLI compatibility)
   */
  async generatePrdReport(
    prdId: string,
    options: Partial<ReportOptions> = {}
  ): Promise<string> {
    // Load PRD metrics
    const { PrdMetrics } = await import('../metrics/prd');
    const prdMetrics = new PrdMetrics();
    const metrics = prdMetrics.getPrdMetrics(prdId);

    if (!metrics) {
      throw new Error(`PRD metrics not found: ${prdId}`);
    }

    const format = options.format || 'markdown';
    const extension = format === 'json' ? 'json' : format === 'html' ? 'html' : 'md';
    const filename = `prd-${prdId}-${Date.now()}.${extension}`;
    const outputPath = options.output || options.outputPath || path.join(this.reportsPath, filename);

    await fs.ensureDir(path.dirname(outputPath));

    // Generate simple PRD report
    const report = {
      generatedAt: new Date().toISOString(),
      prdId,
      status: metrics.status,
      duration: metrics.duration,
      phases: {
        completed: metrics.phases.completed,
        total: metrics.phases.total,
      },
      tokens: metrics.tokens,
      tests: metrics.tests,
    };

    let content: string;
    if (format === 'json') {
      content = JSON.stringify(report, null, 2);
    } else if (format === 'html') {
      content = `<!DOCTYPE html><html><head><title>PRD Report: ${prdId}</title></head><body><pre>${JSON.stringify(report, null, 2)}</pre></body></html>`;
    } else {
      content = `# PRD Report: ${prdId}\n\n`;
      content += `**Status**: ${report.status}\n`;
      content += `**Phases**: ${report.phases.completed}/${report.phases.total}\n`;
      content += `**Tokens**: ${report.tokens.totalInput} input, ${report.tokens.totalOutput} output\n`;
    }

    await fs.writeFile(outputPath, content, 'utf-8');
    logger.info(`[PrdReportGenerator] PRD report saved: ${outputPath}`);

    return outputPath;
  }

  /**
   * Generate report for a specific phase (CLI compatibility)
   */
  async generatePhaseReport(
    prdId: string,
    phaseId: number,
    options: Partial<ReportOptions> = {}
  ): Promise<string> {
    // Load phase metrics
    const { PhaseMetrics } = await import('../metrics/phase');
    const phaseMetrics = new PhaseMetrics();
    const metrics = phaseMetrics.getPhaseMetrics(phaseId, prdId);

    if (!metrics) {
      throw new Error(`Phase metrics not found: ${prdId}:${phaseId}`);
    }

    const format = options.format || 'markdown';
    const extension = format === 'json' ? 'json' : format === 'html' ? 'html' : 'md';
    const filename = `phase-${prdId}-${phaseId}-${Date.now()}.${extension}`;
    const outputPath = options.output || options.outputPath || path.join(this.reportsPath, filename);

    await fs.ensureDir(path.dirname(outputPath));

    // Generate simple phase report
    const report = {
      generatedAt: new Date().toISOString(),
      prdId,
      phaseId,
      status: metrics.status,
      duration: metrics.duration,
      tasks: metrics.tasks,
      tokens: metrics.tokens,
    };

    let content: string;
    if (format === 'json') {
      content = JSON.stringify(report, null, 2);
    } else if (format === 'html') {
      content = `<!DOCTYPE html><html><head><title>Phase Report: ${prdId}:${phaseId}</title></head><body><pre>${JSON.stringify(report, null, 2)}</pre></body></html>`;
    } else {
      content = `# Phase Report: ${prdId}:${phaseId}\n\n`;
      content += `**Status**: ${report.status}\n`;
      content += `**Tasks**: ${report.tasks.completed}/${report.tasks.total}\n`;
    }

    await fs.writeFile(outputPath, content, 'utf-8');
    logger.info(`[PrdReportGenerator] Phase report saved: ${outputPath}`);

    return outputPath;
  }
}
