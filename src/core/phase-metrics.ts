/**
 * Phase Level Metrics
 *
 * Tracks metrics for phase execution, aggregating across all tasks in the phase.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PhaseMetricsData } from './hierarchical-metrics';
import { RunMetrics } from './debug-metrics';
import { logger } from './logger';

export class PhaseMetrics {
  private metricsPath: string;
  private metrics: Map<string, PhaseMetricsData> = new Map(); // Key: `${prdId}-${phaseId}`

  constructor(metricsPath: string = '.devloop/phase-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.loadMetrics();
  }

  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          data.forEach((metric: PhaseMetricsData) => {
            const key = `${metric.prdId}-${metric.phaseId}`;
            this.metrics.set(key, metric);
          });
        } else if (typeof data === 'object') {
          Object.values(data).forEach((metric: any) => {
            if (metric.prdId && metric.phaseId !== undefined) {
              const key = `${metric.prdId}-${metric.phaseId}`;
              this.metrics.set(key, metric);
            }
          });
        }
      }
    } catch (error) {
      logger.warn(`[PhaseMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private saveMetrics(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      const data = Array.from(this.metrics.values());
      fs.writeFileSync(this.metricsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[PhaseMetrics] Failed to save metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  startPhaseExecution(phaseId: number, phaseName: string, prdId: string, parallel: boolean = false): void {
    const key = `${prdId}-${phaseId}`;
    const metric: PhaseMetricsData = {
      phaseId,
      phaseName,
      prdId,
      startTime: new Date().toISOString(),
      status: 'in-progress',
      tasks: {
        total: 0,
        completed: 0,
        failed: 0,
        successRate: 0,
      },
      timing: {
        totalMs: 0,
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
      },
      parallel,
    };

    this.metrics.set(key, metric);
    this.saveMetrics();
  }

  recordTaskCompletion(taskId: string, metrics: RunMetrics, prdId: string, phaseId: number): void {
    const key = `${prdId}-${phaseId}`;
    const phaseMetric = this.metrics.get(key);
    if (!phaseMetric) {
      logger.warn(`[PhaseMetrics] Cannot record task completion: Phase ${prdId}-${phaseId} not found`);
      return;
    }

    phaseMetric.tasks.total++;

    if (metrics.status === 'completed') {
      phaseMetric.tasks.completed++;
    } else if (metrics.status === 'failed') {
      phaseMetric.tasks.failed++;
    }

    // Update timing
    if (metrics.timing?.totalMs) {
      phaseMetric.timing.totalMs += metrics.timing.totalMs;
      const totalTasks = phaseMetric.tasks.completed + phaseMetric.tasks.failed;
      phaseMetric.timing.avgTaskMs = totalTasks > 0
        ? phaseMetric.timing.totalMs / totalTasks
        : 0;
    }

    // Update tokens
    if (metrics.tokens?.input) {
      phaseMetric.tokens.totalInput += metrics.tokens.input;
    }
    if (metrics.tokens?.output) {
      phaseMetric.tokens.totalOutput += metrics.tokens.output;
    }

    // Update success rate
    const totalProcessed = phaseMetric.tasks.completed + phaseMetric.tasks.failed;
    phaseMetric.tasks.successRate = totalProcessed > 0
      ? phaseMetric.tasks.completed / totalProcessed
      : 0;

    this.saveMetrics();
  }

  recordTestResults(prdId: string, phaseId: number, total: number, passing: number, failing: number): void {
    const key = `${prdId}-${phaseId}`;
    const phaseMetric = this.metrics.get(key);
    if (!phaseMetric) {
      logger.warn(`[PhaseMetrics] Cannot record test results: Phase ${prdId}-${phaseId} not found`);
      return;
    }

    phaseMetric.tests.total += total;
    phaseMetric.tests.passing += passing;
    phaseMetric.tests.failing += failing;

    this.saveMetrics();
  }

  completePhaseExecution(phaseId: number, prdId: string, status: 'completed' | 'failed'): void {
    const key = `${prdId}-${phaseId}`;
    const metric = this.metrics.get(key);
    if (!metric) {
      logger.warn(`[PhaseMetrics] Cannot complete phase ${prdId}-${phaseId}: not found`);
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

  getPhaseMetrics(phaseId: number, prdId: string): PhaseMetricsData | undefined {
    const key = `${prdId}-${phaseId}`;
    return this.metrics.get(key);
  }

  getAllPhaseMetrics(): PhaseMetricsData[] {
    return Array.from(this.metrics.values());
  }

  getPhasesForPrd(prdId: string): PhaseMetricsData[] {
    return Array.from(this.metrics.values()).filter(m => m.prdId === prdId);
  }
}





