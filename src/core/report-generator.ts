import * as fs from 'fs-extra';
import * as path from 'path';
import { getParallelMetricsTracker, ParallelExecutionMetrics } from './parallel-metrics';
import { DebugMetrics, MetricsData } from './debug-metrics';
import { ObservationTracker, Observation } from './observation-tracker';

/**
 * PRD Execution Report Data
 */
export interface PrdExecutionReport {
  prdId: string;
  prdName: string;
  status: 'completed' | 'failed' | 'partial';
  startTime: string;
  endTime: string;
  durationMs: number;
  tasks: {
    total: number;
    completed: number;
    failed: number;
    blocked: number;
  };
  parallelExecution: {
    maxConcurrency: number;
    avgConcurrency: number;
    parallelEfficiency: number;
    totalAgents: number;
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
    avgPerTask: number;
    estimatedCost: number;
  };
  timing: {
    avgAiCallMs: number;
    avgTestRunMs: number;
    totalDurationMs: number;
  };
  errors: {
    total: number;
    retries: number;
    blockedTasks: number;
  };
  patterns: {
    matched: string[];
    occurrences: Record<string, number>;
  };
  files: {
    created: number;
    patched: number;
    deleted: number;
  };
  jsonParsing?: {
    totalFailures: number;
    failuresByProvider: Record<string, number>;
    commonPatterns: string[];
    suggestions: string[];
  };
}

/**
 * Generates comprehensive markdown reports for PRD execution
 */
export class ReportGenerator {
  private reportsPath: string;
  private observationTracker: ObservationTracker;

  constructor(reportsPath: string = '.devloop/reports') {
    this.reportsPath = path.resolve(process.cwd(), reportsPath);
    this.observationTracker = new ObservationTracker();
  }

  /**
   * Generate a comprehensive execution report
   */
  async generateReport(
    prdId: string,
    prdName: string,
    tasksData: { total: number; completed: number; failed: number; blocked: number },
    debugMetrics?: MetricsData,
    parallelMetrics?: ParallelExecutionMetrics,
    patterns?: Record<string, number>,
    filesModified?: { created: number; patched: number; deleted: number }
  ): Promise<string> {
    const now = new Date();
    const timestamp = now.toISOString();

    // Build report data
    const report: PrdExecutionReport = {
      prdId,
      prdName,
      status: this.determineStatus(tasksData),
      startTime: parallelMetrics?.startTime || timestamp,
      endTime: parallelMetrics?.endTime || timestamp,
      durationMs: parallelMetrics?.totalDurationMs || 0,
      tasks: tasksData,
      parallelExecution: {
        maxConcurrency: parallelMetrics?.concurrency.maxConcurrent || 1,
        avgConcurrency: parallelMetrics?.concurrency.avgConcurrent || 1,
        parallelEfficiency: parallelMetrics?.coordination.parallelEfficiency || 0,
        totalAgents: parallelMetrics?.agents.length || 0,
      },
      tokens: {
        totalInput: parallelMetrics?.tokens.totalInput || debugMetrics?.summary.totalTokensInput || 0,
        totalOutput: parallelMetrics?.tokens.totalOutput || debugMetrics?.summary.totalTokensOutput || 0,
        avgPerTask: parallelMetrics?.tokens.avgPerAgent || 0,
        estimatedCost: this.estimateCost(
          parallelMetrics?.tokens.totalInput || debugMetrics?.summary.totalTokensInput || 0,
          parallelMetrics?.tokens.totalOutput || debugMetrics?.summary.totalTokensOutput || 0
        ),
      },
      timing: {
        avgAiCallMs: debugMetrics?.summary.avgAiCallMs || 0,
        avgTestRunMs: debugMetrics?.summary.avgTestRunMs || 0,
        totalDurationMs: parallelMetrics?.totalDurationMs || 0,
      },
      errors: {
        total: tasksData.failed,
        retries: this.countRetries(debugMetrics),
        blockedTasks: tasksData.blocked,
      },
      patterns: {
        matched: patterns ? Object.keys(patterns) : [],
        occurrences: patterns || {},
      },
      files: filesModified || { created: 0, patched: 0, deleted: 0 },
      jsonParsing: await this.getJsonParsingMetrics(),
    };

    // Generate markdown
    const markdown = this.generateMarkdown(report);

    // Save report
    const filename = `prd-${prdId}-${now.toISOString().replace(/[:.]/g, '-')}.md`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.ensureDir(this.reportsPath);
    await fs.writeFile(filePath, markdown, 'utf-8');

    console.log(`[ReportGenerator] Report saved to: ${filePath}`);
    return filePath;
  }

  /**
   * Generate markdown content for the report
   */
  private generateMarkdown(report: PrdExecutionReport): string {
    const lines: string[] = [];

    // Header
    lines.push(`# PRD Execution Report: ${report.prdName}`);
    lines.push('');
    lines.push(`**Generated**: ${new Date().toISOString()}`);
    lines.push(`**PRD ID**: ${report.prdId}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **Status**: ${this.formatStatus(report.status)}`);
    lines.push(`- **Duration**: ${this.formatDuration(report.durationMs)}`);
    lines.push(`- **Tasks**: ${report.tasks.completed}/${report.tasks.total} completed`);
    lines.push(`- **Success Rate**: ${report.tasks.total > 0 ? ((report.tasks.completed / report.tasks.total) * 100).toFixed(1) : 0}%`);
    lines.push('');

    // Parallel Execution Analysis
    lines.push('## Parallel Execution Analysis');
    lines.push('');
    lines.push(`- **Max Concurrency**: ${report.parallelExecution.maxConcurrency} agents`);
    lines.push(`- **Avg Concurrency**: ${report.parallelExecution.avgConcurrency.toFixed(1)} agents`);
    lines.push(`- **Parallel Efficiency**: ${(report.parallelExecution.parallelEfficiency * 100).toFixed(1)}%`);
    lines.push(`- **Total Agents Spawned**: ${report.parallelExecution.totalAgents}`);
    lines.push('');

    // Timing Breakdown
    lines.push('## Timing Breakdown');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total Duration | ${this.formatDuration(report.timing.totalDurationMs)} |`);
    lines.push(`| Avg AI Call | ${this.formatDuration(report.timing.avgAiCallMs)} |`);
    lines.push(`| Avg Test Run | ${this.formatDuration(report.timing.avgTestRunMs)} |`);
    lines.push('');

    // Token Usage
    lines.push('## Token Usage');
    lines.push('');
    lines.push(`- **Total Input**: ${this.formatNumber(report.tokens.totalInput)} tokens`);
    lines.push(`- **Total Output**: ${this.formatNumber(report.tokens.totalOutput)} tokens`);
    lines.push(`- **Avg per Task**: ${this.formatNumber(report.tokens.avgPerTask)} tokens`);
    lines.push(`- **Estimated Cost**: $${report.tokens.estimatedCost.toFixed(4)}`);
    lines.push('');

    // Errors & Retries
    lines.push('## Errors & Retries');
    lines.push('');
    lines.push(`- **Total Errors**: ${report.errors.total}`);
    lines.push(`- **Retries**: ${report.errors.retries}`);
    lines.push(`- **Blocked Tasks**: ${report.errors.blockedTasks}`);
    lines.push('');

    // Pattern Observations
    if (report.patterns.matched.length > 0) {
      lines.push('## Pattern Observations');
      lines.push('');
      for (const pattern of report.patterns.matched) {
        const count = report.patterns.occurrences[pattern] || 0;
        lines.push(`- \`${pattern}\`: ${count} occurrence${count !== 1 ? 's' : ''}`);
      }
      lines.push('');
    }

    // Files Modified
    lines.push('## Files Modified');
    lines.push('');
    lines.push(`- **Created**: ${report.files.created} files`);
    lines.push(`- **Patched**: ${report.files.patched} files`);
    lines.push(`- **Deleted**: ${report.files.deleted} files`);
    lines.push('');

    // JSON Parsing Metrics
    if (report.jsonParsing && report.jsonParsing.totalFailures > 0) {
      lines.push('## JSON Parsing Analysis');
      lines.push('');
      lines.push(`- **Total Failures**: ${report.jsonParsing.totalFailures}`);
      lines.push('');

      // Provider breakdown
      if (Object.keys(report.jsonParsing.failuresByProvider).length > 0) {
        lines.push('### Failures by Provider');
        lines.push('');
        lines.push('| Provider | Failures |');
        lines.push('|----------|----------|');
        for (const [provider, count] of Object.entries(report.jsonParsing.failuresByProvider)) {
          lines.push(`| ${provider} | ${count} |`);
        }
        lines.push('');
      }

      // Common patterns
      if (report.jsonParsing.commonPatterns.length > 0) {
        lines.push('### Common Failure Patterns');
        lines.push('');
        for (const pattern of report.jsonParsing.commonPatterns.slice(0, 5)) {
          lines.push(`- ${pattern}`);
        }
        lines.push('');
      }

      // Suggestions
      if (report.jsonParsing.suggestions.length > 0) {
        lines.push('### Improvement Suggestions');
        lines.push('');
        for (const suggestion of report.jsonParsing.suggestions.slice(0, 5)) {
          lines.push(`- ${suggestion}`);
        }
        lines.push('');
      }
    }

    // Task Status Details
    lines.push('## Task Status');
    lines.push('');
    lines.push('| Status | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Completed | ${report.tasks.completed} |`);
    lines.push(`| Failed | ${report.tasks.failed} |`);
    lines.push(`| Blocked | ${report.tasks.blocked} |`);
    lines.push(`| Total | ${report.tasks.total} |`);
    lines.push('');

    // Footer
    lines.push('---');
    lines.push('');
    lines.push('*Report generated by dev-loop*');

    return lines.join('\n');
  }

  /**
   * Generate a summary for CLI display
   */
  generateSummary(report: PrdExecutionReport): string {
    const lines: string[] = [];

    lines.push('');
    lines.push(`PRD Complete! Report saved.`);
    lines.push('');
    lines.push('Summary:');
    lines.push(`  Tasks: ${report.tasks.completed}/${report.tasks.total} (${report.tasks.total > 0 ? ((report.tasks.completed / report.tasks.total) * 100).toFixed(0) : 0}%)`);
    lines.push(`  Duration: ${this.formatDuration(report.durationMs)}`);
    lines.push(`  Tokens: ${this.formatNumber(report.tokens.totalInput + report.tokens.totalOutput)} ($${report.tokens.estimatedCost.toFixed(2)})`);
    lines.push(`  Parallel Efficiency: ${(report.parallelExecution.parallelEfficiency * 100).toFixed(0)}%`);

    return lines.join('\n');
  }

  private determineStatus(tasks: { completed: number; failed: number; total: number }): 'completed' | 'failed' | 'partial' {
    if (tasks.completed === tasks.total && tasks.total > 0) {
      return 'completed';
    } else if (tasks.completed === 0 && tasks.failed > 0) {
      return 'failed';
    } else {
      return 'partial';
    }
  }

  private formatStatus(status: 'completed' | 'failed' | 'partial'): string {
    switch (status) {
      case 'completed': return '✅ Completed';
      case 'failed': return '❌ Failed';
      case 'partial': return '⚠️ Partial';
    }
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  private formatNumber(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  }

  private estimateCost(inputTokens: number, outputTokens: number): number {
    // Approximate costs based on Claude pricing
    // Input: ~$0.003 per 1K tokens, Output: ~$0.015 per 1K tokens
    const inputCost = (inputTokens / 1000) * 0.003;
    const outputCost = (outputTokens / 1000) * 0.015;
    return inputCost + outputCost;
  }

  private countRetries(debugMetrics?: MetricsData): number {
    if (!debugMetrics?.runs) return 0;
    return debugMetrics.runs.filter(r => r.status === 'failed').length;
  }

  /**
   * Get JSON parsing metrics from observation tracker
   */
  private async getJsonParsingMetrics(): Promise<{
    totalFailures: number;
    failuresByProvider: Record<string, number>;
    commonPatterns: string[];
    suggestions: string[];
  }> {
    try {
      const providerComparison = await this.observationTracker.getProviderComparison();
      const commonPatterns = await this.observationTracker.getCommonJsonFailurePatterns();
      const suggestions = await this.observationTracker.getJsonFailureSuggestions();

      // Calculate total failures
      let totalFailures = 0;
      const failuresByProvider: Record<string, number> = {};
      for (const [provider, data] of Object.entries(providerComparison)) {
        failuresByProvider[provider] = data.occurrences;
        totalFailures += data.occurrences;
      }

      // Extract pattern descriptions
      const patternDescriptions = commonPatterns
        .slice(0, 5)
        .map(obs => obs.description);

      return {
        totalFailures,
        failuresByProvider,
        commonPatterns: patternDescriptions,
        suggestions,
      };
    } catch (error) {
      // Return empty metrics if observation tracker fails
      return {
        totalFailures: 0,
        failuresByProvider: {},
        commonPatterns: [],
        suggestions: [],
      };
    }
  }

  /**
   * Quick summary from current execution state
   */
  async generateQuickReport(
    prdId: string,
    prdName: string,
    tasksCompleted: number,
    tasksTotal: number,
    tasksFailed: number = 0,
    tasksBlocked: number = 0
  ): Promise<string> {
    const parallelMetrics = getParallelMetricsTracker();
    const currentExecution = parallelMetrics.getCurrentExecution();

    return this.generateReport(
      prdId,
      prdName,
      { total: tasksTotal, completed: tasksCompleted, failed: tasksFailed, blocked: tasksBlocked },
      undefined,
      currentExecution || undefined
    );
  }
}

// Singleton for global access
let globalReportGenerator: ReportGenerator | null = null;

export function getReportGenerator(reportsPath?: string): ReportGenerator {
  if (!globalReportGenerator) {
    globalReportGenerator = new ReportGenerator(reportsPath);
  }
  return globalReportGenerator;
}

