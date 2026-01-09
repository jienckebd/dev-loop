/**
 * Playwright TDD MCP Tools - TDD workflow tools for Playwright browser automation
 *
 * Provides the following tools:
 * - devloop_playwright_write_test: Write test before implementation (TDD red phase)
 * - devloop_playwright_run_test: Run test via Playwright
 * - devloop_playwright_verify_feature: Verify feature with test (TDD green phase)
 * - devloop_playwright_analyze_failure: Analyze test failure for root cause
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { z } from 'zod';
import { Config } from '../../config/schema/core';
import { PlaywrightMCPIntegration, TestSpec } from '../../core/utils/playwright-mcp-integration';
import { Requirement } from '../../core/prd/coordination/context';

// Tool schemas
const writeTestSchema = z.object({
  requirementId: z.string().describe('ID of the requirement to test'),
  description: z.string().describe('Description of what to test'),
  acceptanceCriteria: z.array(z.string()).describe('List of acceptance criteria'),
  testPath: z.string().optional().describe('Custom path for the test file'),
});

const runTestSchema = z.object({
  testPath: z.string().describe('Path to the test file to run'),
  timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
  headless: z.boolean().optional().default(true).describe('Run in headless mode'),
});

const verifyFeatureSchema = z.object({
  requirementId: z.string().describe('ID of the requirement to verify'),
  testPath: z.string().describe('Path to the test file'),
  featurePath: z.string().optional().describe('Path to the feature implementation'),
});

const analyzeFailureSchema = z.object({
  testPath: z.string().describe('Path to the failing test'),
  error: z.string().describe('Error message from the test'),
  stderr: z.string().optional().describe('Standard error output'),
  screenshotPath: z.string().optional().describe('Path to failure screenshot'),
});

// Store for test specs (in a real implementation, this would be persisted)
const testSpecs = new Map<string, TestSpec>();

/**
 * Register Playwright TDD MCP tools
 */
export function registerPlaywrightTDDTools(mcp: any, getConfig: () => Promise<Config>): void {
  const debug = process.env.MCP_DEBUG === 'true';

  // devloop_playwright_write_test - Write test first (TDD red phase)
  mcp.addTool({
    name: 'devloop_playwright_write_test',
    description: 'Write a Playwright test before implementation (TDD red phase). Generates a test file based on the requirement.',
    parameters: writeTestSchema,
    execute: async (args: z.infer<typeof writeTestSchema>) => {
      try {
        const config = await getConfig();

        // Create requirement from args
        const requirement: Requirement = {
          id: args.requirementId,
          description: args.description,
          acceptanceCriteria: args.acceptanceCriteria,
          type: 'functional',
        };

        // Generate test
        const autonomousConfig = (config as any).autonomous || {};
        const testGenConfig = autonomousConfig.testGeneration || {};
        const testDir = testGenConfig.testDir || 'tests/playwright/auto';

        const safeId = args.requirementId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const testPath = args.testPath || path.join(testDir, `${safeId}.spec.ts`);
        const fullPath = path.resolve(process.cwd(), testPath);

        // Generate test code
        const testGenConfigData = (config as any).testGeneration || {};
        const baseUrl = testGenConfigData.baseUrl || 'https://sysf.ddev.site';

        const testCode = generateTestCode(requirement, baseUrl);

        // Write test file
        await fs.ensureDir(path.dirname(fullPath));
        await fs.writeFile(fullPath, testCode, 'utf-8');

        // Store test spec
        const testSpec: TestSpec = {
          id: `test-${args.requirementId}`,
          requirementId: args.requirementId,
          testPath,
          testCode,
          assertions: extractAssertions(testCode),
          status: 'written',
        };
        testSpecs.set(testSpec.id, testSpec);

        return {
          success: true,
          data: {
            testId: testSpec.id,
            testPath: path.relative(process.cwd(), fullPath),
            assertionCount: testSpec.assertions.length,
            message: 'Test written successfully. Run it with devloop_playwright_run_test.',
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // devloop_playwright_run_test - Run test via Playwright
  mcp.addTool({
    name: 'devloop_playwright_run_test',
    description: 'Run a Playwright test file. Returns pass/fail status with detailed output.',
    parameters: runTestSchema,
    execute: async (args: z.infer<typeof runTestSchema>) => {
      try {
        const testPath = path.isAbsolute(args.testPath)
          ? args.testPath
          : path.join(process.cwd(), args.testPath);

        if (!await fs.pathExists(testPath)) {
          return { success: false, error: `Test file not found: ${args.testPath}` };
        }

        // Run test using Playwright CLI
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const startTime = Date.now();

        try {
          const headlessFlag = args.headless ? '' : '--headed';
          const { stdout, stderr } = await execAsync(
            `npx playwright test "${testPath}" --reporter=json ${headlessFlag}`,
            {
              cwd: process.cwd(),
              timeout: args.timeout,
              env: {
                ...process.env,
                CI: 'true', // Ensure consistent behavior
              },
            }
          );

          const duration = Date.now() - startTime;

          // Parse result
          let passed = false;
          let parsedResult: any = null;

          try {
            parsedResult = JSON.parse(stdout);
            passed = parsedResult.suites?.[0]?.specs?.[0]?.ok || false;
          } catch {
            passed = stdout.includes('passed') && !stdout.includes('failed');
          }

          return {
            success: true,
            data: {
              testPath: path.relative(process.cwd(), testPath),
              passed,
              duration,
              output: stdout.slice(0, 2000),
              stderr: stderr?.slice(0, 500),
            },
          };
        } catch (error) {
          const duration = Date.now() - startTime;
          const errorOutput = error instanceof Error ? error.message : String(error);

          return {
            success: true,
            data: {
              testPath: path.relative(process.cwd(), testPath),
              passed: false,
              duration,
              error: errorOutput.slice(0, 2000),
              stdout: (error as any).stdout?.slice(0, 2000),
              stderr: (error as any).stderr?.slice(0, 500),
            },
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // devloop_playwright_verify_feature - Verify feature implementation
  mcp.addTool({
    name: 'devloop_playwright_verify_feature',
    description: 'Verify that a feature implementation passes its test (TDD green phase).',
    parameters: verifyFeatureSchema,
    execute: async (args: z.infer<typeof verifyFeatureSchema>) => {
      try {
        const testPath = path.isAbsolute(args.testPath)
          ? args.testPath
          : path.join(process.cwd(), args.testPath);

        if (!await fs.pathExists(testPath)) {
          return { success: false, error: `Test file not found: ${args.testPath}` };
        }

        // Run the test
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        const startTime = Date.now();

        try {
          const { stdout, stderr } = await execAsync(
            `npx playwright test "${testPath}" --reporter=json`,
            {
              cwd: process.cwd(),
              timeout: 60000,
            }
          );

          const duration = Date.now() - startTime;

          // Parse result
          let passed = false;
          try {
            const parsedResult = JSON.parse(stdout);
            passed = parsedResult.suites?.[0]?.specs?.[0]?.ok || false;
          } catch {
            passed = stdout.includes('passed') && !stdout.includes('failed');
          }

          // Update test spec if we have it
          const testSpec = testSpecs.get(`test-${args.requirementId}`);
          if (testSpec) {
            testSpec.status = passed ? 'passing' : 'failing';
          }

          return {
            success: true,
            data: {
              requirementId: args.requirementId,
              testPath: path.relative(process.cwd(), testPath),
              verified: passed,
              duration,
              message: passed
                ? 'Feature verified successfully! Test passes.'
                : 'Verification failed. Test does not pass yet.',
              output: stdout.slice(0, 1000),
            },
          };
        } catch (error) {
          const duration = Date.now() - startTime;

          return {
            success: true,
            data: {
              requirementId: args.requirementId,
              testPath: path.relative(process.cwd(), testPath),
              verified: false,
              duration,
              error: error instanceof Error ? error.message : String(error),
              stdout: (error as any).stdout?.slice(0, 1000),
              stderr: (error as any).stderr?.slice(0, 500),
            },
          };
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  // devloop_playwright_analyze_failure - Analyze test failure
  mcp.addTool({
    name: 'devloop_playwright_analyze_failure',
    description: 'Analyze a test failure to determine root cause and suggest fixes. Returns actionable fix suggestions.',
    parameters: analyzeFailureSchema,
    execute: async (args: z.infer<typeof analyzeFailureSchema>) => {
      try {
        // Analyze error patterns
        const error = args.error || '';
        const stderr = args.stderr || '';
        const combined = `${error}\n${stderr}`;

        const analysis = analyzeTestError(combined, args.testPath);

        return {
          success: true,
          data: {
            testPath: args.testPath,
            rootCause: analysis.rootCause,
            confidence: analysis.confidence,
            suggestedFixes: analysis.fixes,
            doNotDo: analysis.doNotDo,
            screenshot: args.screenshotPath,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}

// Helper functions

function generateTestCode(requirement: Requirement, baseUrl: string): string {
  const safeDescription = requirement.description.slice(0, 50).replace(/['"]/g, '');

  return `import { test, expect } from '@playwright/test';

/**
 * TDD Test for: ${requirement.id}
 * Description: ${requirement.description}
 *
 * Acceptance Criteria:
${requirement.acceptanceCriteria.map(c => ` * - ${c}`).join('\n')}
 */

test.describe('${requirement.id}', () => {
  test.describe.configure({ mode: 'serial' });

  test('should ${safeDescription}...', async ({ page }) => {
    // Navigate to the page
    await page.goto('${baseUrl}/');

    // TODO: Implement test based on acceptance criteria
${requirement.acceptanceCriteria.map((c, i) => `
    // Criterion ${i + 1}: ${c}
    // await expect(page.locator('...')).toBeVisible();`).join('\n')}

    // Mark as pending until implementation
    test.skip(true, 'Test pending implementation');
  });
});
`;
}

function extractAssertions(testCode: string): string[] {
  const assertions: string[] = [];
  const assertionRegex = /expect\([^)]+\)\.(?:toBe|toEqual|toContain|toHaveText|toBeVisible|toHaveCount|toHaveAttribute|toHaveValue|not\.[a-zA-Z]+)\([^)]*\)/g;

  let match;
  while ((match = assertionRegex.exec(testCode)) !== null) {
    assertions.push(match[0]);
  }

  return assertions;
}

interface ErrorAnalysis {
  rootCause: {
    type: string;
    description: string;
    file?: string;
    line?: number;
  };
  confidence: number;
  fixes: Array<{
    file: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    codeChange?: { search: string; replace: string };
  }>;
  doNotDo: string[];
}

function analyzeTestError(error: string, testPath: string): ErrorAnalysis {
  // Timing issues
  if (error.includes('timeout') || error.includes('Timeout')) {
    return {
      rootCause: {
        type: 'timing',
        description: 'Test timed out waiting for element or network request',
      },
      confidence: 0.8,
      fixes: [
        {
          file: testPath,
          description: 'Replace waitForLoadState("networkidle") with waitForLoadState("domcontentloaded")',
          priority: 'high',
          codeChange: {
            search: 'waitForLoadState("networkidle")',
            replace: 'waitForLoadState("domcontentloaded")',
          },
        },
        {
          file: testPath,
          description: 'Add explicit wait before element interaction',
          priority: 'medium',
        },
      ],
      doNotDo: [
        'Do NOT increase timeout - this masks the real issue',
        'Do NOT add arbitrary sleep/waitForTimeout calls',
        'Do NOT skip the test',
      ],
    };
  }

  // Element not found
  if (error.includes('locator') || error.includes('element not found') || error.includes('strict mode violation')) {
    return {
      rootCause: {
        type: 'selector',
        description: 'Element selector not found or matches multiple elements',
      },
      confidence: 0.7,
      fixes: [
        {
          file: testPath,
          description: 'Use more specific selector (getByRole, getByLabel, getByTestId)',
          priority: 'high',
        },
        {
          file: testPath,
          description: 'Add .first() or .nth() if multiple elements expected',
          priority: 'medium',
        },
      ],
      doNotDo: [
        'Do NOT skip the test',
        'Do NOT use overly generic selectors',
        'Do NOT add retry loops around locators',
      ],
    };
  }

  // Network/connection issues
  if (error.includes('ECONNREFUSED') || error.includes('ERR_CONNECTION')) {
    return {
      rootCause: {
        type: 'infrastructure',
        description: 'Server not running or network issue',
      },
      confidence: 0.9,
      fixes: [
        {
          file: 'devloop.config.js',
          description: 'Verify baseUrl configuration and ensure server is running',
          priority: 'high',
        },
      ],
      doNotDo: [
        'Do NOT disable network checks in tests',
        'Do NOT mock the server response',
      ],
    };
  }

  // Assertion failure
  if (error.includes('expect') || error.includes('AssertionError')) {
    return {
      rootCause: {
        type: 'assertion',
        description: 'Test assertion failed - expected value does not match actual',
      },
      confidence: 0.6,
      fixes: [
        {
          file: 'implementation_file', // Would need to determine from context
          description: 'Fix implementation to match expected behavior',
          priority: 'high',
        },
        {
          file: testPath,
          description: 'Verify assertion matches actual requirement',
          priority: 'medium',
        },
      ],
      doNotDo: [
        'Do NOT change assertion to match incorrect behavior',
        'Do NOT remove the failing assertion',
        'Do NOT add try-catch to swallow errors',
      ],
    };
  }

  // Default
  return {
    rootCause: {
      type: 'unknown',
      description: 'Unknown error - requires manual investigation',
    },
    confidence: 0.3,
    fixes: [
      {
        file: testPath,
        description: 'Review test logic and error message',
        priority: 'medium',
      },
    ],
    doNotDo: [
      'Do NOT skip the test without fixing the issue',
      'Do NOT add retries to mask intermittent failures',
    ],
  };
}

