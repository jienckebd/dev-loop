import * as fs from 'fs-extra';
import * as path from 'path';
import { getParallelMetricsTracker, ParallelExecutionMetrics } from '../metrics/parallel';
import { DebugMetrics, MetricsData } from '../metrics/debug';
import { ObservationTracker, Observation } from '../tracking/observation-tracker';

/**
 * PRD Execution Report Data
 */
/**
 * Feature utilization data for a single feature
 */
export interface FeatureUtilization {
  name: string;
  utilized: boolean;
  invocations: number;
  successes: number;
  failures: number;
  avgDurationMs: number;
  details?: Record<string, any>;
}

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
  // NEW: Feature utilization metrics
  featureUtilization?: FeatureUtilization[];
  // NEW: Recovery system metrics
  recovery?: {
    totalAttempts: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    byStrategy: Record<string, { attempts: number; successes: number }>;
  };
  // NEW: CLI command metrics
  cliCommands?: {
    totalExecuted: number;
    byCommand: Record<string, { executed: number; succeeded: number }>;
    avgDurationMs: number;
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
      featureUtilization: await this.analyzeFeatureUtilization(debugMetrics),
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

    // Feature Utilization Analysis (NEW)
    if (report.featureUtilization && report.featureUtilization.length > 0) {
      lines.push('## Feature Utilization Analysis');
      lines.push('');
      lines.push('| Feature | Utilized | Invocations | Successes | Failures | Success Rate |');
      lines.push('|---------|----------|-------------|-----------|----------|--------------|');
      
      for (const feature of report.featureUtilization) {
        const successRate = feature.invocations > 0 
          ? ((feature.successes / feature.invocations) * 100).toFixed(1) + '%'
          : 'N/A';
        const utilized = feature.utilized ? '✅' : '❌';
        lines.push(`| ${feature.name} | ${utilized} | ${feature.invocations} | ${feature.successes} | ${feature.failures} | ${successRate} |`);
      }
      lines.push('');

      // Feature details for high-usage features
      const highUsageFeatures = report.featureUtilization.filter(f => f.invocations > 10 && f.details);
      if (highUsageFeatures.length > 0) {
        lines.push('### Feature Details');
        lines.push('');
        for (const feature of highUsageFeatures) {
          lines.push(`**${feature.name}**:`);
          for (const [key, value] of Object.entries(feature.details || {})) {
            lines.push(`- ${key}: ${value}`);
          }
          lines.push('');
        }
      }

      // Underutilized features
      const underutilized = report.featureUtilization.filter(f => !f.utilized);
      if (underutilized.length > 0) {
        lines.push('### Underutilized Features');
        lines.push('');
        lines.push('The following features were not used during this execution:');
        lines.push('');
        for (const feature of underutilized) {
          lines.push(`- ${feature.name}`);
        }
        lines.push('');
      }
    }

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
   * Analyze feature utilization based on metrics data
   */
  private async analyzeFeatureUtilization(debugMetrics?: MetricsData): Promise<FeatureUtilization[]> {
    const features: FeatureUtilization[] = [];

    // Feature: JSON Parsing
    try {
      const jsonStatsPath = path.join(process.cwd(), '.devloop/json-parsing-stats.json');
      if (await fs.pathExists(jsonStatsPath)) {
        const jsonStats = await fs.readJson(jsonStatsPath);
        features.push({
          name: 'JSON Parsing',
          utilized: true,
          invocations: jsonStats.totalAttempts || 0,
          successes: jsonStats.successfulAttempts || 0,
          failures: jsonStats.failedAttempts || 0,
          avgDurationMs: 0,
          details: {
            successRate: jsonStats.successRate || 0,
            primaryStrategy: jsonStats.primaryStrategy || 'unknown',
          },
        });
      }
    } catch (err) {
      // Ignore
    }

    // Feature: Pattern Learning
    try {
      const patternsPath = path.join(process.cwd(), '.devloop/patterns.json');
      if (await fs.pathExists(patternsPath)) {
        const patterns = await fs.readJson(patternsPath);
        const patternCount = patterns.patterns?.length || 0;
        const totalOccurrences = patterns.patterns?.reduce((sum: number, p: any) => sum + (p.occurrences || 0), 0) || 0;
        features.push({
          name: 'Pattern Learning',
          utilized: patternCount > 0,
          invocations: totalOccurrences,
          successes: patternCount,
          failures: 0,
          avgDurationMs: 0,
          details: {
            patternsRecorded: patternCount,
            activePatterns: patterns.patterns?.filter((p: any) => p.status === 'active')?.length || 0,
          },
        });
      }
    } catch (err) {
      // Ignore
    }

    // Feature: Context Building
    if (debugMetrics?.runs) {
      const contextRuns = debugMetrics.runs.filter(r => r.context);
      const avgContextFiles = contextRuns.length > 0 
        ? contextRuns.reduce((sum, r) => sum + (r.context?.filesIncluded || 0), 0) / contextRuns.length 
        : 0;
      const avgContextChars = contextRuns.length > 0
        ? contextRuns.reduce((sum, r) => sum + (r.context?.sizeChars || 0), 0) / contextRuns.length
        : 0;
      
      features.push({
        name: 'Context Building',
        utilized: contextRuns.length > 0,
        invocations: contextRuns.length,
        successes: contextRuns.filter(r => r.status === 'completed').length,
        failures: contextRuns.filter(r => r.status === 'failed').length,
        avgDurationMs: 0, // Not tracked in summary
        details: {
          avgFiles: Math.round(avgContextFiles),
          avgChars: Math.round(avgContextChars),
        },
      });
    }

    // Feature: Test Execution
    if (debugMetrics?.runs) {
      const testRuns = debugMetrics.runs.filter(r => r.timing?.testRunMs !== undefined && r.timing.testRunMs > 0);
      const successfulTests = testRuns.filter(r => r.status === 'completed');
      features.push({
        name: 'Test Execution',
        utilized: testRuns.length > 0,
        invocations: testRuns.length,
        successes: successfulTests.length,
        failures: testRuns.length - successfulTests.length,
        avgDurationMs: debugMetrics.summary?.avgTestRunMs || 0,
      });
    }

    // Feature: Patch Application
    if (debugMetrics?.runs) {
      const patchRuns = debugMetrics.runs.filter(r => r.patches);
      const totalPatches = patchRuns.reduce((sum, r) => sum + (r.patches?.attempted || 0), 0);
      const successfulPatches = patchRuns.reduce((sum, r) => sum + (r.patches?.succeeded || 0), 0);
      
      features.push({
        name: 'Patch Application',
        utilized: totalPatches > 0,
        invocations: totalPatches,
        successes: successfulPatches,
        failures: totalPatches - successfulPatches,
        avgDurationMs: 0,
      });
    }

    // Feature: Validation Gate
    if (debugMetrics?.runs) {
      const validationRuns = debugMetrics.runs.filter(r => r.validation !== undefined);
      features.push({
        name: 'Validation Gate',
        utilized: validationRuns.length > 0,
        invocations: validationRuns.length,
        successes: validationRuns.filter(r => r.validation?.preValidationPassed).length,
        failures: validationRuns.filter(r => !r.validation?.preValidationPassed).length,
        avgDurationMs: 0,
      });
    }

    // Feature: Framework Plugin (CLI Commands)
    try {
      // Check for CLI executor metrics in metrics.json
      if (debugMetrics && (debugMetrics as any).cliCommands) {
        const cliMetrics = (debugMetrics as any).cliCommands;
        features.push({
          name: 'CLI Commands',
          utilized: cliMetrics.totalExecuted > 0,
          invocations: cliMetrics.totalExecuted || 0,
          successes: cliMetrics.succeeded || 0,
          failures: (cliMetrics.totalExecuted || 0) - (cliMetrics.succeeded || 0),
          avgDurationMs: cliMetrics.avgDurationMs || 0,
        });
      }
    } catch (err) {
      // Ignore
    }

    // Feature: Recovery System
    try {
      if (debugMetrics && (debugMetrics as any).recovery) {
        const recoveryMetrics = (debugMetrics as any).recovery;
        features.push({
          name: 'Recovery System',
          utilized: recoveryMetrics.totalAttempts > 0,
          invocations: recoveryMetrics.totalAttempts || 0,
          successes: recoveryMetrics.successfulRecoveries || 0,
          failures: recoveryMetrics.failedRecoveries || 0,
          avgDurationMs: recoveryMetrics.avgRecoveryTimeMs || 0,
        });
      }
    } catch (err) {
      // Ignore
    }

    return features;
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

