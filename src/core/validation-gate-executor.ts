import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';
import { ValidationScriptExecutor } from './validation-script-executor';
import { AssertionValidatorRegistry } from './assertion-validators';

const execAsync = promisify(exec);

export interface GateTest {
  command: string;
  description?: string;
  expected?: string;
}

export interface GateResult {
  success: boolean;
  phaseId?: number;
  taskId?: string;
  gateName: string;
  testResults: TestResult[];
  assertionResults: AssertionResult[];
  errors: string[];
  warnings: string[];
}

export interface TestResult {
  command: string;
  success: boolean;
  output: string;
  expected?: string;
  actual?: string;
  error?: string;
}

export interface AssertionResult {
  assertion: string;
  success: boolean;
  message: string;
  details?: any;
}

export interface ValidationGate {
  phase?: number;
  task?: string;
  name: string;
  tests?: GateTest[];
  assertions?: string[];
}

export interface PhaseValidation {
  after?: string[];
  tests?: string[];
  assertions?: string[];
}

/**
 * ValidationGateExecutor executes validation gates defined in PRD frontmatter.
 *
 * Supports:
 * - Phase-level validation gates
 * - Task-level validation gates
 * - Test command execution
 * - Assertion validator execution
 */
export class ValidationGateExecutor {
  private scriptExecutor: ValidationScriptExecutor;
  private assertionRegistry: AssertionValidatorRegistry;
  private debug: boolean;

  constructor(
    scriptExecutor: ValidationScriptExecutor,
    assertionRegistry: AssertionValidatorRegistry,
    debug: boolean = false
  ) {
    this.scriptExecutor = scriptExecutor;
    this.assertionRegistry = assertionRegistry;
    this.debug = debug;
  }

  /**
   * Execute a validation gate.
   */
  async executeGate(gate: ValidationGate, phaseId?: number, taskId?: string): Promise<GateResult> {
    const result: GateResult = {
      success: true,
      phaseId,
      taskId,
      gateName: gate.name,
      testResults: [],
      assertionResults: [],
      errors: [],
      warnings: [],
    };

    if (this.debug) {
      logger.debug(`[ValidationGateExecutor] Executing gate: ${gate.name} (phase: ${phaseId}, task: ${taskId})`);
    }

    // Execute tests first
    if (gate.tests && gate.tests.length > 0) {
      const testResults = await this.executeTests(gate.tests);
      result.testResults = testResults;

      // Check if any tests failed
      const failedTests = testResults.filter(t => !t.success);
      if (failedTests.length > 0) {
        result.success = false;
        result.errors.push(`${failedTests.length} test(s) failed`);
      }
    }

    // Execute assertions
    if (gate.assertions && gate.assertions.length > 0) {
      const assertionResults = await this.executeAssertions(gate.assertions, { phaseId, taskId });
      result.assertionResults = assertionResults;

      // Check if any assertions failed
      const failedAssertions = assertionResults.filter(a => !a.success);
      if (failedAssertions.length > 0) {
        result.success = false;
        result.errors.push(`${failedAssertions.length} assertion(s) failed`);
      }
    }

    if (this.debug) {
      logger.debug(`[ValidationGateExecutor] Gate ${gate.name} result: ${result.success ? 'PASS' : 'FAIL'}`);
    }

    return result;
  }

  /**
   * Execute phase-level validation.
   */
  async executePhaseValidation(validation: PhaseValidation, phaseId: number): Promise<GateResult> {
    const result: GateResult = {
      success: true,
      phaseId,
      gateName: `phase-${phaseId}-validation`,
      testResults: [],
      assertionResults: [],
      errors: [],
      warnings: [],
    };

    if (this.debug) {
      logger.debug(`[ValidationGateExecutor] Executing phase ${phaseId} validation`);
    }

    // Execute test commands
    if (validation.tests && validation.tests.length > 0) {
      const tests: GateTest[] = validation.tests.map(cmd => ({
        command: cmd,
        description: `Phase ${phaseId} validation test`,
      }));
      const testResults = await this.executeTests(tests);
      result.testResults = testResults;

      const failedTests = testResults.filter(t => !t.success);
      if (failedTests.length > 0) {
        result.success = false;
        result.errors.push(`${failedTests.length} test(s) failed`);
      }
    }

    // Execute assertions
    if (validation.assertions && validation.assertions.length > 0) {
      const assertionResults = await this.executeAssertions(validation.assertions, { phaseId });
      result.assertionResults = assertionResults;

      const failedAssertions = assertionResults.filter(a => !a.success);
      if (failedAssertions.length > 0) {
        result.success = false;
        result.errors.push(`${failedAssertions.length} assertion(s) failed`);
      }
    }

    return result;
  }

  /**
   * Execute test commands.
   */
  async executeTests(tests: GateTest[]): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const test of tests) {
      if (this.debug) {
        logger.debug(`[ValidationGateExecutor] Executing test: ${test.command.substring(0, 100)}...`);
      }

      try {
        const { stdout, stderr } = await execAsync(test.command, {
          timeout: 300000, // 5 minutes
          cwd: process.cwd(),
        });

        const output = (stdout + stderr).trim();
        const actual = output;
        let success = true;

        // Check expected value if provided
        if (test.expected !== undefined) {
          success = actual === test.expected || actual.includes(test.expected);
        } else {
          // Default: success if exit code is 0 (no exception thrown)
          success = true;
        }

        results.push({
          command: test.command,
          success,
          output: actual,
          expected: test.expected,
          actual,
        });

        if (!success) {
          logger.warn(`[ValidationGateExecutor] Test failed: ${test.description || test.command}`);
          if (this.debug) {
            logger.debug(`[ValidationGateExecutor] Expected: ${test.expected}, Actual: ${actual}`);
          }
        }
      } catch (error: any) {
        const output = error.stdout || error.stderr || error.message || String(error);
        results.push({
          command: test.command,
          success: false,
          output,
          expected: test.expected,
          error: error.message,
        });

        logger.warn(`[ValidationGateExecutor] Test execution failed: ${test.description || test.command}`);
        if (this.debug) {
          logger.debug(`[ValidationGateExecutor] Error: ${error.message}`);
        }
      }
    }

    return results;
  }

  /**
   * Execute assertion validators.
   */
  async executeAssertions(assertions: string[], context: { phaseId?: number; taskId?: string }): Promise<AssertionResult[]> {
    const results: AssertionResult[] = [];

    for (const assertion of assertions) {
      if (this.debug) {
        logger.debug(`[ValidationGateExecutor] Executing assertion: ${assertion}`);
      }

      try {
        const result = await this.assertionRegistry.validate(assertion, context);
        results.push(result);
      } catch (error: any) {
        results.push({
          assertion,
          success: false,
          message: `Assertion execution failed: ${error.message}`,
          details: { error: error.message },
        });

        logger.warn(`[ValidationGateExecutor] Assertion ${assertion} failed: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Execute all gates for a specific phase.
   */
  async executePhaseGates(gates: ValidationGate[], phaseId: number): Promise<GateResult[]> {
    const phaseGates = gates.filter(gate => gate.phase === phaseId);
    const results: GateResult[] = [];

    for (const gate of phaseGates) {
      const result = await this.executeGate(gate, phaseId);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute all gates for a specific task.
   */
  async executeTaskGates(gates: ValidationGate[], taskId: string, phaseId: number): Promise<GateResult[]> {
    const taskGates = gates.filter(gate => gate.task === taskId && gate.phase === phaseId);
    const results: GateResult[] = [];

    for (const gate of taskGates) {
      const result = await this.executeGate(gate, phaseId, taskId);
      results.push(result);
    }

    return results;
  }
}


