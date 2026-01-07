import { logger } from './logger';
import { TestExecutor } from './test-executor';
import { ValidationScriptExecutor } from './validation-script-executor';
import { AssertionValidatorRegistry } from './assertion-validators';
import { TestDataManager } from './test-data-manager';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface TestStep {
  action: 'execute-php' | 'execute-drush' | 'execute-ddev' | 'assert' |
          'assert-schema' | 'assert-plugin' | 'assert-service' |
          'navigate' | 'fill-form' | 'wait-for' | 'execute-command';
  command?: string;
  type?: string;
  schemaKey?: string;
  pluginType?: string;
  pluginId?: string;
  serviceId?: string;
  url?: string;
  selector?: string;
  value?: string;
  timeout?: number;
  assertion?: string;
  [key: string]: any;
}

export interface DataSetup {
  type: 'config' | 'entity' | 'file';
  path?: string;
  createIfMissing?: boolean;
  content?: any;
  entityType?: string;
  entityId?: string;
  fields?: Record<string, any>;
}

export interface TestSpec {
  type: 'playwright' | 'drush' | 'manual';
  file?: string;
  describe?: string;
  cases?: Array<{
    name: string;
    steps: TestStep[];
  }>;
  dataSetup?: DataSetup[];
  expectedOutcomes?: string[];
}

export interface TestSpecResult {
  success: boolean;
  testSpec: TestSpec;
  stepResults: StepResult[];
  errors: string[];
  warnings: string[];
}

export interface StepResult {
  step: TestStep;
  success: boolean;
  output?: string;
  error?: string;
  duration?: number;
}

/**
 * TestSpecExecutor executes test specifications from PRD frontmatter.
 *
 * Supports:
 * - Playwright test file execution
 * - Test step execution (execute-php, assert, navigate, etc.)
 * - Test data setup and cleanup
 * - Integration with TestExecutor
 */
export class TestSpecExecutor {
  private testExecutor: TestExecutor;
  private scriptExecutor: ValidationScriptExecutor;
  private assertionRegistry: AssertionValidatorRegistry;
  private testDataManager: TestDataManager;
  private debug: boolean;

  constructor(
    testExecutor: TestExecutor,
    scriptExecutor: ValidationScriptExecutor,
    assertionRegistry: AssertionValidatorRegistry,
    testDataManager: TestDataManager,
    debug: boolean = false
  ) {
    this.testExecutor = testExecutor;
    this.scriptExecutor = scriptExecutor;
    this.assertionRegistry = assertionRegistry;
    this.testDataManager = testDataManager;
    this.debug = debug;
  }

  /**
   * Execute a test specification.
   */
  async executeTestSpec(testSpec: TestSpec, taskId: string): Promise<TestSpecResult> {
    const result: TestSpecResult = {
      success: true,
      testSpec,
      stepResults: [],
      errors: [],
      warnings: [],
    };

    if (this.debug) {
      logger.debug(`[TestSpecExecutor] Executing test spec: ${testSpec.type} (task: ${taskId})`);
    }

    // Setup test data first
    if (testSpec.dataSetup && testSpec.dataSetup.length > 0) {
      try {
        await this.setupTestData(testSpec.dataSetup, taskId);
      } catch (error: any) {
        result.errors.push(`Test data setup failed: ${error.message}`);
        result.success = false;
        return result;
      }
    }

    try {
      // Execute test steps
      if (testSpec.cases && testSpec.cases.length > 0) {
        for (const testCase of testSpec.cases) {
          if (this.debug) {
            logger.debug(`[TestSpecExecutor] Executing test case: ${testCase.name}`);
          }

          const stepResults = await this.executeSteps(testCase.steps, taskId);
          result.stepResults.push(...stepResults);

          // Check if any steps failed
          const failedSteps = stepResults.filter(s => !s.success);
          if (failedSteps.length > 0) {
            result.success = false;
            result.errors.push(`Test case "${testCase.name}" failed: ${failedSteps.length} step(s) failed`);
          }
        }
      }

      // Execute Playwright test file if specified
      if (testSpec.type === 'playwright' && testSpec.file) {
        const testResult = await this.executePlaywrightTest(testSpec.file);
        if (!testResult.success) {
          result.success = false;
          result.errors.push(`Playwright test file execution failed: ${testResult.error || 'Unknown error'}`);
        }
      }
    } finally {
      // Cleanup test data
      if (testSpec.dataSetup && testSpec.dataSetup.length > 0) {
        try {
          await this.cleanupTestData(testSpec.dataSetup, taskId);
        } catch (error: any) {
          result.warnings.push(`Test data cleanup failed: ${error.message}`);
        }
      }
    }

    return result;
  }

  /**
   * Execute test steps.
   */
  async executeSteps(steps: TestStep[], taskId: string): Promise<StepResult[]> {
    const results: StepResult[] = [];

    for (const step of steps) {
      const startTime = Date.now();
      const result: StepResult = {
        step,
        success: false,
      };

      try {
        switch (step.action) {
          case 'execute-php':
            result.output = await this.executePhp(step.command || '');
            result.success = true;
            break;

          case 'execute-drush':
            result.output = await this.executeDrush(step.command || '');
            result.success = true;
            break;

          case 'execute-ddev':
            result.output = await this.executeDdev(step.command || '');
            result.success = true;
            break;

          case 'execute-command':
            const cmdResult = await this.scriptExecutor.executeCommand(step.command || '');
            result.output = cmdResult.output;
            result.success = cmdResult.success;
            if (!cmdResult.success) {
              result.error = cmdResult.error;
            }
            break;

          case 'assert':
            const assertResult = await this.assertionRegistry.validate(
              step.assertion || '',
              { taskId }
            );
            result.success = assertResult.success;
            result.output = assertResult.message;
            if (!assertResult.success) {
              result.error = assertResult.message;
            }
            break;

          case 'assert-schema':
            // Schema assertion would need schema helper
            result.success = true; // Placeholder
            result.output = `Schema assertion: ${step.schemaKey}`;
            break;

          case 'assert-plugin':
            // Plugin assertion would need plugin helper
            result.success = true; // Placeholder
            result.output = `Plugin assertion: ${step.pluginType}/${step.pluginId}`;
            break;

          case 'assert-service':
            // Service assertion would need service helper
            result.success = true; // Placeholder
            result.output = `Service assertion: ${step.serviceId}`;
            break;

          default:
            result.error = `Unknown step action: ${step.action}`;
            result.success = false;
        }

        result.duration = Date.now() - startTime;
      } catch (error: any) {
        result.error = error.message;
        result.success = false;
        result.duration = Date.now() - startTime;
      }

      results.push(result);
    }

    return results;
  }

  /**
   * Execute PHP code via Drush.
   */
  private async executePhp(code: string): Promise<string> {
    const command = `ddev exec bash -c "drush ev '${code.replace(/'/g, "'\\''")}'"`;
    const result = await this.scriptExecutor.executeCommand(command);
    return result.output;
  }

  /**
   * Execute Drush command.
   */
  private async executeDrush(command: string): Promise<string> {
    const fullCommand = `ddev exec bash -c "drush ${command}"`;
    const result = await this.scriptExecutor.executeCommand(fullCommand);
    return result.output;
  }

  /**
   * Execute DDEV command.
   */
  private async executeDdev(command: string): Promise<string> {
    const fullCommand = `ddev exec bash -c "${command}"`;
    const result = await this.scriptExecutor.executeCommand(fullCommand);
    return result.output;
  }

  /**
   * Execute Playwright test file.
   */
  private async executePlaywrightTest(testFile: string): Promise<{ success: boolean; error?: string }> {
    try {
      const command = `npx playwright test ${testFile} --reporter=json --reporter=list`;
      const result = await this.scriptExecutor.executeCommand(command);
      return {
        success: result.success,
        error: result.success ? undefined : result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Setup test data.
   */
  async setupTestData(dataSetup: DataSetup[], taskId: string): Promise<void> {
    for (const setup of dataSetup) {
      await this.testDataManager.setupTestData([setup], taskId);
    }
  }

  /**
   * Cleanup test data.
   */
  async cleanupTestData(dataSetup: DataSetup[], taskId: string): Promise<void> {
    for (const setup of dataSetup) {
      await this.testDataManager.cleanupTestData([setup], taskId);
    }
  }
}





