import { logger } from './logger';
import { ValidationScriptExecutor } from './validation-script-executor';
import { PrdMetadata } from './prd-config-parser';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface CodeRequirements {
  preExisting?: string[];
  willBeCreated?: string[];
  validationScript?: string;
  validateBeforeExecution?: boolean;
}

export interface PrerequisiteResult {
  success: boolean;
  codeRequirements: ValidationResult;
  environment: EnvironmentResult;
  testInfrastructure: TestInfrastructureResult;
  errors: string[];
  warnings: string[];
}

export interface ValidationResult {
  success: boolean;
  passed: string[];
  failed: string[];
  errors: string[];
}

export interface EnvironmentResult {
  success: boolean;
  ddevAvailable: boolean;
  drupalAvailable: boolean;
  cacheClearable: boolean;
  errors: string[];
}

export interface TestInfrastructureResult {
  success: boolean;
  playwrightInstalled: boolean;
  testFilesExist: boolean;
  errors: string[];
}

/**
 * PrerequisiteValidator validates prerequisites before PRD execution.
 *
 * Supports:
 * - Code requirements validation
 * - Environment readiness checks
 * - Test infrastructure validation
 */
export class PrerequisiteValidator {
  private scriptExecutor: ValidationScriptExecutor;
  private debug: boolean;

  constructor(scriptExecutor: ValidationScriptExecutor, debug: boolean = false) {
    this.scriptExecutor = scriptExecutor;
    this.debug = debug;
  }

  /**
   * Validate all prerequisites for a PRD.
   */
  async validatePrerequisites(prd: PrdMetadata): Promise<PrerequisiteResult> {
    const result: PrerequisiteResult = {
      success: true,
      codeRequirements: { success: true, passed: [], failed: [], errors: [] },
      environment: { success: true, ddevAvailable: false, drupalAvailable: false, cacheClearable: false, errors: [] },
      testInfrastructure: { success: true, playwrightInstalled: false, testFilesExist: false, errors: [] },
      errors: [],
      warnings: [],
    };

    if (this.debug) {
      logger.debug('[PrerequisiteValidator] Validating prerequisites');
    }

    // Validate code requirements
    const codeRequirements = (prd.dependencies as any)?.codeRequirements as CodeRequirements | undefined;
    if (codeRequirements) {
      result.codeRequirements = await this.validateCodeRequirements(codeRequirements);
      if (!result.codeRequirements.success) {
        result.success = false;
        result.errors.push('Code requirements validation failed');
      }
    }

    // Validate environment
    result.environment = await this.validateEnvironment();
    if (!result.environment.success) {
      result.success = false;
      result.errors.push('Environment validation failed');
    }

    // Validate test infrastructure
    result.testInfrastructure = await this.validateTestInfrastructure(prd);
    if (!result.testInfrastructure.success) {
      result.success = false;
      result.errors.push('Test infrastructure validation failed');
    }

    // Execute validation script if provided
    if (codeRequirements?.validationScript && codeRequirements.validateBeforeExecution) {
      try {
        const scriptResult = await this.scriptExecutor.executeWithDrupal(
          codeRequirements.validationScript
        );

        if (scriptResult.jsonOutput) {
          const scriptSuccess = scriptResult.jsonOutput.success === true;
          if (!scriptSuccess) {
            result.success = false;
            result.errors.push(`Validation script failed: ${scriptResult.jsonOutput.message || 'Unknown error'}`);
          }
        } else if (!scriptResult.success) {
          result.success = false;
          result.errors.push(`Validation script execution failed: ${scriptResult.error || 'Unknown error'}`);
        }
      } catch (error: any) {
        result.success = false;
        result.errors.push(`Validation script error: ${error.message}`);
      }
    }

    return result;
  }

  /**
   * Validate code requirements.
   */
  async validateCodeRequirements(requirements: CodeRequirements): Promise<ValidationResult> {
    const result: ValidationResult = {
      success: true,
      passed: [],
      failed: [],
      errors: [],
    };

    // Validate pre-existing requirements
    if (requirements.preExisting) {
      for (const requirement of requirements.preExisting) {
        try {
          const exists = await this.checkCodeRequirement(requirement);
          if (exists) {
            result.passed.push(requirement);
          } else {
            result.failed.push(requirement);
            result.success = false;
          }
        } catch (error: any) {
          result.errors.push(`Error checking ${requirement}: ${error.message}`);
          result.success = false;
        }
      }
    }

    return result;
  }

  /**
   * Check if a code requirement exists.
   */
  private async checkCodeRequirement(requirement: string): Promise<boolean> {
    // Parse requirement format: "module exists at path" or "class exists"
    if (requirement.includes('exists at')) {
      const match = requirement.match(/(.+?)\s+exists at\s+(.+)/);
      if (match) {
        const [, name, pathStr] = match;
        const fullPath = path.resolve(process.cwd(), pathStr.trim());
        return await fs.pathExists(fullPath);
      }
    } else if (requirement.includes('class exists')) {
      const match = requirement.match(/(.+?)\s+class exists/);
      if (match) {
        const className = match[1].trim();
        // Check if class file exists (basic check)
        // Full class existence would require PHP reflection
        return true; // Placeholder - would need PHP execution
      }
    } else if (requirement.includes('module exists')) {
      const match = requirement.match(/(.+?)\s+module exists/);
      if (match) {
        const moduleName = match[1].trim();
        // Check if module directory exists
        const modulePath = path.resolve(process.cwd(), `docroot/modules/share/${moduleName}`);
        return await fs.pathExists(modulePath);
      }
    }

    // Default: check if path exists
    const fullPath = path.resolve(process.cwd(), requirement);
    return await fs.pathExists(fullPath);
  }

  /**
   * Validate environment readiness.
   */
  async validateEnvironment(): Promise<EnvironmentResult> {
    const result: EnvironmentResult = {
      success: true,
      ddevAvailable: false,
      drupalAvailable: false,
      cacheClearable: false,
      errors: [],
    };

    // Check DDEV availability
    try {
      const ddevResult = await this.scriptExecutor.executeCommand('ddev version');
      result.ddevAvailable = ddevResult.success;
      if (!ddevResult.success) {
        result.success = false;
        result.errors.push('DDEV is not available');
      }
    } catch {
      result.success = false;
      result.errors.push('DDEV is not available');
    }

    // Check Drupal availability
    try {
      const drushResult = await this.scriptExecutor.executeCommand('ddev exec bash -c "drush status"');
      result.drupalAvailable = drushResult.success;
      if (!drushResult.success) {
        result.success = false;
        result.errors.push('Drupal is not available');
      }
    } catch {
      result.success = false;
      result.errors.push('Drupal is not available');
    }

    // Check cache clearable
    try {
      const cacheResult = await this.scriptExecutor.executeCommand('ddev exec bash -c "drush cr"');
      result.cacheClearable = cacheResult.success;
      if (!cacheResult.success) {
        result.success = false;
        result.errors.push('Cache cannot be cleared');
      }
    } catch {
      result.success = false;
      result.errors.push('Cache cannot be cleared');
    }

    return result;
  }

  /**
   * Validate test infrastructure.
   */
  async validateTestInfrastructure(prd: PrdMetadata): Promise<TestInfrastructureResult> {
    const result: TestInfrastructureResult = {
      success: true,
      playwrightInstalled: false,
      testFilesExist: false,
      errors: [],
    };

    // Check Playwright installation
    try {
      const playwrightResult = await this.scriptExecutor.executeCommand('npx playwright --version');
      result.playwrightInstalled = playwrightResult.success;
      if (!playwrightResult.success) {
        result.success = false;
        result.errors.push('Playwright is not installed');
      }
    } catch {
      result.success = false;
      result.errors.push('Playwright is not installed');
    }

    // Check test files exist
    const testDir = prd.testing?.directory || 'tests/playwright';
    const testDirPath = path.resolve(process.cwd(), testDir);
    result.testFilesExist = await fs.pathExists(testDirPath);
    if (!result.testFilesExist) {
      result.success = false;
      result.errors.push(`Test directory does not exist: ${testDir}`);
    }

    return result;
  }
}

