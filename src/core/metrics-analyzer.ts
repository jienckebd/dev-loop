/**
 * Metrics Analyzer
 *
 * Analyzes existing metrics data to identify patterns,
 * calculate token costs, track trends, and provide insights.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { MetricsData, RunMetrics } from './debug-metrics';
import { PrdSetMetricsData } from './hierarchical-metrics';
import { logger } from './logger';

export interface TokenCostAnalysis {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  byProvider?: Record<string, { tokens: number; cost: number }>;
  byPrdSet?: Record<string, { tokens: number; cost: number }>;
  highCostTasks: Array<{
    taskId: string;
    tokens: number;
    cost: number;
    timestamp: string;
  }>;
}

export interface TimingAnalysis {
  avgAiCallMs: number;
  avgTestRunMs: number;
  avgTotalMs: number;
  slowestTasks: Array<{
    taskId: string;
    durationMs: number;
    timestamp: string;
  }>;
  fastestTasks: Array<{
    taskId: string;
    durationMs: number;
    timestamp: string;
  }>;
}

export interface SuccessRateTrend {
  period: string;
  successRate: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
}

export interface MetricsAnalysisReport {
  generatedAt: string;
  summary: {
    totalRuns: number;
    successRate: number;
    totalTokens: number;
    estimatedCost: number;
    avgDurationMs: number;
  };
  tokenCostAnalysis: TokenCostAnalysis;
  timingAnalysis: TimingAnalysis;
  successRateTrends: SuccessRateTrend[];
  recommendations: string[];
}

export interface AnalyzerOptions {
  prdSetId?: string;
  timeRangeStart?: string;
  timeRangeEnd?: string;
  limit?: number;
}

// Token cost estimates (per 1K tokens)
const TOKEN_COSTS = {
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  'default': { input: 0.01, output: 0.03 },
};

export class MetricsAnalyzer {
  private metricsPath: string;
  private prdSetMetricsPath: string;

  constructor(
    metricsPath: string = '.devloop/metrics.json',
    prdSetMetricsPath: string = '.devloop/prd-set-metrics.json'
  ) {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.prdSetMetricsPath = path.resolve(process.cwd(), prdSetMetricsPath);
  }

  /**
   * Load run metrics from file
   */
  private async loadRunMetrics(): Promise<MetricsData | null> {
    try {
      if (await fs.pathExists(this.metricsPath)) {
        const content = await fs.readFile(this.metricsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[MetricsAnalyzer] Failed to load metrics: ${error}`);
    }
    return null;
  }

  /**
   * Load PRD set metrics from file
   */
  private async loadPrdSetMetrics(): Promise<PrdSetMetricsData[]> {
    try {
      if (await fs.pathExists(this.prdSetMetricsPath)) {
        const content = await fs.readFile(this.prdSetMetricsPath, 'utf-8');
        const data = JSON.parse(content);
        return Array.isArray(data) ? data : Object.values(data);
      }
    } catch (error) {
      logger.warn(`[MetricsAnalyzer] Failed to load PRD set metrics: ${error}`);
    }
    return [];
  }

  /**
   * Filter runs based on options
   */
  private filterRuns(runs: RunMetrics[], options: AnalyzerOptions): RunMetrics[] {
    let filtered = [...runs];

    // Filter by time range
    if (options.timeRangeStart) {
      const start = new Date(options.timeRangeStart).getTime();
      filtered = filtered.filter(r =>
        r.timestamp && new Date(r.timestamp).getTime() >= start
      );
    }

    if (options.timeRangeEnd) {
      const end = new Date(options.timeRangeEnd).getTime();
      filtered = filtered.filter(r =>
        r.timestamp && new Date(r.timestamp).getTime() <= end
      );
    }

    // Apply limit
    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  /**
   * Analyze token costs across runs
   */
  async analyzeTokenCosts(options: AnalyzerOptions = {}): Promise<TokenCostAnalysis> {
    const metricsData = await this.loadRunMetrics();
    const runs = metricsData?.runs || [];
    const filtered = this.filterRuns(runs, options);

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const highCostTasks: TokenCostAnalysis['highCostTasks'] = [];

    for (const run of filtered) {
      const input = run.tokens?.input || 0;
      const output = run.tokens?.output || 0;
      totalInputTokens += input;
      totalOutputTokens += output;

      const total = input + output;
      if (total > 10000) { // Track tasks using > 10K tokens
        const cost = this.calculateCost(input, output);
        highCostTasks.push({
          taskId: run.taskId?.toString() || 'unknown',
          tokens: total,
          cost,
          timestamp: run.timestamp,
        });
      }
    }

    // Sort high cost tasks
    highCostTasks.sort((a, b) => b.tokens - a.tokens);

    const estimatedCost = this.calculateCost(totalInputTokens, totalOutputTokens);

    return {
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      estimatedCost,
      highCostTasks: highCostTasks.slice(0, 10),
    };
  }

  /**
   * Calculate cost from token counts
   */
  private calculateCost(inputTokens: number, outputTokens: number, provider = 'default'): number {
    const rates = TOKEN_COSTS[provider as keyof typeof TOKEN_COSTS] || TOKEN_COSTS.default;
    return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
  }

  /**
   * Analyze timing patterns
   */
  async analyzeTimings(options: AnalyzerOptions = {}): Promise<TimingAnalysis> {
    const metricsData = await this.loadRunMetrics();
    const runs = metricsData?.runs || [];
    const filtered = this.filterRuns(runs, options);

    let totalAiCall = 0;
    let totalTestRun = 0;
    let totalDuration = 0;
    let count = 0;

    const taskDurations: Array<{ taskId: string; durationMs: number; timestamp: string }> = [];

    for (const run of filtered) {
      if (run.timing) {
        totalAiCall += run.timing.aiCallMs || 0;
        totalTestRun += run.timing.testRunMs || 0;
        totalDuration += run.timing.totalMs || 0;
        count++;

        if (run.timing.totalMs) {
          taskDurations.push({
            taskId: run.taskId?.toString() || 'unknown',
            durationMs: run.timing.totalMs,
            timestamp: run.timestamp,
          });
        }
      }
    }

    // Sort by duration
    taskDurations.sort((a, b) => b.durationMs - a.durationMs);

    return {
      avgAiCallMs: count > 0 ? totalAiCall / count : 0,
      avgTestRunMs: count > 0 ? totalTestRun / count : 0,
      avgTotalMs: count > 0 ? totalDuration / count : 0,
      slowestTasks: taskDurations.slice(0, 5),
      fastestTasks: taskDurations.slice(-5).reverse(),
    };
  }

  /**
   * Analyze success rate trends over time
   */
  async analyzeSuccessRateTrends(
    periodDays: number = 7,
    options: AnalyzerOptions = {}
  ): Promise<SuccessRateTrend[]> {
    const metricsData = await this.loadRunMetrics();
    const runs = metricsData?.runs || [];
    const filtered = this.filterRuns(runs, options);

    // Group runs by period
    const periods = new Map<string, RunMetrics[]>();

    for (const run of filtered) {
      if (!run.timestamp) continue;

      const date = new Date(run.timestamp);
      const periodStart = new Date(date);
      periodStart.setDate(periodStart.getDate() - (periodStart.getDate() % periodDays));
      periodStart.setHours(0, 0, 0, 0);

      const periodKey = periodStart.toISOString().split('T')[0];

      if (!periods.has(periodKey)) {
        periods.set(periodKey, []);
      }
      periods.get(periodKey)!.push(run);
    }

    // Calculate trends
    const trends: SuccessRateTrend[] = [];

    for (const [period, periodRuns] of periods) {
      const completed = periodRuns.filter(r => r.status === 'completed').length;
      const failed = periodRuns.filter(r => r.status === 'failed').length;
      const total = periodRuns.length;

      trends.push({
        period,
        successRate: total > 0 ? completed / total : 0,
        totalTasks: total,
        completedTasks: completed,
        failedTasks: failed,
      });
    }

    // Sort by period
    trends.sort((a, b) => a.period.localeCompare(b.period));

    return trends;
  }

  /**
   * Generate comprehensive analysis report
   */
  async generateAnalysisReport(options: AnalyzerOptions = {}): Promise<MetricsAnalysisReport> {
    const metricsData = await this.loadRunMetrics();
    const runs = metricsData?.runs || [];
    const filtered = this.filterRuns(runs, options);

    const tokenCostAnalysis = await this.analyzeTokenCosts(options);
    const timingAnalysis = await this.analyzeTimings(options);
    const successRateTrends = await this.analyzeSuccessRateTrends(7, options);

    // Calculate summary
    const completedRuns = filtered.filter(r => r.status === 'completed').length;
    const successRate = filtered.length > 0 ? completedRuns / filtered.length : 0;

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      tokenCostAnalysis,
      timingAnalysis,
      successRateTrends
    );

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        totalRuns: filtered.length,
        successRate,
        totalTokens: tokenCostAnalysis.totalTokens,
        estimatedCost: tokenCostAnalysis.estimatedCost,
        avgDurationMs: timingAnalysis.avgTotalMs,
      },
      tokenCostAnalysis,
      timingAnalysis,
      successRateTrends,
      recommendations,
    };
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    tokenCost: TokenCostAnalysis,
    timing: TimingAnalysis,
    trends: SuccessRateTrend[]
  ): string[] {
    const recommendations: string[] = [];

    // Token cost recommendations
    if (tokenCost.highCostTasks.length > 5) {
      recommendations.push(
        `HIGH TOKEN USAGE: ${tokenCost.highCostTasks.length} tasks used >10K tokens each. ` +
        `Consider reducing context size or using more efficient prompts.`
      );
    }

    if (tokenCost.estimatedCost > 10) {
      recommendations.push(
        `COST ALERT: Estimated total cost is $${tokenCost.estimatedCost.toFixed(2)}. ` +
        `Review high-cost tasks and optimize token usage.`
      );
    }

    // Timing recommendations
    if (timing.avgAiCallMs > 30000) {
      recommendations.push(
        `SLOW AI CALLS: Average AI call takes ${(timing.avgAiCallMs / 1000).toFixed(1)}s. ` +
        `Consider using a faster model or reducing prompt complexity.`
      );
    }

    if (timing.slowestTasks.length > 0 && timing.slowestTasks[0].durationMs > 120000) {
      recommendations.push(
        `VERY SLOW TASK: Slowest task took ${(timing.slowestTasks[0].durationMs / 1000 / 60).toFixed(1)} minutes. ` +
        `Investigate task ${timing.slowestTasks[0].taskId} for optimization opportunities.`
      );
    }

    // Success rate recommendations
    if (trends.length >= 2) {
      const recentTrend = trends[trends.length - 1];
      const previousTrend = trends[trends.length - 2];

      if (recentTrend.successRate < previousTrend.successRate - 0.1) {
        recommendations.push(
          `DECLINING SUCCESS RATE: Success rate dropped from ` +
          `${(previousTrend.successRate * 100).toFixed(0)}% to ${(recentTrend.successRate * 100).toFixed(0)}%. ` +
          `Investigate recent changes that may have caused regression.`
        );
      }

      if (recentTrend.successRate < 0.7) {
        recommendations.push(
          `LOW SUCCESS RATE: Only ${(recentTrend.successRate * 100).toFixed(0)}% of tasks succeed. ` +
          `Review validation errors and common failure patterns.`
        );
      }
    }

    return recommendations;
  }

  /**
   * Export metrics in various formats
   */
  async exportMetrics(
    format: 'json' | 'csv' | 'markdown',
    options: AnalyzerOptions = {}
  ): Promise<string> {
    const report = await this.generateAnalysisReport(options);

    switch (format) {
      case 'json':
        return JSON.stringify(report, null, 2);

      case 'csv': {
        // Export runs as CSV
        const metricsData = await this.loadRunMetrics();
        const runs = metricsData?.runs || [];
        const filtered = this.filterRuns(runs, options);

        const headers = ['timestamp', 'taskId', 'status', 'inputTokens', 'outputTokens',
                        'aiCallMs', 'testRunMs', 'totalMs'];
        const rows = filtered.map(run => [
          run.timestamp,
          run.taskId || '',
          run.status,
          run.tokens?.input || 0,
          run.tokens?.output || 0,
          run.timing?.aiCallMs || 0,
          run.timing?.testRunMs || 0,
          run.timing?.totalMs || 0,
        ].join(','));

        return [headers.join(','), ...rows].join('\n');
      }

      case 'markdown': {
        let md = `# Metrics Analysis Report\n\n`;
        md += `Generated: ${report.generatedAt}\n\n`;

        md += `## Summary\n\n`;
        md += `| Metric | Value |\n`;
        md += `|--------|-------|\n`;
        md += `| Total Runs | ${report.summary.totalRuns} |\n`;
        md += `| Success Rate | ${(report.summary.successRate * 100).toFixed(1)}% |\n`;
        md += `| Total Tokens | ${report.summary.totalTokens.toLocaleString()} |\n`;
        md += `| Estimated Cost | $${report.summary.estimatedCost.toFixed(4)} |\n`;
        md += `| Avg Duration | ${(report.summary.avgDurationMs / 1000).toFixed(1)}s |\n\n`;

        if (report.recommendations.length > 0) {
          md += `## Recommendations\n\n`;
          for (const rec of report.recommendations) {
            md += `- ${rec}\n`;
          }
          md += `\n`;
        }

        return md;
      }
    }
  }

  /**
   * Get summary for MCP tool
   */
  async getMetricsSummary(): Promise<{
    totalRuns: number;
    successRate: number;
    totalTokens: number;
    estimatedCost: number;
    recentSuccessRate: number;
    recommendations: string[];
  }> {
    const report = await this.generateAnalysisReport({ limit: 100 });

    const recentTrend = report.successRateTrends[report.successRateTrends.length - 1];

    return {
      totalRuns: report.summary.totalRuns,
      successRate: report.summary.successRate,
      totalTokens: report.summary.totalTokens,
      estimatedCost: report.summary.estimatedCost,
      recentSuccessRate: recentTrend?.successRate || report.summary.successRate,
      recommendations: report.recommendations,
    };
  }
}

