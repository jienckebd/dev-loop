import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { TestState } from './prd-context';
import { TestResult as BaseTestResult, Artifact } from '../types';

const execAsync = promisify(exec);

export interface TestExecutionResult {
  total: number;
  passed: number;
  failed: number;
  results: ExtendedTestResult[];
}

export interface ExtendedTestResult extends BaseTestResult {
  testId: string;
  failureDetails?: FailureDetails;
}

// Note: FailureDetails and FailedNetworkRequest are already exported above

export interface FailureDetails {
  message?: string;
  stack?: string;
  screenshot?: string;
  consoleMessages?: string[];
  networkRequests?: FailedNetworkRequest[];
}

export interface FailedNetworkRequest {
  url: string;
  method: string;
  status: number;
  error?: string;
}

export class TestExecutor {
  private artifactsDir: string;
  private debug: boolean;
  private config: any; // Config type for accessing prd.execution settings

  constructor(artifactsDir: string = 'test-results', debug: boolean = false, config?: any) {
    this.artifactsDir = artifactsDir;
    this.debug = debug;
    this.config = config || {};
  }

  /**
   * Execute all tests and return results
   * Supports parallel execution via Playwright workers
   */
  async executeTests(tests: TestState[]): Promise<TestExecutionResult> {
    // Clean up any stray test entity configurations before running tests
    await this.cleanupTestEntities();

    // Filter out skipped tests
    const testsToRun = tests.filter(t => t.status !== 'skipped');
    
    if (testsToRun.length === 0) {
      return {
        total: 0,
        passed: 0,
        failed: 0,
        results: [],
      };
    }

    // Get parallel execution config from prd.execution.parallelism.testExecution
    const prdConfig = this.config.prd || {};
    const executionConfig = prdConfig.execution || {};
    const parallelismConfig = executionConfig.parallelism || {};
    const workers = parallelismConfig.testExecution || 1;
    const parallel = prdConfig.testing?.parallel !== false; // Default to true

    // If parallel execution is enabled and we have multiple tests, run them all together
    if (parallel && workers > 1 && testsToRun.length > 1) {
      if (this.debug) {
        console.log(`[TestExecutor] Running ${testsToRun.length} tests in parallel with ${workers} workers`);
      }
      return await this.executeTestsParallel(testsToRun, workers);
    } else {
      // Sequential execution (original behavior)
      if (this.debug && testsToRun.length > 1) {
        console.log(`[TestExecutor] Running ${testsToRun.length} tests sequentially`);
      }
      return await this.executeTestsSequential(testsToRun);
    }
  }

  /**
   * Execute tests sequentially (one at a time)
   */
  private async executeTestsSequential(tests: TestState[]): Promise<TestExecutionResult> {
    const results: ExtendedTestResult[] = [];

    for (const test of tests) {
      if (this.debug) {
        console.log(`[TestExecutor] Running test: ${test.id} (${test.testPath})`);
      }

      const result = await this.runTest(test);
      results.push(result);

      // Update test state
      test.lastResult = result;
      test.status = result.success ? 'passing' : 'failing';
      test.attempts++;
    }

    return {
      total: results.length,
      passed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  }

  /**
   * Execute tests in parallel using Playwright workers
   */
  private async executeTestsParallel(tests: TestState[], workers: number): Promise<TestExecutionResult> {
    // Get common test directory from all tests
    const testPaths = tests.map(t => path.resolve(process.cwd(), t.testPath));
    const testDir = path.dirname(testPaths[0]);
    
    // Verify all tests are in the same directory (required for parallel execution)
    const allInSameDir = testPaths.every(p => path.dirname(p) === testDir);
    
    if (!allInSameDir) {
      if (this.debug) {
        console.log('[TestExecutor] Tests are in different directories, falling back to sequential execution');
      }
      return await this.executeTestsSequential(tests);
    }

    // Run all tests in one Playwright invocation with workers
    const testFiles = tests.map(t => t.testPath).join(' ');
    const command = `npx playwright test ${testFiles} --workers=${workers} --reporter=json --reporter=list`;

    if (this.debug) {
      console.log(`[TestExecutor] Running parallel test command: ${command}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 600000, // 10 minutes for parallel execution
        env: {
          ...process.env,
          CI: 'true',
        },
        cwd: process.cwd(),
      });

      const output = stdout + stderr;

      // Parse Playwright JSON output
      let jsonResult: any = null;
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonResult = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // Fall back to parsing individual test results
      }

      // Map results back to test states
      const results: ExtendedTestResult[] = [];
      
      for (const test of tests) {
        const testFileName = path.basename(test.testPath);
        let testResult: ExtendedTestResult;

        // Try to find this test in Playwright's JSON output
        if (jsonResult && Array.isArray(jsonResult.suites)) {
          const testMatch = this.findTestInJsonResult(jsonResult, testFileName);
          if (testMatch) {
            testResult = {
              testId: test.id,
              success: testMatch.status === 'passed',
              duration: testMatch.duration || 0,
              output: testMatch.output || output,
              artifacts: await this.getArtifacts(test),
              failureDetails: testMatch.status !== 'passed' ? {
                message: testMatch.error?.message,
                stack: testMatch.error?.stack,
              } : undefined,
            };
          } else {
            // Fallback: create result from overall output
            testResult = await this.runTest(test);
          }
        } else {
          // Fallback: run test individually to get result
          testResult = await this.runTest(test);
        }

        results.push(testResult);

        // Update test state
        test.lastResult = testResult;
        test.status = testResult.success ? 'passing' : 'failing';
        test.attempts++;
      }

      return {
        total: results.length,
        passed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      };
    } catch (error: any) {
      // If parallel execution fails, fall back to sequential
      if (this.debug) {
        console.log(`[TestExecutor] Parallel execution failed, falling back to sequential: ${error.message}`);
      }
      return await this.executeTestsSequential(tests);
    }
  }

  /**
   * Find test result in Playwright JSON output
   */
  private findTestInJsonResult(jsonResult: any, testFileName: string): any {
    const findInSuites = (suites: any[]): any => {
      for (const suite of suites) {
        if (suite.specs) {
          for (const spec of suite.specs) {
            if (spec.file && spec.file.includes(testFileName)) {
              if (spec.tests && spec.tests.length > 0) {
                return spec.tests[0];
              }
            }
          }
        }
        if (suite.suites) {
          const found = findInSuites(suite.suites);
          if (found) return found;
        }
      }
      return null;
    };

    if (jsonResult.suites) {
      return findInSuites(jsonResult.suites);
    }
    return null;
  }

  /**
   * Run a single test
   */
  private async runTest(test: TestState): Promise<ExtendedTestResult> {
    // Run Playwright with JSON reporter for structured output
    const testPath = path.resolve(process.cwd(), test.testPath);

    // Check if test file exists
    if (!(await fs.pathExists(testPath))) {
      return {
        testId: test.id,
        success: false,
        duration: 0,
        output: `Test file not found: ${test.testPath}`,
        artifacts: [],
        failureDetails: {
          message: 'Test file not found',
        },
      } as ExtendedTestResult;
    }

    const command = `npx playwright test "${testPath}" --reporter=json --reporter=list`;

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 120000,
        env: {
          ...process.env,
          CI: 'true',
        },
        cwd: process.cwd(),
      });

      const output = stdout + stderr;

      // Try to parse JSON from stdout (Playwright JSON reporter outputs to stdout)
      let jsonResult: any = null;
      try {
        // JSON reporter output is typically at the end
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          jsonResult = JSON.parse(jsonMatch[0]);
        }
      } catch {
        // If JSON parsing fails, analyze text output
      }

      // Determine success from output
      // Check for explicit test failure markers, not just any "Error:" (which could be console output)
      const hasExplicitFailure = output.includes(' failed') ||  // Playwright's " 1 failed"
                                 output.includes('FAILED') ||
                                 output.includes('Test timeout') ||
                                 output.includes('expect(');

      // Look for passing indicators
      const hasPassingIndicator = output.includes(' passed') ||  // Playwright's "X passed"
                                  (jsonResult?.status === 'passed');

      // If JSON result says passed, trust it
      // Otherwise, check for failures - absence of failures with passing indicator = success
      const success = jsonResult?.status === 'passed' ||
                     (!hasExplicitFailure && hasPassingIndicator);

      // Extract failure details if test failed
      let failureDetails: FailureDetails | undefined;
      if (!success) {
        failureDetails = await this.extractFailureDetails(test, output, jsonResult);
      }

      return {
        testId: test.id,
        success,
        duration: jsonResult?.duration || 0,
        output,
        artifacts: await this.getArtifacts(test),
        failureDetails,
      } as ExtendedTestResult;
    } catch (error: any) {
      const output = error.stdout || error.stderr || error.message || String(error);

      return {
        testId: test.id,
        success: false,
        duration: 0,
        output,
        artifacts: await this.getArtifacts(test),
        failureDetails: {
          message: 'Test execution failed',
          stack: error.stack,
        },
      } as ExtendedTestResult;
    }
  }

  /**
   * Extract failure details from test output
   */
  private async extractFailureDetails(
    test: TestState,
    output: string,
    jsonResult: any
  ): Promise<FailureDetails> {
    const details: FailureDetails = {};

    // Extract error message
    if (jsonResult?.errors?.[0]) {
      details.message = jsonResult.errors[0].message;
      details.stack = jsonResult.errors[0].stack;
    } else {
      // Try to extract from text output
      const errorMatch = output.match(/Error:?\s*(.+)/i);
      if (errorMatch) {
        details.message = errorMatch[1];
      }
    }

    // Get screenshot if available
    details.screenshot = await this.getLatestScreenshot(test.testPath);

    // Get console messages
    details.consoleMessages = await this.getConsoleMessages(test.testPath);

    // Get failed network requests
    details.networkRequests = await this.getFailedNetworkRequests(test.testPath);

    return details;
  }

  /**
   * Get latest screenshot for a test
   */
  private async getLatestScreenshot(testPath: string): Promise<string | undefined> {
    try {
      const artifactsPath = path.resolve(process.cwd(), this.artifactsDir);
      const testResultsPath = path.join(artifactsPath, 'test-results');

      if (!(await fs.pathExists(testResultsPath))) {
        return undefined;
      }

      // Find screenshots for this test
      const testName = path.basename(testPath, '.spec.ts');
      const files = await fs.readdir(testResultsPath, { recursive: true });

      const screenshots = files
        .map(f => String(f))
        .filter(f => f.includes(testName) && (f.endsWith('.png') || f.endsWith('.jpg')))
        .sort()
        .reverse(); // Most recent first

      if (screenshots.length > 0) {
        return path.join(testResultsPath, String(screenshots[0]));
      }
    } catch {
      // Ignore errors
    }

    return undefined;
  }

  /**
   * Get console messages from test execution
   */
  private async getConsoleMessages(testPath: string): Promise<string[]> {
    // Console messages are typically in the test output
    // This would need to be enhanced to capture actual browser console
    // For now, return empty array
    return [];
  }

  /**
   * Get failed network requests
   */
  private async getFailedNetworkRequests(testPath: string): Promise<FailedNetworkRequest[]> {
    // Network request failures would need to be captured during test execution
    // For now, return empty array
    return [];
  }

  /**
   * Get artifacts (screenshots, videos, logs) for a test
   */
  private async getArtifacts(test: TestState): Promise<Artifact[]> {
      const artifacts: Artifact[] = [];

    try {
      const artifactsPath = path.resolve(process.cwd(), this.artifactsDir);
      const testResultsPath = path.join(artifactsPath, 'test-results');

      if (!(await fs.pathExists(testResultsPath))) {
        return artifacts;
      }

      const testName = path.basename(test.testPath, '.spec.ts');
      const files = await fs.readdir(testResultsPath, { recursive: true });

      for (const file of files) {
        const fileStr = String(file);
        if (fileStr.includes(testName)) {
          const filePath = path.join(testResultsPath, fileStr);
          const stat = await fs.stat(filePath);

          if (stat.isFile()) {
            const ext = path.extname(fileStr).toLowerCase();
            let type: 'screenshot' | 'video' | 'log' | 'other' = 'other';

            if (['.png', '.jpg', '.jpeg'].includes(ext)) {
              type = 'screenshot';
            } else if (['.mp4', '.webm'].includes(ext)) {
              type = 'video';
            } else if (['.log', '.txt'].includes(ext)) {
              type = 'log';
            }

            artifacts.push({
              type: type as Artifact['type'],
              path: filePath,
              name: path.basename(fileStr),
            });
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return artifacts;
  }

  /**
   * Clean up stray test entity configurations before running tests.
   * This prevents broken Drupal site errors from previous test runs.
   */
  private async cleanupTestEntities(): Promise<void> {
    try {
      // Delete all test entity type configurations that may have been created by previous tests
      const { stdout, stderr } = await execAsync(
        'ddev exec bash -c "drush sql:query \\"DELETE FROM config WHERE name LIKE \'bd.entity_type.test_%\'\\" && drush cr"',
        {
          timeout: 60000,
          cwd: process.cwd(),
        }
      );

      if (this.debug) {
        console.log('[TestExecutor] Cleaned up stray test entity configurations');
        if (stdout) console.log('[TestExecutor] Cleanup stdout:', stdout);
      }
    } catch (error: any) {
      // Log but don't fail - cleanup is best effort
      if (this.debug) {
        console.log('[TestExecutor] Warning: cleanup failed (non-critical):', error.message);
      }
    }
  }
}
