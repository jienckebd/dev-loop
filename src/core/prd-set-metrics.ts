/**
 * PRD Set Level Metrics
 *
 * Tracks metrics for PRD set execution, aggregating across all PRDs in the set.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdSetMetricsData, PrdMetricsData } from './hierarchical-metrics';

export interface PrdSetMetadata {
  setId: string;
  prdPaths: string[];
  startTime?: string;
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
            this.metrics.set(metric.setId, metric);
          });
        } else if (typeof data === 'object') {
          // Support both array and object formats
          Object.values(data).forEach((metric: any) => {
            if (metric.setId) {
              this.metrics.set(metric.setId, metric);
            }
          });
        }
      }
    } catch (error) {
      logger.warn(`[PrdSetMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
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

        // Update tokens
        setMetric.tokens.totalInput += metrics.tokens.totalInput;
        setMetric.tokens.totalOutput += metrics.tokens.totalOutput;
        if (metrics.tokens.totalCost) {
          setMetric.tokens.totalCost = (setMetric.tokens.totalCost || 0) + metrics.tokens.totalCost;
        }

        // Update tests
        setMetric.tests.total += metrics.tests.total;
        setMetric.tests.passing += metrics.tests.passing;
        setMetric.tests.failing += metrics.tests.failing;
        setMetric.tests.passRate = setMetric.tests.total > 0
          ? setMetric.tests.passing / setMetric.tests.total
          : 0;

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

    this.saveMetrics();
  }

  getPrdSetMetrics(setId: string): PrdSetMetricsData | undefined {
    return this.metrics.get(setId);
  }

  getAllPrdSetMetrics(): PrdSetMetricsData[] {
    return Array.from(this.metrics.values());
  }
}

