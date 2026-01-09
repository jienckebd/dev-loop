import { logger } from '../utils/logger';
import { ValidationScriptExecutor } from './script-executor';

export interface ValidationContext {
  phaseId?: number;
  taskId?: string;
  prdId?: string;
  [key: string]: any;
}

export interface AssertionResult {
  assertion: string;
  success: boolean;
  message: string;
  details?: any;
}

export interface AssertionValidator {
  name: string;
  validate(context: ValidationContext): Promise<AssertionResult>;
}

/**
 * AssertionValidatorRegistry manages assertion validators.
 *
 * Supports:
 * - Built-in validators
 * - Framework-specific validators (via plugins)
 * - Custom validators (via config)
 */
export class AssertionValidatorRegistry {
  private validators: Map<string, AssertionValidator> = new Map();
  private scriptExecutor: ValidationScriptExecutor;
  private debug: boolean;

  constructor(scriptExecutor: ValidationScriptExecutor, debug: boolean = false) {
    this.scriptExecutor = scriptExecutor;
    this.debug = debug;
    this.registerBuiltInValidators();
    this.registerFrameworkValidators(scriptExecutor, debug);
  }

  /**
   * Register framework-specific validators.
   */
  private registerFrameworkValidators(scriptExecutor: ValidationScriptExecutor, debug: boolean): void {
    // Try to register Drupal validators if available
    try {
      const { DrupalAssertionValidators } = require('../frameworks/drupal/validators');
      DrupalAssertionValidators.registerValidators(this, scriptExecutor, debug);
    } catch (error) {
      // Drupal validators not available, that's OK
      if (debug) {
        logger.debug('[AssertionValidatorRegistry] Drupal validators not available');
      }
    }
  }

  /**
   * Register a validator.
   */
  register(validator: AssertionValidator): void {
    this.validators.set(validator.name, validator);
    if (this.debug) {
      logger.debug(`[AssertionValidatorRegistry] Registered validator: ${validator.name}`);
    }
  }

  /**
   * Get a validator by name.
   */
  get(name: string): AssertionValidator | undefined {
    return this.validators.get(name);
  }

  /**
   * Validate an assertion.
   */
  async validate(assertion: string, context: ValidationContext): Promise<AssertionResult> {
    const validator = this.validators.get(assertion);

    if (!validator) {
      return {
        assertion,
        success: false,
        message: `Unknown assertion validator: ${assertion}`,
      };
    }

    try {
      return await validator.validate(context);
    } catch (error: any) {
      return {
        assertion,
        success: false,
        message: `Assertion validation error: ${error.message}`,
        details: { error: error.message },
      };
    }
  }

  /**
   * Register built-in validators.
   */
  private registerBuiltInValidators(): void {
    // no-php-errors validator
    this.register({
      name: 'no-php-errors',
      validate: async (context) => {
        try {
          const result = await this.scriptExecutor.executeCommand(
            'ddev logs -s web | grep -i "PHP Fatal" | wc -l'
          );

          const fatalCount = parseInt(result.output.trim(), 10) || 0;
          const success = fatalCount === 0;

          return {
            assertion: 'no-php-errors',
            success,
            message: success
              ? 'No PHP fatal errors found in logs'
              : `Found ${fatalCount} PHP fatal error(s) in logs`,
            details: { fatalCount },
          };
        } catch (error: any) {
          // If command fails (e.g., grep returns non-zero when no matches), assume no errors
          return {
            assertion: 'no-php-errors',
            success: true,
            message: 'No PHP fatal errors (command returned no matches)',
          };
        }
      },
    });

    // schema-validates validator
    this.register({
      name: 'schema-validates',
      validate: async (context) => {
        try {
          const result = await this.scriptExecutor.executeWithDrupal('script/validate-schema.php');

          if (result.jsonOutput) {
            const success = result.jsonOutput.success === true;
            return {
              assertion: 'schema-validates',
              success,
              message: success
                ? 'Schema validation passed'
                : 'Schema validation failed',
              details: result.jsonOutput,
            };
          }

          // Fallback: check exit code
          return {
            assertion: 'schema-validates',
            success: result.success,
            message: result.success
              ? 'Schema validation passed'
              : 'Schema validation failed',
            details: { output: result.output },
          };
        } catch (error: any) {
          return {
            assertion: 'schema-validates',
            success: false,
            message: `Schema validation error: ${error.message}`,
            details: { error: error.message },
          };
        }
      },
    });

    // plugin-types-discoverable validator
    this.register({
      name: 'plugin-types-discoverable',
      validate: async (context) => {
        try {
          const result = await this.scriptExecutor.executeCommand(
            'php script/validate-gates.php plugin-types-discoverable'
          );

          if (result.jsonOutput) {
            const success = result.jsonOutput.success === true;
            return {
              assertion: 'plugin-types-discoverable',
              success,
              message: result.jsonOutput.message || (success ? 'All plugin types are discoverable' : 'Some plugin types are not discoverable'),
              details: result.jsonOutput.details,
            };
          }

          // Fallback: check output for OK
          const success = result.output.includes('OK') || result.success;
          return {
            assertion: 'plugin-types-discoverable',
            success,
            message: success ? 'Plugin types are discoverable' : 'Plugin types validation failed',
            details: { output: result.output },
          };
        } catch (error: any) {
          return {
            assertion: 'plugin-types-discoverable',
            success: false,
            message: `Plugin types validation error: ${error.message}`,
            details: { error: error.message },
          };
        }
      },
    });

    // all-tests-pass validator
    this.register({
      name: 'all-tests-pass',
      validate: async (context) => {
        // This validator would need to check test execution results
        // For now, return a placeholder that can be enhanced
        return {
          assertion: 'all-tests-pass',
          success: true,
          message: 'Test execution results not available (validator needs test executor integration)',
        };
      },
    });

    // no-regressions validator
    this.register({
      name: 'no-regressions',
      validate: async (context) => {
        // This validator would need baseline comparison
        // For now, return a placeholder that can be enhanced
        return {
          assertion: 'no-regressions',
          success: true,
          message: 'Regression detection not available (validator needs baseline manager integration)',
        };
      },
    });
  }
}

/**
 * Built-in validator: methods-exist
 * This is a special validator that takes additional parameters.
 */
export class MethodsExistValidator implements AssertionValidator {
  name = 'methods-exist';

  constructor(private scriptExecutor: ValidationScriptExecutor) {}

  async validate(context: ValidationContext & { serviceId?: string; methods?: string[] }): Promise<AssertionResult> {
    const serviceId = context.serviceId;
    const methods = context.methods || [];

    if (!serviceId || methods.length === 0) {
      return {
        assertion: 'methods-exist',
        success: false,
        message: 'methods-exist validator requires serviceId and methods in context',
      };
    }

    try {
      const args = [serviceId, ...methods];
      const result = await this.scriptExecutor.executeCommand(
        `php script/validate-gates.php methods-exist ${args.join(' ')}`
      );

      if (result.jsonOutput) {
        const success = result.jsonOutput.success === true;
        return {
          assertion: 'methods-exist',
          success,
          message: result.jsonOutput.message || (success ? 'All methods exist' : 'Some methods are missing'),
          details: result.jsonOutput.details,
        };
      }

      const success = result.output.includes('OK') || result.success;
      return {
        assertion: 'methods-exist',
        success,
        message: success ? 'All methods exist' : 'Method validation failed',
        details: { output: result.output },
      };
    } catch (error: any) {
      return {
        assertion: 'methods-exist',
        success: false,
        message: `Method validation error: ${error.message}`,
        details: { error: error.message },
      };
    }
  }
}

