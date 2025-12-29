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

  constructor(artifactsDir: string = 'test-results', debug: boolean = false) {
    this.artifactsDir = artifactsDir;
    this.debug = debug;
  }

  /**
   * Execute all tests and return results
   */
  async executeTests(tests: TestState[]): Promise<TestExecutionResult> {
    const results: ExtendedTestResult[] = [];

    for (const test of tests) {
      if (test.status === 'skipped') {
        continue;
      }

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
      const success = !output.includes('failed') && 
                     !output.includes('Failed') &&
                     !output.includes('Error:') &&
                     (jsonResult?.status === 'passed' || output.includes('passed'));

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
}
