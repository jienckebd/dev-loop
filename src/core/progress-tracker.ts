import { logger } from './logger';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface PhaseMetrics {
  phaseId: number;
  tasksCompleted: number;
  testsPassed: number;
  testsFailed: number;
  validationGatesPassed: number;
  validationGatesFailed: number;
  timeSpent: number;
  errorCount: number;
  retryCount: number;
}

export interface TaskMetrics {
  taskId: string;
  duration: number;
  testsPassed: number;
  testsFailed: number;
  errors: string[];
}

export interface ProgressReport {
  prdId: string;
  phases: PhaseMetrics[];
  totalTasksCompleted: number;
  totalTestsPassed: number;
  totalTestsFailed: number;
  totalTimeSpent: number;
  overallProgress: number;
}

export interface ComparisonResult {
  current: ProgressReport;
  baseline?: ProgressReport;
  regressions: string[];
  improvements: string[];
}

/**
 * ProgressTracker tracks progress and collects metrics for PRD execution.
 *
 * Supports:
 * - Phase-level metrics
 * - Task-level metrics
 * - Progress reports
 * - Baseline comparison
 */
export class ProgressTracker {
  private metricsPath: string;
  private debug: boolean;
  private metrics: Map<string, ProgressReport> = new Map();

  constructor(metricsPath: string = '.devloop/metrics', debug: boolean = false) {
    this.metricsPath = metricsPath;
    this.debug = debug;
  }

  /**
   * Track phase completion.
   */
  async trackPhaseCompletion(prdId: string, phaseId: number, metrics: PhaseMetrics): Promise<void> {
    const report = await this.getProgressReport(prdId);

    // Update or add phase metrics
    const existingPhase = report.phases.find(p => p.phaseId === phaseId);
    if (existingPhase) {
      Object.assign(existingPhase, metrics);
    } else {
      report.phases.push(metrics);
    }

    // Update totals
    report.totalTasksCompleted = report.phases.reduce((sum, p) => sum + p.tasksCompleted, 0);
    report.totalTestsPassed = report.phases.reduce((sum, p) => sum + p.testsPassed, 0);
    report.totalTestsFailed = report.phases.reduce((sum, p) => sum + p.testsFailed, 0);
    report.totalTimeSpent = report.phases.reduce((sum, p) => sum + p.timeSpent, 0);

    // Calculate overall progress (simplified)
    const totalPhases = Math.max(...report.phases.map(p => p.phaseId), 0);
    report.overallProgress = totalPhases > 0 ? (report.phases.length / totalPhases) * 100 : 0;

    await this.saveProgressReport(prdId, report);
  }

  /**
   * Track task completion.
   */
  async trackTaskCompletion(prdId: string, taskId: string, metrics: TaskMetrics): Promise<void> {
    // Task metrics are aggregated into phase metrics
    // This method can be used for detailed task tracking if needed
    if (this.debug) {
      logger.debug(`[ProgressTracker] Task ${taskId} completed: ${metrics.duration}ms`);
    }
  }

  /**
   * Track validation result.
   */
  async trackValidationResult(prdId: string, validationType: string, result: { success: boolean }): Promise<void> {
    // Validation results are tracked in phase metrics
    if (this.debug) {
      logger.debug(`[ProgressTracker] Validation ${validationType}: ${result.success ? 'PASS' : 'FAIL'}`);
    }
  }

  /**
   * Get progress report.
   */
  async getProgressReport(prdId: string): Promise<ProgressReport> {
    if (this.metrics.has(prdId)) {
      return this.metrics.get(prdId)!;
    }

    // Try to load from file
    const reportPath = path.join(this.metricsPath, `${prdId}.json`);
    if (await fs.pathExists(reportPath)) {
      try {
        const report = await fs.readJson(reportPath) as ProgressReport;
        this.metrics.set(prdId, report);
        return report;
      } catch (error: any) {
        if (this.debug) {
          logger.debug(`[ProgressTracker] Failed to load report: ${error.message}`);
        }
      }
    }

    // Create new report
    const report: ProgressReport = {
      prdId,
      phases: [],
      totalTasksCompleted: 0,
      totalTestsPassed: 0,
      totalTestsFailed: 0,
      totalTimeSpent: 0,
      overallProgress: 0,
    };

    this.metrics.set(prdId, report);
    return report;
  }

  /**
   * Compare with baseline.
   */
  async compareWithBaseline(prdId: string, baselinePath?: string): Promise<ComparisonResult> {
    const current = await this.getProgressReport(prdId);
    let baseline: ProgressReport | undefined;

    if (baselinePath) {
      try {
        baseline = await fs.readJson(baselinePath) as ProgressReport;
      } catch (error: any) {
        if (this.debug) {
          logger.debug(`[ProgressTracker] Failed to load baseline: ${error.message}`);
        }
      }
    }

    const regressions: string[] = [];
    const improvements: string[] = [];

    if (baseline) {
      // Compare metrics
      if (current.totalTestsFailed > baseline.totalTestsFailed) {
        regressions.push(`Test failures increased from ${baseline.totalTestsFailed} to ${current.totalTestsFailed}`);
      } else if (current.totalTestsFailed < baseline.totalTestsFailed) {
        improvements.push(`Test failures decreased from ${baseline.totalTestsFailed} to ${current.totalTestsFailed}`);
      }

      if (current.totalTimeSpent > baseline.totalTimeSpent * 1.1) {
        regressions.push(`Execution time increased by more than 10%`);
      } else if (current.totalTimeSpent < baseline.totalTimeSpent * 0.9) {
        improvements.push(`Execution time decreased by more than 10%`);
      }
    }

    return {
      current,
      baseline,
      regressions,
      improvements,
    };
  }

  /**
   * Save progress report.
   */
  private async saveProgressReport(prdId: string, report: ProgressReport): Promise<void> {
    this.metrics.set(prdId, report);

    const reportPath = path.join(this.metricsPath, `${prdId}.json`);
    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeJson(reportPath, report, { spaces: 2 });
  }
}


