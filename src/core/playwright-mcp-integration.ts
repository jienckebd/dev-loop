/**
 * Playwright MCP Integration - TDD workflow with Playwright browser automation
 *
 * Extends TestGenerator to provide:
 * - Write tests first (TDD red phase)
 * - Run tests via Playwright MCP
 * - Verify features with tests (TDD green phase)
 * - Analyze failures for root cause fixing
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { TestGenerator } from './test-generator';
import { AIProvider } from '../providers/ai/interface';
import { Config } from '../config/schema';
import { PrdContext, Requirement, TestState } from './prd-context';

export interface TestSpec {
  id: string;
  requirementId: string;
  testPath: string;
  testCode: string;
  assertions: string[];
  status: 'draft' | 'written' | 'passing' | 'failing';
}

export interface TestResult {
  testId: string;
  passed: boolean;
  duration: number;
  error?: string;
  stdout?: string;
  stderr?: string;
  screenshots?: string[];
  consoleMessages?: string[];
  networkRequests?: string[];
}

export interface VerificationResult {
  passed: boolean;
  testResults: TestResult[];
  coverage?: {
    statements: number;
    branches: number;
    functions: number;
    lines: number;
  };
}

export interface FailureAnalysis {
  testId: string;
  error: string;
  rootCause: RootCause;
  suggestedFixes: SuggestedFix[];
  screenshots?: string[];
}

export interface RootCause {
  type: 'code_bug' | 'test_bug' | 'config_issue' | 'infrastructure' | 'timing' | 'unknown';
  file?: string;
  line?: number;
  description: string;
  confidence: number;
}

export interface SuggestedFix {
  file: string;
  description: string;
  codeChange?: {
    search: string;
    replace: string;
  };
  priority: 'high' | 'medium' | 'low';
}

export interface PlaywrightMCPConfig {
  enabled: boolean;
  server?: string;
  tdd: {
    enabled: boolean;
    writeTestsFirst: boolean;
    runTestsAfterImplementation: boolean;
    fixRootCauses: boolean;
  };
  browser?: {
    headless?: boolean;
    timeout?: number;
    screenshotsDir?: string;
  };
}

const DEFAULT_CONFIG: PlaywrightMCPConfig = {
  enabled: true,
  server: 'playwright',
  tdd: {
    enabled: true,
    writeTestsFirst: true,
    runTestsAfterImplementation: true,
    fixRootCauses: true,
  },
  browser: {
    headless: true,
    timeout: 30000,
    screenshotsDir: '.devloop/screenshots',
  },
};

/**
 * Playwright MCP Integration - Uses TestGenerator with TDD workflow (composition over inheritance)
 */
export class PlaywrightMCPIntegration {
  private playwrightConfig: PlaywrightMCPConfig;
  private mcpClient: MCPClient | null = null;
  private testGenerator: TestGenerator;
  protected aiProvider: AIProvider;
  protected config: Config;
  protected debug: boolean;

  constructor(
    aiProvider: AIProvider,
    config: Config,
    playwrightConfig?: Partial<PlaywrightMCPConfig>,
    debug: boolean = false
  ) {
    this.aiProvider = aiProvider;
    this.config = config;
    this.debug = debug;
    this.testGenerator = new TestGenerator(aiProvider, config, debug);
    this.playwrightConfig = { ...DEFAULT_CONFIG, ...playwrightConfig };
  }

  /**
   * Write test first before implementation (TDD red phase)
   */
  async writeTestFirst(requirement: Requirement): Promise<TestSpec> {
    const testId = `test-${requirement.id}`;
    const testPath = await this.getTestPathForRequirement(requirement);

    // Generate test code via AI
    const testCode = await this.generateTestCode(requirement);

    // Extract assertions from test code
    const assertions = this.extractAssertions(testCode);

    // Write test file
    await this.writeTestFile(testPath, testCode);

    return {
      id: testId,
      requirementId: requirement.id,
      testPath,
      testCode,
      assertions,
      status: 'written',
    };
  }

  /**
   * Run test via Playwright MCP
   */
  async runTestViaMCP(testSpec: TestSpec): Promise<TestResult> {
    const startTime = Date.now();

    try {
      // Initialize MCP client if needed
      if (!this.mcpClient) {
        this.mcpClient = await this.createMCPClient();
      }

      // Run test using Playwright MCP
      const result = await this.executeTestWithMCP(testSpec);

      return {
        testId: testSpec.id,
        passed: result.passed,
        duration: Date.now() - startTime,
        error: result.error,
        stdout: result.stdout,
        stderr: result.stderr,
        screenshots: result.screenshots,
        consoleMessages: result.consoleMessages,
        networkRequests: result.networkRequests,
      };
    } catch (error) {
      return {
        testId: testSpec.id,
        passed: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Verify feature with test (TDD green phase)
   */
  async verifyFeatureWithTest(
    requirement: Requirement,
    testSpec: TestSpec
  ): Promise<VerificationResult> {
    const results: TestResult[] = [];

    // Run the test
    const result = await this.runTestViaMCP(testSpec);
    results.push(result);

    // Update test spec status
    testSpec.status = result.passed ? 'passing' : 'failing';

    return {
      passed: result.passed,
      testResults: results,
    };
  }

  /**
   * Analyze test failure and identify root cause
   */
  async analyzeFailure(testResult: TestResult, testSpec: TestSpec): Promise<FailureAnalysis> {
    if (testResult.passed) {
      throw new Error('Cannot analyze failure for passing test');
    }

    // Get error details from MCP
    const errorDetails = await this.getErrorDetails(testResult);

    // Determine root cause
    const rootCause = await this.determineRootCause(testResult, testSpec, errorDetails);

    // Generate suggested fixes
    const suggestedFixes = await this.generateSuggestedFixes(rootCause, testSpec);

    return {
      testId: testResult.testId,
      error: testResult.error || 'Unknown error',
      rootCause,
      suggestedFixes,
      screenshots: testResult.screenshots,
    };
  }

  /**
   * Fix root cause instead of workaround
   */
  async fixRootCause(analysis: FailureAnalysis): Promise<SuggestedFix[]> {
    const appliedFixes: SuggestedFix[] = [];

    // Sort fixes by priority
    const sortedFixes = [...analysis.suggestedFixes].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    for (const fix of sortedFixes) {
      if (fix.codeChange) {
        try {
          const filePath = path.isAbsolute(fix.file)
            ? fix.file
            : path.join(process.cwd(), fix.file);

          if (await fs.pathExists(filePath)) {
            let content = await fs.readFile(filePath, 'utf-8');

            if (content.includes(fix.codeChange.search)) {
              content = content.replace(fix.codeChange.search, fix.codeChange.replace);
              await fs.writeFile(filePath, content, 'utf-8');
              appliedFixes.push(fix);
            }
          }
        } catch (error) {
          // Log error but continue with other fixes
          if (this.debug) {
            console.warn(`[PlaywrightMCP] Failed to apply fix to ${fix.file}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    return appliedFixes;
  }

  /**
   * Generate tests with TDD workflow
   */
  async generateTests(
    requirements: Requirement[],
    context: PrdContext,
    existingTestPaths?: string[]
  ): Promise<TestState[]> {
    if (!this.playwrightConfig.tdd.enabled) {
      return this.testGenerator.generateTests(requirements, context, existingTestPaths);
    }

    const tests: TestState[] = [];

    for (const req of requirements) {
      // Check if test already exists and is passing
      const existingTest = context.tests.find(t => t.requirementId === req.id);
      if (existingTest?.status === 'passing') {
        tests.push(existingTest);
        continue;
      }

      // TDD workflow: write test first
      if (this.playwrightConfig.tdd.writeTestsFirst) {
        try {
          const testSpec = await this.writeTestFirst(req);

          // Run test (should fail initially - red phase)
          const result = await this.runTestViaMCP(testSpec);

          tests.push({
            id: testSpec.id,
            requirementId: req.id,
            testPath: testSpec.testPath,
            testCode: testSpec.testCode,
            status: result.passed ? 'passing' : 'implemented',
            attempts: existingTest?.attempts || 0,
          });
        } catch (error) {
          // Fall back to standard generation
          const test = await this.testGenerator.generateTests([req], context, existingTestPaths);
          tests.push(...test);
        }
      } else {
        // Standard generation
        const test = await this.testGenerator.generateTests([req], context, existingTestPaths);
        tests.push(...test);
      }
    }

    return tests;
  }

  // Private helper methods

  private async getTestPathForRequirement(req: Requirement): Promise<string> {
    const autonomousConfig = (this.config as any).autonomous || {};
    const testGenConfig = autonomousConfig.testGeneration || {};
    const testDir = testGenConfig.testDir || 'tests/playwright/auto';

    await fs.ensureDir(path.resolve(process.cwd(), testDir));

    const safeId = req.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(testDir, `${safeId}.spec.ts`);
  }

  private async generateTestCode(requirement: Requirement): Promise<string> {
    // Use AI to generate test code
    const prompt = this.buildTDDTestPrompt(requirement);

    const response = await this.aiProvider.generateCode(prompt, {
      task: {
        id: `tdd-test-${requirement.id}`,
        title: `TDD Test for ${requirement.id}`,
        description: `Write Playwright test for: ${requirement.description}`,
        status: 'pending',
        priority: 'high',
      },
      codebaseContext: '',
    });

    return this.cleanTestCode(response.files?.[0]?.content || response.summary || '');
  }

  private buildTDDTestPrompt(requirement: Requirement): string {
    const testGenConfig = (this.config as any).testGeneration || {};
    const baseUrl = testGenConfig.baseUrl || 'https://sysf.ddev.site';

    return `## TDD Test Generation

Generate a Playwright test for the following requirement. The test should:
1. Define clear, testable assertions
2. Use Playwright best practices
3. Be specific enough to validate the implementation
4. Include appropriate waits and error handling

## Requirement
${requirement.description}

## Acceptance Criteria
${requirement.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

## Test Structure
\`\`\`typescript
import { test, expect } from '@playwright/test';

test.describe('${requirement.id}', () => {
  test.describe.configure({ mode: 'serial' });

  test('should ${requirement.description.toLowerCase().slice(0, 50)}...', async ({ page }) => {
    // Navigate to the page
    await page.goto('${baseUrl}/...');

    // Perform actions
    // ...

    // Assert expected state
    // ...
  });
});
\`\`\`

## Output
Generate ONLY the complete test file content. No markdown, no explanations.`;
  }

  private extractAssertions(testCode: string): string[] {
    const assertions: string[] = [];
    const assertionRegex = /expect\([^)]+\)\.(?:toBe|toEqual|toContain|toHaveText|toBeVisible|toHaveCount|toHaveAttribute|toHaveValue|not\.[a-zA-Z]+)\([^)]*\)/g;

    let match;
    while ((match = assertionRegex.exec(testCode)) !== null) {
      assertions.push(match[0]);
    }

    return assertions;
  }

  private cleanTestCode(code: string): string {
    let cleaned = code.trim();

    // Remove markdown code block wrappers
    const codeBlockStart = /^```(?:typescript|ts|javascript|js)?\s*\n?/;
    const codeBlockEnd = /\n?```\s*$/;

    if (codeBlockStart.test(cleaned) && codeBlockEnd.test(cleaned)) {
      cleaned = cleaned.replace(codeBlockStart, '').replace(codeBlockEnd, '');
    }

    return cleaned.trim();
  }

  private async writeTestFile(testPath: string, testCode: string): Promise<void> {
    const fullPath = path.resolve(process.cwd(), testPath);
    await fs.ensureDir(path.dirname(fullPath));

    // Ensure imports are present
    let finalCode = testCode;
    if (!testCode.includes('import') && !testCode.includes('from')) {
      finalCode = `import { test, expect } from '@playwright/test';\n\n${testCode}`;
    }

    await fs.writeFile(fullPath, finalCode, 'utf-8');
  }

  private async createMCPClient(): Promise<MCPClient> {
    // Create a simple MCP client wrapper
    // In practice, this would use the MCP SDK
    return new MCPClient(this.playwrightConfig.server || 'playwright');
  }

  private async executeTestWithMCP(testSpec: TestSpec): Promise<any> {
    // This would execute the test using the Playwright MCP
    // For now, we'll use a local Playwright execution

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const testPath = path.resolve(process.cwd(), testSpec.testPath);
      const { stdout, stderr } = await execAsync(
        `npx playwright test ${testPath} --reporter=json`,
        {
          cwd: process.cwd(),
          timeout: this.playwrightConfig.browser?.timeout || 30000,
        }
      );

      // Parse Playwright JSON output
      try {
        const result = JSON.parse(stdout);
        const passed = result.suites?.[0]?.specs?.[0]?.ok || false;
        return {
          passed,
          stdout,
          stderr,
        };
      } catch {
        // If JSON parsing fails, check for pass/fail indicators
        const passed = stdout.includes('passed') && !stdout.includes('failed');
        return { passed, stdout, stderr };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        passed: false,
        error: errorMessage,
        stdout: (error as any).stdout,
        stderr: (error as any).stderr,
      };
    }
  }

  private async getErrorDetails(testResult: TestResult): Promise<any> {
    // Extract error details from test result
    return {
      error: testResult.error,
      stderr: testResult.stderr,
      screenshots: testResult.screenshots,
      consoleMessages: testResult.consoleMessages,
    };
  }

  private async determineRootCause(
    testResult: TestResult,
    testSpec: TestSpec,
    errorDetails: any
  ): Promise<RootCause> {
    const error = testResult.error || '';

    // Analyze error message patterns
    if (error.includes('timeout') || error.includes('Timeout')) {
      return {
        type: 'timing',
        description: 'Test timed out waiting for element or network request',
        confidence: 0.8,
      };
    }

    if (error.includes('locator') || error.includes('element not found')) {
      return {
        type: 'code_bug',
        description: 'Element selector not found - check if selector is correct or element exists',
        confidence: 0.7,
      };
    }

    if (error.includes('ECONNREFUSED') || error.includes('network')) {
      return {
        type: 'infrastructure',
        description: 'Network connection issue - check if server is running',
        confidence: 0.9,
      };
    }

    if (error.includes('expect') && error.includes('toEqual')) {
      return {
        type: 'code_bug',
        description: 'Assertion failed - implementation may not match expected behavior',
        confidence: 0.6,
      };
    }

    // Default
    return {
      type: 'unknown',
      description: error || 'Unknown error occurred',
      confidence: 0.3,
    };
  }

  private async generateSuggestedFixes(
    rootCause: RootCause,
    testSpec: TestSpec
  ): Promise<SuggestedFix[]> {
    const fixes: SuggestedFix[] = [];

    switch (rootCause.type) {
      case 'timing':
        fixes.push({
          file: testSpec.testPath,
          description: 'Add explicit waits before element interactions',
          priority: 'high',
          codeChange: {
            search: 'await page.click(',
            replace: 'await page.waitForLoadState("domcontentloaded");\n    await page.click(',
          },
        });
        break;

      case 'code_bug':
        fixes.push({
          file: testSpec.testPath,
          description: 'Verify selector matches actual DOM element',
          priority: 'high',
        });
        break;

      case 'infrastructure':
        fixes.push({
          file: 'devloop.config.js',
          description: 'Check server URL configuration and ensure service is running',
          priority: 'high',
        });
        break;

      case 'test_bug':
        fixes.push({
          file: testSpec.testPath,
          description: 'Review test logic and assertions',
          priority: 'medium',
        });
        break;
    }

    return fixes;
  }

}

/**
 * Simple MCP Client wrapper
 */
class MCPClient {
  private serverName: string;

  constructor(serverName: string) {
    this.serverName = serverName;
  }

  async call(tool: string, args: any): Promise<any> {
    // In a real implementation, this would use the MCP SDK
    // to call the Playwright MCP server
    return { success: true, result: null };
  }
}

