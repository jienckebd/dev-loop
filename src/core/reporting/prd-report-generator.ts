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
import { BuildMetrics, BuildMetricsData } from '../metrics/build';
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

/**
 * Build report structure (for build-prd-set command)
 */
export interface BuildReport {
  generatedAt: string;
  buildId: string;
  mode: string;
  prdSetId: string;
  sourceFile?: string;
  status: string;

  summary: {
    duration: string;
    executabilityScore: number;
    aiCallsTotal: number;
    aiCallsSuccessRate: string;
    tokensUsed: number;
    estimatedCost: string;
    validationIterations: number;
    autoFixesApplied: number;
    filesGenerated: number;
    phasesCount: number;
    tasksCount: number;
  };

  timingAnalysis?: {
    totalDurationMs: number;
    breakdown: Record<string, number>;
    bottleneck: string;
  };

  aiUsageAnalysis?: {
    callsByComponent: Record<string, number>;
    tokensByComponent: Record<string, { input: number; output: number }>;
    avgCallDuration: number;
    successRate: number;
    retryRate: number;
  };

  validationAnalysis?: {
    iterations: number;
    initialScore: number;
    finalScore: number;
    autoFixes: string[];
    errorsFixed: number;
    warningsFixed: number;
  };

  qualityAnalysis?: {
    executabilityScore: number;
    schemaCompleteness: number;
    testCoverage: number;
    taskSpecificity: number;
  };

  // Contribution mode integration
  recommendations: string[];
  issuesDetected: string[];
  patternsSuggested: Array<{ pattern: string; type: string; frequency: number }>;

  // Warnings captured during build
  warnings?: {
    total: number;
    byType: Record<string, number>;
    samples: string[];
  };

  // PRD set structure for execution planning
  prdSetStructure?: {
    totalPhases: number;
    totalTasks: number;
    phases: Array<{
      id: number;
      name: string;
      file: string;
      taskCount: number;
      parallel: boolean;
      dependencies: string[];
    }>;
  };

  // Enhanced metrics for batching and token efficiency
  enhancedMetrics?: {
    batching?: {
      batchesAttempted: number;
      batchesSucceeded: number;
      avgTasksPerBatch: number;
      fallbacksToIndividual: number;
    };
    tokenEfficiency?: {
      tokensPerTask: number;
      tokensPerPhase: number;
      inputOutputRatio: number;
    };
  };

  // NEW: Session management metrics
  sessionManagement?: {
    sessionId: string;
    reuseCount: number;
    newSessionCreations: number;
    workspaceIndexingEvents: number;
    avgCallsPerSession: number;
  };

  // NEW: Codebase analysis metrics
  codebaseAnalysis?: {
    framework: string;
    filesAnalyzed: number;
    patternsDetected: number;
    schemaPatterns: string[];
    testPatterns: string[];
    cacheHit: boolean;
    analysisTimeMs: number;
    contextSizeChars: number;
  };

  // NEW: Individual AI call details
  aiCallDetails?: Array<{
    id: string;
    component: string;
    purpose: string;
    promptSummary: string;
    responseSummary: string;
    durationMs: number;
    tokensIn: number;
    tokensOut: number;
    success: boolean;
    timestamp: string;
    phase?: string;
    model?: string;
    impact?: {
      schemasGenerated?: string[];
      testsPlanned?: string[];
      clarificationsResolved?: string[];
      filesImpacted?: string[];
    };
  }>;

  // NEW: Build comparison data
  buildComparison?: {
    current: {
      durationMs: number;
      aiCalls: number;
      tokensUsed: number;
      estimatedCost: number;
    };
    previousBuilds: Array<{
      buildId: string;
      timestamp: string;
      metrics: {
        durationMs: number;
        aiCalls: number;
        tokensUsed: number;
        estimatedCost: number;
        executabilityScore: number;
      };
    }>;
  };

  // NEW: AI time breakdown by phase
  aiTimeByPhase?: Record<string, number>;
}

export class PrdReportGenerator {
  private reportsPath: string;
  private prdSetMetrics: PrdSetMetrics;
  private buildMetrics: BuildMetrics;
  private observationAnalyzer: ObservationAnalyzer;

  constructor(reportsPath: string = '.devloop/reports') {
    this.reportsPath = path.resolve(process.cwd(), reportsPath);
    this.prdSetMetrics = new PrdSetMetrics();
    this.buildMetrics = new BuildMetrics();
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

  /**
   * Generate a comprehensive report for a PRD set build
   */
  async generateBuildReport(
    buildId: string,
    options: Partial<ReportOptions> = {}
  ): Promise<{ report: BuildReport; path: string }> {
    const fullOptions: ReportOptions = {
      format: options.format || 'markdown',
      includeTimingAnalysis: options.includeTimingAnalysis ?? true,
      includeTokenBreakdown: options.includeTokenBreakdown ?? true,
      outputPath: options.outputPath || options.output,
    };

    const metrics = this.buildMetrics.getBuildMetrics(buildId);

    if (!metrics) {
      throw new Error(`Build metrics not found: ${buildId}`);
    }

    // Build report data
    const report = this.buildBuildReportData(metrics, fullOptions);

    // Generate output based on format
    let content: string;
    let extension: string;

    switch (fullOptions.format) {
      case 'json':
        content = JSON.stringify(report, null, 2);
        extension = 'json';
        break;
      case 'html':
        content = this.generateHtmlBuildReport(report);
        extension = 'html';
        break;
      case 'markdown':
      default:
        content = this.generateMarkdownBuildReport(report);
        extension = 'md';
    }

    // Save report
    const filename = `build-${metrics.prdSetId}-${Date.now()}.${extension}`;
    const reportPath = fullOptions.outputPath || path.join(this.reportsPath, filename);

    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeFile(reportPath, content, 'utf-8');

    logger.info(`[PrdReportGenerator] Build report saved: ${reportPath}`);

    return { report, path: reportPath };
  }

  /**
   * Generate build report from BuildMetricsData
   */
  async generateBuildReportFromMetrics(
    metrics: BuildMetricsData,
    options: Partial<ReportOptions> = {}
  ): Promise<{ report: BuildReport; path: string }> {
    const fullOptions: ReportOptions = {
      format: options.format || 'markdown',
      includeTimingAnalysis: options.includeTimingAnalysis ?? true,
      includeTokenBreakdown: options.includeTokenBreakdown ?? true,
      outputPath: options.outputPath || options.output,
    };

    // Build report data
    const report = this.buildBuildReportData(metrics, fullOptions);

    // Extract PRD set structure if output directory is available
    if (metrics.output.directory) {
      report.prdSetStructure = await this.extractPrdSetStructure(metrics.output.directory);
    }

    // Generate output based on format
    let content: string;
    let extension: string;

    switch (fullOptions.format) {
      case 'json':
        content = JSON.stringify(report, null, 2);
        extension = 'json';
        break;
      case 'html':
        content = this.generateHtmlBuildReport(report);
        extension = 'html';
        break;
      case 'markdown':
      default:
        content = this.generateMarkdownBuildReport(report);
        extension = 'md';
    }

    // Save report
    const filename = `build-${metrics.prdSetId}-${Date.now()}.${extension}`;
    const reportPath = fullOptions.outputPath || path.join(this.reportsPath, filename);

    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeFile(reportPath, content, 'utf-8');

    logger.info(`[PrdReportGenerator] Build report saved: ${reportPath}`);

    return { report, path: reportPath };
  }

  /**
   * Build comprehensive report data from build metrics
   */
  private buildBuildReportData(
    metrics: BuildMetricsData,
    options: ReportOptions
  ): BuildReport {
    const aiSuccessRate = metrics.aiCalls.total > 0
      ? (metrics.aiCalls.successful / metrics.aiCalls.total) * 100
      : 100;

    const report: BuildReport = {
      generatedAt: new Date().toISOString(),
      buildId: metrics.buildId,
      mode: metrics.mode,
      prdSetId: metrics.prdSetId,
      sourceFile: metrics.sourceFile,
      status: metrics.status,
      summary: {
        duration: this.formatDuration(metrics.duration || 0),
        executabilityScore: metrics.quality.executabilityScore,
        aiCallsTotal: metrics.aiCalls.total,
        aiCallsSuccessRate: `${aiSuccessRate.toFixed(1)}%`,
        tokensUsed: metrics.tokens.totalInput + metrics.tokens.totalOutput,
        estimatedCost: `$${(metrics.tokens.estimatedCost || 0).toFixed(4)}`,
        validationIterations: metrics.validation.iterations,
        autoFixesApplied: metrics.validation.autoFixesApplied.length,
        filesGenerated: metrics.output.filesGenerated,
        phasesCount: metrics.output.phasesCount,
        tasksCount: metrics.output.tasksCount,
      },
      recommendations: [],
      issuesDetected: [],
      patternsSuggested: [],
    };

    // Add timing analysis if requested
    if (options.includeTimingAnalysis) {
      const timingEntries = Object.entries(metrics.timing);
      const bottleneck = timingEntries.reduce((max, entry) =>
        entry[1] > max[1] ? entry : max, ['none', 0]
      );

      report.timingAnalysis = {
        totalDurationMs: metrics.duration || 0,
        breakdown: metrics.timing,
        bottleneck: bottleneck[0],
      };
    }

    // Add AI usage analysis if requested
    if (options.includeTokenBreakdown) {
      const retryRate = metrics.aiCalls.total > 0
        ? (metrics.aiCalls.retried / metrics.aiCalls.total) * 100
        : 0;

      report.aiUsageAnalysis = {
        callsByComponent: metrics.aiCalls.byComponent,
        tokensByComponent: metrics.tokens.byComponent,
        avgCallDuration: metrics.aiCalls.avgDurationMs,
        successRate: aiSuccessRate,
        retryRate,
      };
    }

    // Add validation analysis
    report.validationAnalysis = {
      iterations: metrics.validation.iterations,
      initialScore: metrics.validation.initialScore,
      finalScore: metrics.validation.finalScore,
      autoFixes: metrics.validation.autoFixesApplied,
      errorsFixed: metrics.validation.errorsFixed,
      warningsFixed: metrics.validation.warningsFixed,
    };

    // Add quality analysis
    report.qualityAnalysis = {
      executabilityScore: metrics.quality.executabilityScore,
      schemaCompleteness: metrics.quality.schemaCompleteness,
      testCoverage: metrics.quality.testCoverage,
      taskSpecificity: metrics.quality.taskSpecificity,
    };

    // Get recommendations from BuildMetrics
    report.recommendations = this.buildMetrics.getRecommendations();

    // Analyze patterns for contribution mode
    const patterns = this.buildMetrics.getPatterns();
    report.patternsSuggested = patterns
      .filter(p => p.frequency >= 2)
      .slice(0, 10)
      .map(p => ({
        pattern: p.pattern,
        type: p.type,
        frequency: p.frequency,
      }));

    // Detect issues
    if (metrics.quality.executabilityScore < 100) {
      report.issuesDetected.push(`Executability score below 100%: ${metrics.quality.executabilityScore}%`);
    }
    if (metrics.aiCalls.failed > 0) {
      report.issuesDetected.push(`${metrics.aiCalls.failed} AI call(s) failed`);
    }
    if (metrics.validation.iterations > 3) {
      report.issuesDetected.push(`High validation iterations: ${metrics.validation.iterations}`);
    }

    // Include warnings if available
    if (metrics.warnings && metrics.warnings.total > 0) {
      report.warnings = {
        total: metrics.warnings.total,
        byType: metrics.warnings.byType,
        samples: metrics.warnings.samples,
      };
    }

    // Include enhanced metrics
    report.enhancedMetrics = {};

    // Batching metrics
    if (metrics.batching && metrics.batching.batchesAttempted > 0) {
      report.enhancedMetrics.batching = {
        batchesAttempted: metrics.batching.batchesAttempted,
        batchesSucceeded: metrics.batching.batchesSucceeded,
        avgTasksPerBatch: metrics.batching.totalTasks / metrics.batching.batchesAttempted,
        fallbacksToIndividual: metrics.batching.fallbacks,
      };
    }

    // Token efficiency metrics
    const totalTokens = metrics.tokens.totalInput + metrics.tokens.totalOutput;
    if (totalTokens > 0 && metrics.output.tasksCount > 0) {
      report.enhancedMetrics.tokenEfficiency = {
        tokensPerTask: totalTokens / metrics.output.tasksCount,
        tokensPerPhase: metrics.output.phasesCount > 0 ? totalTokens / metrics.output.phasesCount : 0,
        inputOutputRatio: metrics.tokens.totalOutput > 0 ? metrics.tokens.totalInput / metrics.tokens.totalOutput : 0,
      };
    }

    // Only include enhancedMetrics if it has data
    if (!report.enhancedMetrics.batching && !report.enhancedMetrics.tokenEfficiency) {
      delete report.enhancedMetrics;
    }

    // NEW: Include AI call details if available
    if (metrics.aiCallDetails && metrics.aiCallDetails.length > 0) {
      report.aiCallDetails = metrics.aiCallDetails;
    }

    // NEW: Include session management metrics if available
    if (metrics.sessionManagement) {
      report.sessionManagement = metrics.sessionManagement;
    }

    // NEW: Include codebase analysis metrics if available
    if (metrics.codebaseAnalysis) {
      report.codebaseAnalysis = metrics.codebaseAnalysis;
    }

    // NEW: Include AI time by phase
    if (metrics.aiTimeByPhase) {
      report.aiTimeByPhase = metrics.aiTimeByPhase;
    }

    // NEW: Include build comparison data if source file is available
    if (metrics.sourceFile) {
      const previousBuilds = this.buildMetrics.getPreviousBuilds(metrics.sourceFile, 5);
      if (previousBuilds.length > 0) {
        report.buildComparison = {
          current: {
            durationMs: metrics.duration || 0,
            aiCalls: metrics.aiCalls.total,
            tokensUsed: metrics.tokens.totalInput + metrics.tokens.totalOutput,
            estimatedCost: metrics.tokens.estimatedCost || 0,
          },
          previousBuilds: previousBuilds.map(pb => ({
            buildId: pb.buildId,
            timestamp: pb.timestamp,
            metrics: pb.metrics,
          })),
        };
      }
    }

    return report;
  }

  /**
   * Generate markdown build report
   */
  private generateMarkdownBuildReport(report: BuildReport): string {
    let md = `# PRD Set Build Report\n\n`;
    md += `**Build ID**: ${report.buildId}\n`;
    md += `**PRD Set**: ${report.prdSetId}\n`;
    md += `**Mode**: ${report.mode}\n`;
    md += `**Generated**: ${report.generatedAt}\n`;
    md += `**Status**: ${report.status}\n`;
    if (report.sourceFile) {
      md += `**Source**: ${report.sourceFile}\n`;
    }
    md += `\n`;

    md += `## Summary\n\n`;
    md += `| Metric | Value |\n`;
    md += `|--------|-------|\n`;
    md += `| Duration | ${report.summary.duration} |\n`;
    md += `| Executability Score | ${report.summary.executabilityScore}% |\n`;
    md += `| AI Calls | ${report.summary.aiCallsTotal} (${report.summary.aiCallsSuccessRate} success) |\n`;
    md += `| Tokens Used | ${report.summary.tokensUsed.toLocaleString()} |\n`;
    md += `| Estimated Cost | ${report.summary.estimatedCost} |\n`;
    md += `| Validation Iterations | ${report.summary.validationIterations} |\n`;
    md += `| Auto-Fixes Applied | ${report.summary.autoFixesApplied} |\n`;
    md += `| Files Generated | ${report.summary.filesGenerated} |\n`;
    md += `| Phases | ${report.summary.phasesCount} |\n`;
    md += `| Tasks | ${report.summary.tasksCount} |\n\n`;

    if (report.timingAnalysis) {
      md += `## Timing Analysis\n\n`;
      md += `- **Total Duration**: ${this.formatDuration(report.timingAnalysis.totalDurationMs)}\n`;
      md += `- **Bottleneck**: ${report.timingAnalysis.bottleneck}\n\n`;

      md += `| Phase | Duration |\n`;
      md += `|-------|----------|\n`;
      for (const [phase, ms] of Object.entries(report.timingAnalysis.breakdown)) {
        md += `| ${phase} | ${this.formatDuration(ms)} |\n`;
      }
      md += `\n`;

      // Add build flow diagram
      md += `### Build Flow Diagram\n\n`;
      md += this.generateBuildFlowDiagram(report);
      md += `\n`;
    }

    if (report.aiUsageAnalysis) {
      md += `## AI Usage Analysis\n\n`;
      md += `- **Average Call Duration**: ${this.formatDuration(report.aiUsageAnalysis.avgCallDuration)}\n`;
      md += `- **Success Rate**: ${report.aiUsageAnalysis.successRate.toFixed(1)}%\n`;
      md += `- **Retry Rate**: ${report.aiUsageAnalysis.retryRate.toFixed(1)}%\n\n`;

      if (Object.keys(report.aiUsageAnalysis.callsByComponent).length > 0) {
        md += `### Calls by Component\n\n`;
        md += `| Component | Calls |\n`;
        md += `|-----------|-------|\n`;
        for (const [component, calls] of Object.entries(report.aiUsageAnalysis.callsByComponent)) {
          md += `| ${component} | ${calls} |\n`;
        }
        md += `\n`;
      }

      if (Object.keys(report.aiUsageAnalysis.tokensByComponent).length > 0) {
        md += `### Tokens by Component\n\n`;
        md += `| Component | Input | Output | Total |\n`;
        md += `|-----------|-------|--------|-------|\n`;
        for (const [component, tokens] of Object.entries(report.aiUsageAnalysis.tokensByComponent)) {
          md += `| ${component} | ${tokens.input} | ${tokens.output} | ${tokens.input + tokens.output} |\n`;
        }
        md += `\n`;
      }
    }

    if (report.validationAnalysis) {
      md += `## Validation Analysis\n\n`;
      md += `- **Iterations**: ${report.validationAnalysis.iterations}\n`;
      md += `- **Initial Score**: ${report.validationAnalysis.initialScore}%\n`;
      md += `- **Final Score**: ${report.validationAnalysis.finalScore}%\n`;
      md += `- **Errors Fixed**: ${report.validationAnalysis.errorsFixed}\n`;
      md += `- **Warnings Fixed**: ${report.validationAnalysis.warningsFixed}\n\n`;

      if (report.validationAnalysis.autoFixes.length > 0) {
        md += `### Auto-Fixes Applied\n\n`;
        for (const fix of report.validationAnalysis.autoFixes) {
          md += `- ${fix}\n`;
        }
        md += `\n`;
      }
    }

    if (report.qualityAnalysis) {
      md += `## Quality Analysis\n\n`;
      md += `| Metric | Score |\n`;
      md += `|--------|-------|\n`;
      md += `| Executability | ${report.qualityAnalysis.executabilityScore}% |\n`;
      md += `| Schema Completeness | ${(report.qualityAnalysis.schemaCompleteness * 100).toFixed(1)}% |\n`;
      md += `| Test Coverage | ${(report.qualityAnalysis.testCoverage * 100).toFixed(1)}% |\n`;
      md += `| Task Specificity | ${(report.qualityAnalysis.taskSpecificity * 100).toFixed(1)}% |\n\n`;
    }

    if (report.warnings && report.warnings.total > 0) {
      md += `## Build Warnings\n\n`;
      md += `- **Total**: ${report.warnings.total}\n\n`;
      md += `| Type | Count |\n`;
      md += `|------|-------|\n`;
      for (const [type, count] of Object.entries(report.warnings.byType)) {
        md += `| ${type} | ${count} |\n`;
      }
      md += `\n`;
      if (report.warnings.samples.length > 0) {
        md += `### Sample Warnings\n\n`;
        for (const sample of report.warnings.samples) {
          md += `- ${sample}\n`;
        }
        md += `\n`;
      }
    }

    if (report.prdSetStructure) {
      md += `## PRD Set Structure\n\n`;
      md += `- **Total Phases**: ${report.prdSetStructure.totalPhases}\n`;
      md += `- **Total Tasks**: ${report.prdSetStructure.totalTasks}\n\n`;
      md += `| Phase | Name | File | Tasks | Parallel | Dependencies |\n`;
      md += `|-------|------|------|-------|----------|-------------|\n`;
      for (const phase of report.prdSetStructure.phases) {
        const deps = phase.dependencies.length > 0 ? phase.dependencies.join(', ') : '-';
        md += `| ${phase.id} | ${phase.name} | ${phase.file} | ${phase.taskCount} | ${phase.parallel ? 'Yes' : 'No'} | ${deps} |\n`;
      }
      md += `\n`;

      // Add PRD execution plan diagram
      md += `### PRD Execution Plan\n\n`;
      md += `This diagram shows how the PRD phases will be executed. Phases marked as parallel can run concurrently if dependencies allow.\n\n`;
      md += this.generatePrdExecutionDiagram(report.prdSetStructure);
      md += `\n`;
    }

    if (report.issuesDetected.length > 0) {
      md += `## Issues Detected\n\n`;
      for (const issue of report.issuesDetected) {
        md += `- ${issue}\n`;
      }
      md += `\n`;
    }

    if (report.recommendations.length > 0) {
      md += `## Recommendations\n\n`;
      for (const rec of report.recommendations) {
        md += `- ${rec}\n`;
      }
      md += `\n`;
    }

    if (report.patternsSuggested.length > 0) {
      md += `## Patterns for Contribution Mode\n\n`;
      md += `| Pattern | Type | Frequency |\n`;
      md += `|---------|------|----------|\n`;
      for (const pattern of report.patternsSuggested) {
        md += `| ${pattern.pattern} | ${pattern.type} | ${pattern.frequency} |\n`;
      }
      md += `\n`;
    }

    if (report.enhancedMetrics) {
      md += `## Enhanced Metrics\n\n`;

      if (report.enhancedMetrics.batching) {
        const b = report.enhancedMetrics.batching;
        md += `### Batching Efficiency\n\n`;
        md += `| Metric | Value |\n`;
        md += `|--------|-------|\n`;
        md += `| Batches Attempted | ${b.batchesAttempted} |\n`;
        md += `| Batches Succeeded | ${b.batchesSucceeded} |\n`;
        md += `| Avg Tasks/Batch | ${b.avgTasksPerBatch.toFixed(1)} |\n`;
        md += `| Fallbacks to Individual | ${b.fallbacksToIndividual} |\n`;
        md += `\n`;
      }

      if (report.enhancedMetrics.tokenEfficiency) {
        const te = report.enhancedMetrics.tokenEfficiency;
        md += `### Token Efficiency\n\n`;
        md += `| Metric | Value |\n`;
        md += `|--------|-------|\n`;
        md += `| Tokens per Task | ${te.tokensPerTask.toFixed(0)} |\n`;
        md += `| Tokens per Phase | ${te.tokensPerPhase.toFixed(0)} |\n`;
        md += `| Input/Output Ratio | ${te.inputOutputRatio.toFixed(2)} |\n`;
        md += `\n`;
      }
    }

    // NEW: Session Management section
    if (report.sessionManagement) {
      const sm = report.sessionManagement;
      md += `## Session Management\n\n`;
      md += `| Metric | Value |\n`;
      md += `|--------|-------|\n`;
      md += `| Session ID | ${sm.sessionId} |\n`;
      md += `| Session Reuse Count | ${sm.reuseCount} |\n`;
      md += `| New Session Creations | ${sm.newSessionCreations} |\n`;
      md += `| Avg Calls per Session | ${sm.avgCallsPerSession.toFixed(1)} |\n`;
      md += `\n`;
    }

    // NEW: Codebase Analysis section
    if (report.codebaseAnalysis) {
      const ca = report.codebaseAnalysis;
      md += `## Codebase Analysis\n\n`;
      md += `| Metric | Value |\n`;
      md += `|--------|-------|\n`;
      md += `| Framework | ${ca.framework} |\n`;
      md += `| Files Analyzed | ${ca.filesAnalyzed}${ca.cacheHit ? ' (cache hit)' : ''} |\n`;
      md += `| Patterns Detected | ${ca.patternsDetected} |\n`;
      md += `| Context Size | ${ca.contextSizeChars.toLocaleString()} chars |\n`;
      md += `| Analysis Time | ${ca.analysisTimeMs}ms |\n`;
      md += `\n`;

      if (ca.schemaPatterns && ca.schemaPatterns.length > 0) {
        md += `### Schema Patterns\n\n`;
        for (const pattern of ca.schemaPatterns) {
          md += `- ${pattern}\n`;
        }
        md += `\n`;
      }

      if (ca.testPatterns && ca.testPatterns.length > 0) {
        md += `### Test Patterns\n\n`;
        for (const pattern of ca.testPatterns) {
          md += `- ${pattern}\n`;
        }
        md += `\n`;
      }
    }

    // NEW: AI Call Details section
    if (report.aiCallDetails && report.aiCallDetails.length > 0) {
      const calls = report.aiCallDetails;
      md += `## AI Call Details\n\n`;
      md += `| # | Component | Purpose | Duration | Tokens | Impact |\n`;
      md += `|---|-----------|---------|----------|--------|--------|\n`;
      
      calls.forEach((call, index: number) => {
        const impact = call.impact 
          ? Object.entries(call.impact)
              .filter(([_, v]) => v && (v as string[]).length > 0)
              .map(([k, v]) => `${(v as string[]).length} ${k}`)
              .join(', ') || '-'
          : '-';
        md += `| ${index + 1} | ${call.component} | ${call.purpose.substring(0, 40)}${call.purpose.length > 40 ? '...' : ''} | ${(call.durationMs / 1000).toFixed(1)}s | ${call.tokensIn + call.tokensOut} | ${impact} |\n`;
      });
      md += `\n`;

      // Summary
      const totalSchemas = calls.reduce((sum: number, c) => sum + (c.impact?.schemasGenerated?.length || 0), 0);
      const totalTests = calls.reduce((sum: number, c) => sum + (c.impact?.testsPlanned?.length || 0), 0);
      const totalFiles = calls.reduce((sum: number, c) => sum + (c.impact?.filesImpacted?.length || 0), 0);
      
      if (totalSchemas > 0 || totalTests > 0 || totalFiles > 0) {
        md += `### AI Call Impact Summary\n\n`;
        if (totalSchemas > 0) md += `- Schemas Generated: ${totalSchemas}\n`;
        if (totalTests > 0) md += `- Test Plans Created: ${totalTests}\n`;
        if (totalFiles > 0) md += `- Files Impacted: ${totalFiles}\n`;
        md += `\n`;
      }

      // Cost Analysis section
      md += `## Cost Analysis\n\n`;
      md += `### Cost by Phase\n\n`;
      md += `| Phase | Calls | Tokens | Cost | Avg Cost/Call |\n`;
      md += `|-------|-------|--------|------|---------------|\n`;

      // Group by phase
      const byPhase = new Map<string, { calls: number; tokens: number; cost: number }>();
      for (const call of calls) {
        const phase = call.phase || 'unknown';
        // Use fallback estimate: $0.01 per 1K tokens (when provider-native cost not available)
        const cost = ((call.tokensIn + call.tokensOut) / 1000) * 0.01;

        const existing = byPhase.get(phase) || { calls: 0, tokens: 0, cost: 0 };
        existing.calls++;
        existing.tokens += call.tokensIn + call.tokensOut;
        existing.cost += cost;
        byPhase.set(phase, existing);
      }

      for (const [phase, data] of byPhase) {
        md += `| ${phase} | ${data.calls} | ${data.tokens.toLocaleString()} | $${data.cost.toFixed(4)} | $${(data.cost / data.calls).toFixed(4)} |\n`;
      }
      md += `\n`;

      // Optimization suggestions
      md += `### Optimization Suggestions\n\n`;
      const totalCost = Array.from(byPhase.values()).reduce((s, d) => s + d.cost, 0);
      if (totalCost > 0.10) {
        md += `- Consider using faster models (haiku/gpt-4o-mini) for ambiguity analysis\n`;
      }
      if (calls.length > 5) {
        md += `- Batch mode could reduce API calls (currently ${calls.length} calls)\n`;
      }
      if (calls.length <= 5 && totalCost <= 0.10) {
        md += `- Current build is cost-efficient\n`;
      }
      md += `\n`;
    }

    // Build Comparison section
    if (report.buildComparison && report.buildComparison.previousBuilds.length > 0) {
      md += `## Build Comparison\n\n`;
      md += `| Metric | Current | Previous | Change |\n`;
      md += `|--------|---------|----------|--------|\n`;

      const prev = report.buildComparison.previousBuilds[report.buildComparison.previousBuilds.length - 1];
      const curr = report.buildComparison.current;

      const pctChange = (c: number, p: number) => {
        if (p === 0) return 'N/A';
        const pct = ((c - p) / p * 100).toFixed(0);
        return c < p ? `${pct}%` : `+${pct}%`;
      };

      md += `| Duration | ${(curr.durationMs / 60000).toFixed(1)}m | ${(prev.metrics.durationMs / 60000).toFixed(1)}m | ${pctChange(curr.durationMs, prev.metrics.durationMs)} |\n`;
      md += `| AI Calls | ${curr.aiCalls} | ${prev.metrics.aiCalls} | ${pctChange(curr.aiCalls, prev.metrics.aiCalls)} |\n`;
      md += `| Tokens | ${curr.tokensUsed.toLocaleString()} | ${prev.metrics.tokensUsed.toLocaleString()} | ${pctChange(curr.tokensUsed, prev.metrics.tokensUsed)} |\n`;
      md += `| Cost | $${curr.estimatedCost.toFixed(4)} | $${prev.metrics.estimatedCost.toFixed(4)} | ${pctChange(curr.estimatedCost, prev.metrics.estimatedCost)} |\n`;
      md += `\n`;

      // Trend analysis
      if (report.buildComparison.previousBuilds.length >= 2) {
        const costs = report.buildComparison.previousBuilds.map(b => b.metrics.estimatedCost);
        costs.push(curr.estimatedCost);
        const improving = costs.every((c, i) => i === 0 || c <= costs[i - 1]);
        const degrading = costs.every((c, i) => i === 0 || c >= costs[i - 1]);
        
        if (improving) {
          md += `**Trend**: Improving (${report.buildComparison.previousBuilds.length + 1} consecutive builds with reduced or stable cost)\n\n`;
        } else if (degrading) {
          md += `**Trend**: Degrading (${report.buildComparison.previousBuilds.length + 1} consecutive builds with increasing cost)\n\n`;
        } else {
          md += `**Trend**: Variable (costs fluctuating between builds)\n\n`;
        }
      }
    }

    return md;
  }

  /**
   * Generate HTML build report
   */
  private generateHtmlBuildReport(report: BuildReport): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Build Report - ${report.prdSetId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { color: #333; }
    h2 { color: #555; border-bottom: 2px solid #28a745; padding-bottom: 10px; }
    .status-completed { color: #28a745; }
    .status-failed { color: #dc3545; }
    .status-in-progress { color: #ffc107; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; }
    .metric { text-align: center; padding: 15px; background: #f8f9fa; border-radius: 6px; }
    .metric-value { font-size: 1.8em; font-weight: bold; color: #28a745; }
    .metric-label { color: #666; margin-top: 5px; font-size: 0.9em; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; }
    .timestamp { color: #999; font-size: 0.9em; }
    .issue { color: #dc3545; }
    .recommendation { color: #17a2b8; }
  </style>
</head>
<body>
  <h1>PRD Set Build Report</h1>
  <p class="timestamp">Generated: ${report.generatedAt}</p>

  <div class="card">
    <h2>Summary</h2>
    <p><strong>Build ID:</strong> ${report.buildId}</p>
    <p><strong>PRD Set:</strong> ${report.prdSetId}</p>
    <p><strong>Mode:</strong> ${report.mode}</p>
    <p><strong>Status:</strong> <span class="status-${report.status}">${report.status}</span></p>
    ${report.sourceFile ? `<p><strong>Source:</strong> ${report.sourceFile}</p>` : ''}

    <div class="metric-grid">
      <div class="metric">
        <div class="metric-value">${report.summary.executabilityScore}%</div>
        <div class="metric-label">Executability</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.duration}</div>
        <div class="metric-label">Duration</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.aiCallsTotal}</div>
        <div class="metric-label">AI Calls</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.tokensUsed.toLocaleString()}</div>
        <div class="metric-label">Tokens</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.estimatedCost}</div>
        <div class="metric-label">Cost</div>
      </div>
      <div class="metric">
        <div class="metric-value">${report.summary.filesGenerated}</div>
        <div class="metric-label">Files</div>
      </div>
    </div>
  </div>

  ${report.issuesDetected.length > 0 ? `
  <div class="card">
    <h2>Issues Detected</h2>
    <ul>
      ${report.issuesDetected.map(i => `<li class="issue">${i}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

  ${report.recommendations.length > 0 ? `
  <div class="card">
    <h2>Recommendations</h2>
    <ul>
      ${report.recommendations.map(r => `<li class="recommendation">${r}</li>`).join('')}
    </ul>
  </div>
  ` : ''}

</body>
</html>`;
  }

  /**
   * Auto-generate build report after PRD set build completion
   */
  static async autoGenerateBuildReport(buildId: string): Promise<string | null> {
    try {
      const generator = new PrdReportGenerator();
      const { path: reportPath } = await generator.generateBuildReport(buildId, {
        format: 'markdown',
        includeTimingAnalysis: true,
        includeTokenBreakdown: true,
      });

      // Also generate JSON version for programmatic access
      await generator.generateBuildReport(buildId, {
        format: 'json',
        includeTimingAnalysis: true,
        includeTokenBreakdown: true,
      });

      return reportPath;
    } catch (error) {
      logger.warn(`[PrdReportGenerator] Build report auto-generation failed: ${error}`);
      return null;
    }
  }

  /**
   * Generate build flow diagram with timing annotations
   */
  private generateBuildFlowDiagram(report: BuildReport): string {
    const timing = report.timingAnalysis?.breakdown || {};

    let diagram = '```mermaid\n';
    diagram += 'flowchart TB\n';
    diagram += '    subgraph build [Build Process]\n';
    diagram += '        A[Codebase Analysis] --> B[Schema Enhancement]\n';
    diagram += '        B --> C[Test Planning]\n';
    diagram += '        C --> D[Feature Enhancement]\n';
    diagram += '        D --> E[Validation]\n';
    diagram += '        E --> F[File Generation]\n';
    diagram += '    end\n';
    diagram += '\n';

    // Add timing annotations as notes
    const phases = [
      { node: 'A', key: 'codebaseAnalysisMs', label: 'Analysis' },
      { node: 'B', key: 'schemaEnhancementMs', label: 'Schemas' },
      { node: 'C', key: 'testPlanningMs', label: 'Tests' },
      { node: 'D', key: 'featureEnhancementMs', label: 'Features' },
      { node: 'E', key: 'validationMs', label: 'Validation' },
      { node: 'F', key: 'fileGenerationMs', label: 'Files' },
    ];

    for (const p of phases) {
      const ms = timing[p.key] || 0;
      if (ms > 0) {
        diagram += `    ${p.node} -.- ${p.node}T["${this.formatDuration(ms)}"]\n`;
      }
    }

    diagram += '```\n';
    return diagram;
  }

  /**
   * Generate PRD execution plan diagram with parallel detection
   */
  private generatePrdExecutionDiagram(structure: BuildReport['prdSetStructure']): string {
    if (!structure || structure.phases.length === 0) return '';

    let diagram = '```mermaid\n';
    diagram += 'flowchart LR\n';
    diagram += '    Start([Start]) --> P1\n';

    const phases = structure.phases;
    let prevNonParallel = 'Start';

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const nodeId = `P${phase.id}`;
      const taskLabel = phase.taskCount === 1 ? '1 task' : `${phase.taskCount} tasks`;

      // Use safe label without special characters
      diagram += `    ${nodeId}["Phase ${phase.id}: ${phase.name} - ${taskLabel}"]\n`;

      if (i === 0) {
        // First phase connects to Start
        continue;
      }

      const prevPhase = phases[i - 1];
      const prevNodeId = `P${prevPhase.id}`;

      // Check for parallel execution
      if (phase.parallel && prevPhase.parallel) {
        // Both can run in parallel - connect both to same source
        diagram += `    ${prevNonParallel} --> ${nodeId}\n`;
      } else {
        // Sequential connection
        diagram += `    ${prevNodeId} --> ${nodeId}\n`;
        if (!phase.parallel) {
          prevNonParallel = nodeId;
        }
      }
    }

    // Connect last phase to Complete
    if (phases.length > 0) {
      const lastNodeId = `P${phases[phases.length - 1].id}`;
      diagram += `    ${lastNodeId} --> Complete([Complete])\n`;
    }

    diagram += '```\n';
    return diagram;
  }

  /**
   * Extract PRD set structure from generated files
   */
  async extractPrdSetStructure(prdSetDir: string): Promise<BuildReport['prdSetStructure']> {
    try {
      const indexPath = path.join(prdSetDir, 'index.md.yml');
      if (!await fs.pathExists(indexPath)) return undefined;

      const content = await fs.readFile(indexPath, 'utf-8');
      const yaml = require('js-yaml');
      const parts = content.split('---');
      if (parts.length < 2) return undefined;

      const frontmatter = parts[1];
      if (!frontmatter) return undefined;

      const parsed = yaml.load(frontmatter);
      const phases = (parsed?.requirements?.phases || []).map((p: any) => ({
        id: p.id || 0,
        name: p.name || `Phase ${p.id}`,
        file: p.file || '',
        taskCount: 0,
        parallel: p.parallel || false,
        dependencies: p.dependencies || [],
      }));

      // Read each phase file to get task counts
      // For PRD sets with split phases, tasks are under requirements.phases[0].tasks
      for (const phase of phases) {
        if (!phase.file) continue;
        const phasePath = path.join(prdSetDir, phase.file);
        if (await fs.pathExists(phasePath)) {
          try {
            const phaseContent = await fs.readFile(phasePath, 'utf-8');
            const phaseParts = phaseContent.split('---');
            if (phaseParts.length >= 2) {
              const phaseFrontmatter = phaseParts[1];
              const phaseParsed = yaml.load(phaseFrontmatter);
              // Tasks are nested under requirements.phases[0].tasks for split PRDs
              const phaseRequirements = phaseParsed?.requirements?.phases;
              if (phaseRequirements && Array.isArray(phaseRequirements) && phaseRequirements.length > 0) {
                // Aggregate tasks from all phases in the phase file (usually just one)
                let taskCount = 0;
                for (const phaseReq of phaseRequirements) {
                  taskCount += phaseReq?.tasks?.length || 0;
                }
                phase.taskCount = taskCount;
              } else {
                // Fallback: check for tasks directly under requirements
                phase.taskCount = phaseParsed?.requirements?.tasks?.length || 0;
              }
            }
          } catch {
            // Could not parse phase file
          }
        }
      }

      return {
        totalPhases: phases.length,
        totalTasks: phases.reduce((sum: number, p: any) => sum + p.taskCount, 0),
        phases,
      };
    } catch (error) {
      logger.warn(`[PrdReportGenerator] Failed to extract PRD set structure: ${error}`);
      return undefined;
    }
  }
}
