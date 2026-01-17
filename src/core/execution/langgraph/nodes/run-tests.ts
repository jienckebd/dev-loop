/**
 * Run Tests Node
 *
 * LangGraph node that executes tests after applying code changes.
 * Supports Playwright and other test runners configured in the project.
 */

import { TestResult } from '../../../../types';
import { WorkflowState, RunMetrics } from '../state';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';
import { spawn } from 'child_process';

export interface RunTestsNodeConfig {
  config: Config;
  debug?: boolean;
  // Optional custom test runner
  testRunner?: {
    run: (testPath?: string) => Promise<TestResult>;
  };
}

/**
 * Create the run tests node function
 */
export function runTests(nodeConfig: RunTestsNodeConfig) {
  const { config, debug, testRunner } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    // Skip if apply failed
    if (!state.applyResult?.success) {
      logger.warn('[RunTests] Skipping - apply failed');
      return {
        status: 'testing',
        testResult: {
          success: false,
          output: 'Tests skipped - code changes not applied',
          artifacts: [],
          duration: 0,
        },
      };
    }

    try {
      if (debug) {
        logger.debug('[RunTests] Running tests');
      }

      const startTime = Date.now();
      let testResult: TestResult;

      // Use custom test runner if provided
      if (testRunner) {
        testResult = await testRunner.run();
      } else {
        // Use configured test command
        testResult = await runConfiguredTests(config, debug);
      }

      const duration = Date.now() - startTime;

      // Update metrics
      const updatedMetrics: Partial<RunMetrics> = {
        ...state.metrics,
        testsRun: (state.metrics?.testsRun || 0) + 1,
        testsPassed: (state.metrics?.testsPassed || 0) + (testResult.success ? 1 : 0),
        testsFailed: (state.metrics?.testsFailed || 0) + (testResult.success ? 0 : 1),
      };

      if (testResult.success) {
        logger.info(`[RunTests] Tests passed in ${duration}ms`);
      } else {
        logger.warn(`[RunTests] Tests failed in ${duration}ms`);
      }

      return {
        status: 'testing',
        testResult: {
          ...testResult,
          duration,
        },
        metrics: updatedMetrics as RunMetrics,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[RunTests] Error: ${errorMessage}`);

      return {
        status: 'failed',
        testResult: {
          success: false,
          output: `Test execution error: ${errorMessage}`,
          artifacts: [],
          duration: 0,
        },
        error: `Test execution failed: ${errorMessage}`,
      };
    }
  };
}

/**
 * Run tests using configured command
 */
async function runConfiguredTests(
  config: Config,
  debug?: boolean
): Promise<TestResult> {
  const testCommand = config.testing.command;
  const timeout = config.testing.timeout || 60000;

  if (!testCommand) {
    logger.warn('[RunTests] No test command configured');
    return {
      success: true, // Consider no tests as success
      output: 'No test command configured',
      artifacts: [],
      duration: 0,
    };
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    const parts = testCommand.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    if (debug) {
      logger.debug(`[RunTests] Running: ${testCommand}`);
    }

    const proc = spawn(cmd, args, {
      cwd: process.cwd(),
      shell: true,
      timeout,
    });

    let output = '';
    let errorOutput = '';

    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      const success = code === 0;
      const fullOutput = output + (errorOutput ? `\n\nSTDERR:\n${errorOutput}` : '');

      resolve({
        success,
        output: fullOutput,
        artifacts: [],
        duration,
      });
    });

    proc.on('error', (error) => {
      const duration = Date.now() - startTime;
      resolve({
        success: false,
        output: `Failed to run tests: ${error.message}\n${output}`,
        artifacts: [],
        duration,
      });
    });

    // Handle timeout
    setTimeout(() => {
      if (proc.exitCode === null) {
        proc.kill('SIGTERM');
        resolve({
          success: false,
          output: `Test timed out after ${timeout}ms\n${output}`,
          artifacts: [],
          duration: timeout,
        });
      }
    }, timeout);
  });
}

/**
 * Parse test output to extract test count
 */
export function parseTestCount(output: string): { passed: number; failed: number; total: number } {
  let passed = 0;
  let failed = 0;
  let total = 0;

  // Playwright format: "X passed"
  const playwrightPassed = output.match(/(\d+) passed/);
  if (playwrightPassed) {
    passed = parseInt(playwrightPassed[1], 10);
  }

  const playwrightFailed = output.match(/(\d+) failed/);
  if (playwrightFailed) {
    failed = parseInt(playwrightFailed[1], 10);
  }

  // Jest/Vitest format: "Tests: X passed, Y failed, Z total"
  const jestMatch = output.match(/Tests:\s*(\d+) passed,?\s*(\d+)? failed,?\s*(\d+)? total/);
  if (jestMatch) {
    passed = parseInt(jestMatch[1], 10) || 0;
    failed = parseInt(jestMatch[2], 10) || 0;
    total = parseInt(jestMatch[3], 10) || passed + failed;
  }

  if (total === 0) {
    total = passed + failed;
  }

  return { passed, failed, total };
}
