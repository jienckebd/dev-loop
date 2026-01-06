/**
 * Test Results Tracker
 *
 * Tracks test results per PRD Set, PRD, Phase, and Task execution.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { TestResults } from './hierarchical-metrics';
import { logger } from './logger';

export interface TestResult {
  testId: string;
  testName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  category?: string;
  timestamp: string;
}

export interface TestExecutionResult {
  executionId: string;
  prdSetId?: string;
  prdId?: string;
  phaseId?: number;
  taskId?: string;
  timestamp: string;
  total: number;
  passing: number;
  failing: number;
  skipped: number;
  duration: number;
  tests: TestResult[];
  flaky?: boolean; // Whether this execution had flaky tests
}

export interface TestResultsTrackerData {
  version: string;
  executions: TestExecutionResult[];
  flakyTests: Array<{
    testId: string;
    testName: string;
    totalRuns: number;
    passCount: number;
    failCount: number;
    flakinessRate: number;
  }>;
}

export class TestResultsTracker {
  private metricsPath: string;
  private data: TestResultsTrackerData;
  private currentExecution?: TestExecutionResult;

  constructor(metricsPath: string = '.devloop/test-results') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.data = this.loadData();
  }

  private loadData(): TestResultsTrackerData {
    try {
      const dataFile = path.join(this.metricsPath, 'test-results.json');
      if (fs.existsSync(dataFile)) {
        const content = fs.readFileSync(dataFile, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn(`[TestResultsTracker] Failed to load data: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      version: '1.0',
      executions: [],
      flakyTests: [],
    };
  }

  private saveData(): void {
    try {
      fs.ensureDirSync(this.metricsPath);
      const dataFile = path.join(this.metricsPath, 'test-results.json');
      fs.writeFileSync(dataFile, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[TestResultsTracker] Failed to save data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Start tracking test execution
   */
  startExecution(
    executionId: string,
    prdSetId?: string,
    prdId?: string,
    phaseId?: number,
    taskId?: string
  ): void {
    this.currentExecution = {
      executionId,
      prdSetId,
      prdId,
      phaseId,
      taskId,
      timestamp: new Date().toISOString(),
      total: 0,
      passing: 0,
      failing: 0,
      skipped: 0,
      duration: 0,
      tests: [],
    };
  }

  /**
   * Record test results from test output
   */
  recordTestResults(
    total: number,
    passing: number,
    failing: number,
    skipped: number = 0,
    duration: number = 0,
    tests?: TestResult[]
  ): void {
    if (!this.currentExecution) {
      logger.warn(`[TestResultsTracker] Cannot record test results: no execution in progress`);
      return;
    }

    this.currentExecution.total = total;
    this.currentExecution.passing = passing;
    this.currentExecution.failing = failing;
    this.currentExecution.skipped = skipped;
    this.currentExecution.duration = duration;
    if (tests) {
      this.currentExecution.tests = tests;
    }
  }

  /**
   * Complete test execution and save results
   */
  completeExecution(): void {
    if (!this.currentExecution) {
      return;
    }

    // Check for flaky tests
    this.currentExecution.flaky = this.detectFlakyTests(this.currentExecution);

    this.data.executions.push(this.currentExecution);

    // Keep only last 10000 executions to prevent bloat
    if (this.data.executions.length > 10000) {
      this.data.executions = this.data.executions.slice(-10000);
    }

    // Update flaky tests list
    this.updateFlakyTestsList();

    this.saveData();
    this.currentExecution = undefined;
  }

  /**
   * Detect flaky tests in an execution
   */
  private detectFlakyTests(execution: TestExecutionResult): boolean {
    // A test is flaky if it has both pass and fail history
    // For now, we'll mark the execution as flaky if any test has mixed results
    // In production, you'd check historical data
    return false; // Simplified for now
  }

  /**
   * Update list of flaky tests based on execution history
   */
  private updateFlakyTestsList(): void {
    const testHistory: Record<string, { total: number; passing: number; failing: number }> = {};

    // Aggregate test results across all executions
    for (const execution of this.data.executions) {
      for (const test of execution.tests) {
        if (!testHistory[test.testId]) {
          testHistory[test.testId] = { total: 0, passing: 0, failing: 0 };
        }
        testHistory[test.testId].total++;
        if (test.status === 'passed') {
          testHistory[test.testId].passing++;
        } else if (test.status === 'failed') {
          testHistory[test.testId].failing++;
        }
      }
    }

    // Identify flaky tests (tests with both passes and failures)
    this.data.flakyTests = Object.entries(testHistory)
      .filter(([_, stats]) => stats.passing > 0 && stats.failing > 0)
      .map(([testId, stats]) => {
        const testName = this.data.executions
          .flatMap(e => e.tests)
          .find(t => t.testId === testId)?.testName || testId;

        return {
          testId,
          testName,
          totalRuns: stats.total,
          passCount: stats.passing,
          failCount: stats.failing,
          flakinessRate: stats.failing / stats.total,
        };
      })
      .sort((a, b) => b.flakinessRate - a.flakinessRate);
  }

  /**
   * Get test results for a PRD
   */
  getPrdTestResults(prdId: string): TestResults {
    const executions = this.data.executions.filter(e => e.prdId === prdId);

    let total = 0;
    let passing = 0;
    let failing = 0;

    for (const exec of executions) {
      total += exec.total;
      passing += exec.passing;
      failing += exec.failing;
    }

    return {
      total,
      passing,
      failing,
      passRate: total > 0 ? passing / total : 0,
    };
  }

  /**
   * Get test results for a phase
   */
  getPhaseTestResults(prdId: string, phaseId: number): TestResults {
    const executions = this.data.executions.filter(
      e => e.prdId === prdId && e.phaseId === phaseId
    );

    let total = 0;
    let passing = 0;
    let failing = 0;

    for (const exec of executions) {
      total += exec.total;
      passing += exec.passing;
      failing += exec.failing;
    }

    return {
      total,
      passing,
      failing,
      passRate: total > 0 ? passing / total : 0,
    };
  }

  /**
   * Get flaky tests
   */
  getFlakyTests(): TestResultsTrackerData['flakyTests'] {
    return this.data.flakyTests;
  }

  /**
   * Get test execution trends
   */
  getTestTrends(prdId?: string): Array<{ timestamp: string; passRate: number; total: number }> {
    const executions = prdId
      ? this.data.executions.filter(e => e.prdId === prdId)
      : this.data.executions;

    return executions
      .map(exec => ({
        timestamp: exec.timestamp,
        passRate: exec.total > 0 ? exec.passing / exec.total : 0,
        total: exec.total,
      }))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
}

