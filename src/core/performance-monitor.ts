import { logger } from './logger';

export interface PerformanceMetrics {
  phaseId: number;
  executionTime: number;
  memoryUsage: number;
  taskCount: number;
  testCount: number;
  averageTaskTime: number;
  averageTestTime: number;
}

export interface TestPerformanceMetrics {
  testId: string;
  executionTime: number;
  memoryUsage: number;
}

export interface RegressionResult {
  hasRegression: boolean;
  regressionType?: 'execution-time' | 'memory';
  current: PerformanceMetrics;
  baseline?: PerformanceMetrics;
  percentageChange: number;
  message: string;
}

export interface PerformanceReport {
  prdId: string;
  phases: PerformanceMetrics[];
  overall: {
    totalExecutionTime: number;
    averageMemoryUsage: number;
    totalTasks: number;
    totalTests: number;
  };
  regressions: RegressionResult[];
}

/**
 * PerformanceMonitor monitors performance and detects degradation.
 *
 * Supports:
 * - Phase execution time tracking
 * - Memory usage monitoring
 * - Performance regression detection
 * - Baseline comparison
 */
export class PerformanceMonitor {
  private baselines: Map<string, PerformanceMetrics> = new Map();
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Monitor phase execution.
   */
  async monitorPhaseExecution(phaseId: number): Promise<PerformanceMetrics> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // Return metrics object (in real implementation, this would track actual execution)
    const metrics: PerformanceMetrics = {
      phaseId,
      executionTime: 0, // Would be calculated after phase completes
      memoryUsage: startMemory,
      taskCount: 0,
      testCount: 0,
      averageTaskTime: 0,
      averageTestTime: 0,
    };

    return metrics;
  }

  /**
   * Monitor test execution.
   */
  async monitorTestExecution(testId: string): Promise<TestPerformanceMetrics> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage().heapUsed;

    // Return metrics object (in real implementation, this would track actual execution)
    const metrics: TestPerformanceMetrics = {
      testId,
      executionTime: 0, // Would be calculated after test completes
      memoryUsage: startMemory,
    };

    return metrics;
  }

  /**
   * Detect performance regression.
   */
  async detectPerformanceRegression(
    prdId: string,
    phaseId: number,
    metrics: PerformanceMetrics
  ): Promise<RegressionResult> {
    const baselineKey = `${prdId}-phase-${phaseId}`;
    const baseline = this.baselines.get(baselineKey);

    if (!baseline) {
      // No baseline, store current as baseline
      this.baselines.set(baselineKey, metrics);
      return {
        hasRegression: false,
        current: metrics,
        percentageChange: 0,
        message: 'No baseline available, using current metrics as baseline',
      };
    }

    // Check for execution time regression (10% threshold)
    const executionTimeChange = ((metrics.executionTime - baseline.executionTime) / baseline.executionTime) * 100;
    const hasExecutionTimeRegression = executionTimeChange > 10;

    // Check for memory regression (20% threshold)
    const memoryChange = ((metrics.memoryUsage - baseline.memoryUsage) / baseline.memoryUsage) * 100;
    const hasMemoryRegression = memoryChange > 20;

    const hasRegression = hasExecutionTimeRegression || hasMemoryRegression;

    return {
      hasRegression,
      regressionType: hasExecutionTimeRegression ? 'execution-time' : hasMemoryRegression ? 'memory' : undefined,
      current: metrics,
      baseline,
      percentageChange: hasExecutionTimeRegression ? executionTimeChange : memoryChange,
      message: hasRegression
        ? `Performance regression detected: ${hasExecutionTimeRegression ? `${executionTimeChange.toFixed(1)}% slower` : `${memoryChange.toFixed(1)}% more memory`}`
        : 'Performance within acceptable range',
    };
  }

  /**
   * Get performance report.
   */
  async getPerformanceReport(prdId: string, phases: PerformanceMetrics[]): Promise<PerformanceReport> {
    const regressions: RegressionResult[] = [];

    // Check for regressions in each phase
    for (const phaseMetrics of phases) {
      const regression = await this.detectPerformanceRegression(prdId, phaseMetrics.phaseId, phaseMetrics);
      if (regression.hasRegression) {
        regressions.push(regression);
      }
    }

    const overall = {
      totalExecutionTime: phases.reduce((sum, p) => sum + p.executionTime, 0),
      averageMemoryUsage: phases.reduce((sum, p) => sum + p.memoryUsage, 0) / phases.length,
      totalTasks: phases.reduce((sum, p) => sum + p.taskCount, 0),
      totalTests: phases.reduce((sum, p) => sum + p.testCount, 0),
    };

    return {
      prdId,
      phases,
      overall,
      regressions,
    };
  }

  /**
   * Update baseline.
   */
  updateBaseline(prdId: string, phaseId: number, metrics: PerformanceMetrics): void {
    const baselineKey = `${prdId}-phase-${phaseId}`;
    this.baselines.set(baselineKey, metrics);
  }
}


