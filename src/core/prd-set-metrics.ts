/**
 * PRD Set Level Metrics
 *
 * Tracks metrics for PRD set execution, aggregating across all PRDs in the set.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdSetMetricsData, PrdMetricsData } from './hierarchical-metrics';
import type { ConfigOverlay } from '../config/schema';

export interface PrdSetMetadata {
  setId: string;
  prdPaths: string[];
  startTime?: string;
  // Config overlay for the entire PRD set (merged with project config)
  configOverlay?: ConfigOverlay;
}
import { logger } from './logger';

export class PrdSetMetrics {
  private metricsPath: string;
  private metrics: Map<string, PrdSetMetricsData> = new Map();

  constructor(metricsPath: string = '.devloop/prd-set-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.loadMetrics();
  }

  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          data.forEach((metric: PrdSetMetricsData) => {
            this.metrics.set(metric.setId, this.normalizeMetric(metric));
          });
        } else if (typeof data === 'object') {
          // Support both array and object formats
          Object.values(data).forEach((metric: any) => {
            if (metric.setId) {
              this.metrics.set(metric.setId, this.normalizeMetric(metric));
            }
          });
        }
      }
    } catch (error) {
      logger.warn(`[PrdSetMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Normalize a metric object to ensure all required fields exist
   */
  private normalizeMetric(metric: Partial<PrdSetMetricsData>): PrdSetMetricsData {
    return {
      setId: metric.setId || 'unknown',
      startTime: metric.startTime || new Date().toISOString(),
      endTime: metric.endTime,
      status: metric.status || 'in-progress',
      duration: metric.duration,
      prds: {
        total: metric.prds?.total || 0,
        completed: metric.prds?.completed || 0,
        failed: metric.prds?.failed || 0,
        blocked: metric.prds?.blocked || 0,
        successRate: metric.prds?.successRate || 0,
      },
      executionLevels: {
        total: metric.executionLevels?.total || 0,
        current: metric.executionLevels?.current || 0,
        completed: metric.executionLevels?.completed || 0,
      },
      timing: {
        totalMs: metric.timing?.totalMs || 0,
        avgPrdMs: metric.timing?.avgPrdMs || 0,
        avgTaskMs: metric.timing?.avgTaskMs || 0,
      },
      tokens: {
        totalInput: metric.tokens?.totalInput || 0,
        totalOutput: metric.tokens?.totalOutput || 0,
        totalCost: metric.tokens?.totalCost,
      },
      tests: {
        total: metric.tests?.total || 0,
        passing: metric.tests?.passing || 0,
        failing: metric.tests?.failing || 0,
        passRate: metric.tests?.passRate || 0,
      },
      prdIds: metric.prdIds || [],
    };
  }

  private saveMetrics(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      const data = Array.from(this.metrics.values());
      fs.writeFileSync(this.metricsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[PrdSetMetrics] Failed to save metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  startPrdSetExecution(setId: string, prdSetMetadata: PrdSetMetadata): void {
    const metric: PrdSetMetricsData = {
      setId,
      startTime: new Date().toISOString(),
      status: 'in-progress',
      prds: {
        total: prdSetMetadata.prdPaths.length,
        completed: 0,
        failed: 0,
        blocked: 0,
        successRate: 0,
      },
      executionLevels: {
        total: 0,
        current: 0,
        completed: 0,
      },
      timing: {
        totalMs: 0,
        avgPrdMs: 0,
        avgTaskMs: 0,
      },
      tokens: {
        totalInput: 0,
        totalOutput: 0,
      },
      tests: {
        total: 0,
        passing: 0,
        failing: 0,
        passRate: 0,
      },
      prdIds: [],
    };

    this.metrics.set(setId, metric);
    this.saveMetrics();
  }

  recordPrdCompletion(prdId: string, metrics: PrdMetricsData): void {
    // Find the PRD set that contains this PRD
    for (const [setId, setMetric] of this.metrics.entries()) {
      if (setMetric.prdIds.includes(prdId) || metrics.prdSetId === setId) {
        // Update PRD counts
        if (metrics.status === 'completed') {
          setMetric.prds.completed++;
        } else if (metrics.status === 'failed') {
          setMetric.prds.failed++;
        }

        // Update timing
        if (metrics.duration) {
          setMetric.timing.totalMs += metrics.duration;
          setMetric.timing.avgPrdMs = setMetric.timing.totalMs / (setMetric.prds.completed + setMetric.prds.failed);
        }

        // Update tokens (with null checks)
        if (metrics.tokens) {
          setMetric.tokens.totalInput += metrics.tokens.totalInput || 0;
          setMetric.tokens.totalOutput += metrics.tokens.totalOutput || 0;
          if (metrics.tokens.totalCost) {
            setMetric.tokens.totalCost = (setMetric.tokens.totalCost || 0) + metrics.tokens.totalCost;
          }
        }

        // Update tests (with null checks)
        if (metrics.tests) {
          setMetric.tests.total += metrics.tests.total || 0;
          setMetric.tests.passing += metrics.tests.passing || 0;
          setMetric.tests.failing += metrics.tests.failing || 0;
          setMetric.tests.passRate = setMetric.tests.total > 0
            ? setMetric.tests.passing / setMetric.tests.total
            : 0;
        }

        // Update success rate
        const totalProcessed = setMetric.prds.completed + setMetric.prds.failed + setMetric.prds.blocked;
        setMetric.prds.successRate = totalProcessed > 0
          ? setMetric.prds.completed / totalProcessed
          : 0;

        // Ensure PRD ID is in the list
        if (!setMetric.prdIds.includes(prdId)) {
          setMetric.prdIds.push(prdId);
        }

        this.saveMetrics();
        break;
      }
    }
  }

  completePrdSetExecution(setId: string, status: 'completed' | 'failed' | 'blocked'): void {
    const metric = this.metrics.get(setId);
    if (!metric) {
      logger.warn(`[PrdSetMetrics] Cannot complete PRD set ${setId}: not found`);
      return;
    }

    metric.endTime = new Date().toISOString();
    metric.status = status;

    if (metric.startTime) {
      const start = new Date(metric.startTime);
      const end = new Date(metric.endTime);
      metric.duration = end.getTime() - start.getTime();
    }

    // Aggregate tokens from individual runs if not already aggregated
    this.aggregateTokensFromRuns(setId);

    // Calculate final statistics
    this.calculateFinalStatistics(setId);

    this.saveMetrics();

    logger.info(`[PrdSetMetrics] PRD set ${setId} finalized with status: ${status}`);

    // Emit metrics finalized event
    try {
      const { emitEvent } = require('./event-stream');
      emitEvent('metrics:finalized', {
        setId,
        status,
        duration: metric.duration,
        prdsCompleted: metric.prds.completed,
        prdsTotal: metric.prds.total,
        successRate: metric.prds.successRate,
        totalTokens: (metric.tokens.totalInput || 0) + (metric.tokens.totalOutput || 0),
      }, { severity: 'info' });
    } catch {
      // Event stream not available
    }
  }

  /**
   * Aggregate tokens from individual run metrics filtered by PRD set
   */
  aggregateTokensFromRuns(setId: string): void {
    const metric = this.metrics.get(setId);
    if (!metric) return;

    try {
      const fs = require('fs-extra');
      const path = require('path');

      // Load individual run metrics
      const metricsPath = path.resolve(process.cwd(), '.devloop/metrics.json');
      if (!fs.existsSync(metricsPath)) return;

      const metricsData = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
      const runs = metricsData.runs || [];

      // Filter runs within the PRD set execution time range
      const startTime = metric.startTime ? new Date(metric.startTime).getTime() : 0;
      const endTime = metric.endTime ? new Date(metric.endTime).getTime() : Date.now();

      let totalInput = 0;
      let totalOutput = 0;
      let runCount = 0;

      for (const run of runs) {
        if (!run.timestamp) continue;

        const runTime = new Date(run.timestamp).getTime();
        if (runTime >= startTime && runTime <= endTime) {
          totalInput += run.tokens?.input || 0;
          totalOutput += run.tokens?.output || 0;
          runCount++;
        }
      }

      // Only update if we found runs and current values are zero
      if (runCount > 0 && metric.tokens.totalInput === 0) {
        metric.tokens.totalInput = totalInput;
        metric.tokens.totalOutput = totalOutput;

        // Estimate cost (assuming GPT-4 pricing)
        const inputCost = totalInput * 0.00003; // $0.03 per 1K input tokens
        const outputCost = totalOutput * 0.00006; // $0.06 per 1K output tokens
        metric.tokens.totalCost = inputCost + outputCost;

        logger.debug(`[PrdSetMetrics] Aggregated tokens from ${runCount} runs: ${totalInput} input, ${totalOutput} output`);

        // Emit aggregation event
        try {
          const { emitEvent } = require('./event-stream');
          emitEvent('metrics:aggregated', {
            setId,
            runsProcessed: runCount,
            totalInput,
            totalOutput,
            estimatedCost: metric.tokens.totalCost,
          }, { severity: 'info' });
        } catch {
          // Event stream not available
        }
      }
    } catch (error) {
      logger.warn(`[PrdSetMetrics] Failed to aggregate tokens: ${error}`);
    }
  }

  /**
   * Calculate final statistics for PRD set
   */
  private calculateFinalStatistics(setId: string): void {
    const metric = this.metrics.get(setId);
    if (!metric) return;

    // Calculate success rate
    const totalProcessed = metric.prds.completed + metric.prds.failed + metric.prds.blocked;
    metric.prds.successRate = totalProcessed > 0
      ? metric.prds.completed / totalProcessed
      : 0;

    // Calculate average timing
    if (totalProcessed > 0 && metric.timing.totalMs > 0) {
      metric.timing.avgPrdMs = metric.timing.totalMs / totalProcessed;
    }

    // Calculate test pass rate
    if (metric.tests.total > 0) {
      metric.tests.passRate = metric.tests.passing / metric.tests.total;
    }

    // Log summary
    logger.info(`[PrdSetMetrics] Final stats for ${setId}:`);
    logger.info(`  PRDs: ${metric.prds.completed}/${metric.prds.total} completed (${(metric.prds.successRate * 100).toFixed(1)}% success)`);
    logger.info(`  Tokens: ${metric.tokens.totalInput} input, ${metric.tokens.totalOutput} output`);
    logger.info(`  Duration: ${metric.duration ? (metric.duration / 1000 / 60).toFixed(1) : 'N/A'} minutes`);
  }

  getPrdSetMetrics(setId: string): PrdSetMetricsData | undefined {
    return this.metrics.get(setId);
  }

  getAllPrdSetMetrics(): PrdSetMetricsData[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Finalize any in-progress PRD sets (called on startup or cleanup)
   */
  finalizeInProgressSets(): void {
    for (const [setId, metric] of this.metrics.entries()) {
      if (metric.status === 'in-progress') {
        // Check if this set has been inactive for more than 1 hour
        const lastActivity = metric.endTime || metric.startTime;
        if (lastActivity) {
          const inactiveMs = Date.now() - new Date(lastActivity).getTime();
          const oneHour = 60 * 60 * 1000;

          if (inactiveMs > oneHour) {
            logger.warn(`[PrdSetMetrics] Finalizing stale PRD set ${setId} (inactive for ${(inactiveMs / 1000 / 60).toFixed(0)} minutes)`);
            this.completePrdSetExecution(setId, 'blocked');
          }
        }
      }
    }
  }

  /**
   * Get aggregated metrics summary for reporting
   */
  getMetricsSummary(): {
    totalSets: number;
    completedSets: number;
    failedSets: number;
    totalTokensUsed: number;
    estimatedCost: number;
    averageSuccessRate: number;
  } {
    const allMetrics = this.getAllPrdSetMetrics();
    let totalTokensUsed = 0;
    let estimatedCost = 0;
    let successRateSum = 0;
    let completedSets = 0;
    let failedSets = 0;

    for (const metric of allMetrics) {
      totalTokensUsed += (metric.tokens.totalInput || 0) + (metric.tokens.totalOutput || 0);
      estimatedCost += metric.tokens.totalCost || 0;
      successRateSum += metric.prds.successRate;

      if (metric.status === 'completed') completedSets++;
      else if (metric.status === 'failed') failedSets++;
    }

    return {
      totalSets: allMetrics.length,
      completedSets,
      failedSets,
      totalTokensUsed,
      estimatedCost,
      averageSuccessRate: allMetrics.length > 0 ? successRateSum / allMetrics.length : 0,
    };
  }
}

