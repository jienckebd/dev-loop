import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdMetadata } from './prd-config-parser';
import { logger } from './logger';

/**
 * Validation Linker Service
 * 
 * Links validation.requirementTests from PRD frontmatter to Playwright test generation.
 * Provides test assertions and acceptance criteria mapping for requirements.
 */
export class ValidationLinker {
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Extract validation config for a specific requirement ID
   */
  getRequirementValidation(
    requirementId: string,
    metadata: PrdMetadata
  ): ValidationConfig | null {
    if (!metadata.validation?.requirementTests) {
      return null;
    }

    const testConfig = metadata.validation.requirementTests[requirementId];
    if (!testConfig) {
      return null;
    }

    return {
      description: testConfig.description || '',
      acceptance: testConfig.acceptance || [],
      assertions: testConfig.assertions || [],
      testFile: testConfig.testFile,
    };
  }

  /**
   * Generate Playwright test code from validation config
   */
  generateTestCode(
    requirementId: string,
    validation: ValidationConfig,
    baseUrl: string = 'https://sysf.ddev.site'
  ): string {
    const lines: string[] = [];

    // Import statements
    lines.push("import { test, expect } from '@playwright/test';");
    lines.push('');

    // Test description
    lines.push(`test.describe('${requirementId}: ${validation.description}', () => {`);
    lines.push('  test.beforeEach(async ({ page }) => {');
    lines.push(`    await page.goto('${baseUrl}');`);
    lines.push('  });');
    lines.push('');

    // Generate acceptance criteria steps
    if (validation.acceptance && validation.acceptance.length > 0) {
      lines.push("  test('should meet acceptance criteria', async ({ page }) => {");

      for (const step of validation.acceptance) {
        if (step.given) {
          lines.push(`    // Given: ${step.given}`);
          lines.push(...this.generateGivenStep(step.given));
        }
        if (step.when) {
          lines.push(`    // When: ${step.when}`);
          lines.push(...this.generateWhenStep(step.when));
        }
        if (step.then) {
          lines.push(`    // Then: ${step.then}`);
          lines.push(...this.generateThenStep(step.then));
        }
        if (step.and) {
          lines.push(`    // And: ${step.and}`);
          lines.push(...this.generateAndStep(step.and));
        }
        lines.push('');
      }

      // Add assertions
      if (validation.assertions && validation.assertions.length > 0) {
        lines.push('    // Assertions');
        for (const assertion of validation.assertions) {
          lines.push(...this.generateAssertion(assertion));
        }
      }

      lines.push('  });');
    }

    lines.push('});');

    return lines.join('\n');
  }

  /**
   * Generate "Given" step code
   */
  private generateGivenStep(step: string): string[] {
    const lines: string[] = [];

    if (step.toLowerCase().includes('logged in')) {
      lines.push('    // TODO: Add authentication setup');
      lines.push('    // await auth.login();');
    } else if (step.toLowerCase().includes('config exists')) {
      lines.push('    // TODO: Create test config entity');
    } else {
      lines.push(`    // TODO: Implement: ${step}`);
    }

    return lines;
  }

  /**
   * Generate "When" step code
   */
  private generateWhenStep(step: string): string[] {
    const lines: string[] = [];

    if (step.toLowerCase().includes('navigate to')) {
      const urlMatch = step.match(/\/[^\s]+/);
      if (urlMatch) {
        lines.push(`    await page.goto('${urlMatch[0]}');`);
        lines.push("    await page.waitForLoadState('domcontentloaded');");
      }
    } else if (step.toLowerCase().includes('fill')) {
      lines.push('    // TODO: Fill form fields');
    } else if (step.toLowerCase().includes('click')) {
      lines.push('    // TODO: Click element');
    } else {
      lines.push(`    // TODO: Implement: ${step}`);
    }

    return lines;
  }

  /**
   * Generate "Then" step code
   */
  private generateThenStep(step: string): string[] {
    const lines: string[] = [];

    if (step.toLowerCase().includes('see') || step.toLowerCase().includes('visible')) {
      lines.push('    // TODO: Verify element visibility');
      lines.push('    // await expect(page.locator(\'selector\')).toBeVisible();');
    } else if (step.toLowerCase().includes('appears')) {
      lines.push('    // TODO: Verify element appears in list/response');
    } else {
      lines.push(`    // TODO: Verify: ${step}`);
    }

    return lines;
  }

  /**
   * Generate "And" step code
   */
  private generateAndStep(step: string): string[] {
    return this.generateThenStep(step);
  }

  /**
   * Generate assertion code
   */
  private generateAssertion(assertion: any): string[] {
    const lines: string[] = [];

    if (assertion.selector) {
      if (assertion.visible === true) {
        lines.push(`    await expect(page.locator('${assertion.selector}')).toBeVisible();`);
      } else if (assertion.visible === false) {
        lines.push(`    await expect(page.locator('${assertion.selector}')).toBeHidden();`);
      } else if (assertion.count !== undefined) {
        lines.push(`    await expect(page.locator('${assertion.selector}')).toHaveCount(${assertion.count});`);
      } else {
        lines.push(`    await expect(page.locator('${assertion.selector}')).toBeVisible();`);
      }
    } else if (assertion.apiCall) {
      lines.push(`    // API assertion: ${assertion.apiCall.method} ${assertion.apiCall.path}`);
      lines.push(`    // const response = await request.${assertion.apiCall.method.toLowerCase()}('${assertion.apiCall.path}');`);
      if (assertion.expect) {
        if (assertion.expect.status) {
          lines.push(`    // expect(response.status()).toBe(${assertion.expect.status});`);
        }
        if (assertion.expect.bodyContains) {
          lines.push(`    // expect(await response.text()).toContain('${assertion.expect.bodyContains}');`);
        }
      }
    } else if (assertion.formSubmit) {
      lines.push('    // TODO: Submit form and verify status code');
      if (assertion.statusCode) {
        lines.push(`    // expect(response.status()).toBe(${assertion.statusCode});`);
      }
    } else {
      lines.push(`    // TODO: Implement assertion: ${JSON.stringify(assertion)}`);
    }

    return lines;
  }

  /**
   * Get all integration tests from PRD
   */
  getIntegrationTests(metadata: PrdMetadata): IntegrationTest[] {
    if (!metadata.validation?.integrationTests) {
      return [];
    }

    return metadata.validation.integrationTests.map(test => ({
      name: test.name,
      requirements: test.requirements,
      testSuite: test.testSuite,
    }));
  }

  /**
   * Get field validation rules for a specific field
   */
  getFieldValidation(fieldName: string, metadata: PrdMetadata): FieldValidationRule[] {
    if (!metadata.validation?.fieldValidation) {
      return [];
    }

    return metadata.validation.fieldValidation[fieldName] || [];
  }

  /**
   * Get global validation rules
   */
  getGlobalRules(metadata: PrdMetadata): GlobalValidationRule[] {
    if (!metadata.validation?.globalRules) {
      return [];
    }

    return metadata.validation.globalRules.map(rule => ({
      rule: rule.rule,
      description: rule.description,
      test: rule.test,
    }));
  }
}

/**
 * Validation configuration for a requirement
 */
export interface ValidationConfig {
  description: string;
  acceptance?: Array<{
    given?: string;
    when?: string;
    then?: string;
    and?: string;
  }>;
  assertions?: any[];
  testFile?: string;
}

/**
 * Integration test configuration
 */
export interface IntegrationTest {
  name: string;
  requirements: string[];
  testSuite: string;
}

/**
 * Field validation rule
 */
export interface FieldValidationRule {
  constraint: string;
  when?: string;
  message?: string;
  pattern?: string;
}

/**
 * Global validation rule
 */
export interface GlobalValidationRule {
  rule: string;
  description: string;
  test: string;
}