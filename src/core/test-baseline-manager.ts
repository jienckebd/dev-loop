import { logger } from './logger';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface TestResults {
  total: number;
  passed: number;
  failed: number;
  duration: number;
  results: Array<{
    testId: string;
    success: boolean;
    duration: number;
  }>;
}

export interface Baseline {
  prdId: string;
  phaseId: number;
  timestamp: string;
  testResults: TestResults;
}

export interface ComparisonResult {
  baseline: Baseline;
  current: TestResults;
  newFailures: string[];
  fixedTests: string[];
  performanceRegression: boolean;
  performanceImprovement: boolean;
}

export interface Regression {
  type: 'test-failure' | 'performance';
  testId?: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

/**
 * TestBaselineManager manages test result baselines for regression detection.
 *
 * Supports:
 * - Baseline creation
 * - Baseline comparison
 * - Regression detection
 * - Performance regression detection
 */
export class TestBaselineManager {
  private baselinePath: string;
  private debug: boolean;

  constructor(baselinePath: string = '.devloop/baselines', debug: boolean = false) {
    this.baselinePath = baselinePath;
    this.debug = debug;
  }

  /**
   * Create a baseline for a phase.
   */
  async createBaseline(prdId: string, phaseId: number, results: TestResults): Promise<Baseline> {
    const baseline: Baseline = {
      prdId,
      phaseId,
      timestamp: new Date().toISOString(),
      testResults: results,
    };

    const baselineFile = this.getBaselinePath(prdId, phaseId);
    await fs.ensureDir(path.dirname(baselineFile));
    await fs.writeJson(baselineFile, baseline, { spaces: 2 });

    if (this.debug) {
      logger.debug(`[TestBaselineManager] Created baseline for PRD ${prdId}, phase ${phaseId}`);
    }

    return baseline;
  }

  /**
   * Compare current results with baseline.
   */
  async compareWithBaseline(prdId: string, phaseId: number, current: TestResults): Promise<ComparisonResult> {
    const baseline = await this.loadBaseline(prdId, phaseId);

    if (!baseline) {
      return {
        baseline: {
          prdId,
          phaseId,
          timestamp: new Date().toISOString(),
          testResults: current,
        },
        current,
        newFailures: [],
        fixedTests: [],
        performanceRegression: false,
        performanceImprovement: false,
      };
    }

    const newFailures: string[] = [];
    const fixedTests: string[] = [];

    // Compare test results
    const baselineTestMap = new Map(
      baseline.testResults.results.map(r => [r.testId, r.success])
    );
    const currentTestMap = new Map(
      current.results.map(r => [r.testId, r.success])
    );

    // Find new failures
    for (const [testId, success] of currentTestMap.entries()) {
      const baselineSuccess = baselineTestMap.get(testId);
      if (baselineSuccess === true && success === false) {
        newFailures.push(testId);
      }
    }

    // Find fixed tests
    for (const [testId, success] of currentTestMap.entries()) {
      const baselineSuccess = baselineTestMap.get(testId);
      if (baselineSuccess === false && success === true) {
        fixedTests.push(testId);
      }
    }

    // Check performance regression (10% threshold)
    const performanceRegression = current.duration > baseline.testResults.duration * 1.1;
    const performanceImprovement = current.duration < baseline.testResults.duration * 0.9;

    return {
      baseline,
      current,
      newFailures,
      fixedTests,
      performanceRegression,
      performanceImprovement,
    };
  }

  /**
   * Detect regressions.
   */
  async detectRegressions(comparison: ComparisonResult): Promise<Regression[]> {
    const regressions: Regression[] = [];

    // Test failure regressions
    for (const testId of comparison.newFailures) {
      regressions.push({
        type: 'test-failure',
        testId,
        message: `Test ${testId} started failing`,
        severity: 'high',
      });
    }

    // Performance regression
    if (comparison.performanceRegression) {
      regressions.push({
        type: 'performance',
        message: `Performance regression: ${comparison.current.duration}ms vs ${comparison.baseline.testResults.duration}ms`,
        severity: 'medium',
      });
    }

    return regressions;
  }

  /**
   * Update baseline with new results.
   */
  async updateBaseline(prdId: string, phaseId: number, results: TestResults): Promise<void> {
    await this.createBaseline(prdId, phaseId, results);
  }

  /**
   * Load baseline.
   */
  async loadBaseline(prdId: string, phaseId: number): Promise<Baseline | null> {
    const baselineFile = this.getBaselinePath(prdId, phaseId);

    if (await fs.pathExists(baselineFile)) {
      try {
        return await fs.readJson(baselineFile) as Baseline;
      } catch (error: any) {
        if (this.debug) {
          logger.debug(`[TestBaselineManager] Failed to load baseline: ${error.message}`);
        }
      }
    }

    return null;
  }

  /**
   * Get baseline file path.
   */
  private getBaselinePath(prdId: string, phaseId: number): string {
    return path.join(this.baselinePath, `${prdId}-phase-${phaseId}.json`);
  }
}





