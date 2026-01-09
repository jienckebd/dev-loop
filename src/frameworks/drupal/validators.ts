import { AssertionValidatorRegistry, AssertionValidator, ValidationContext, AssertionResult } from '../../core/validation/assertion-validators';
import { ValidationScriptExecutor } from '../../core/validation/script-executor';
import { logger } from "../../core/utils/logger";

/**
 * Drupal-specific assertion validators.
 *
 * Registers Drupal-specific validators with the assertion validator registry.
 */
export class DrupalAssertionValidators {
  /**
   * Register all Drupal-specific validators.
   */
  static registerValidators(registry: AssertionValidatorRegistry, scriptExecutor: ValidationScriptExecutor, debug: boolean = false): void {
    // Service exists validator
    registry.register({
      name: 'service-exists',
      validate: async (context: ValidationContext & { serviceId?: string }) => {
        const serviceId = context.serviceId;
        if (!serviceId) {
          return {
            assertion: 'service-exists',
            success: false,
            message: 'service-exists validator requires serviceId in context',
          };
        }

        try {
          const result = await scriptExecutor.executeCommand(
            `ddev exec bash -c "drush ev 'echo \\Drupal::service(\\\"${serviceId}\\\") ? \"OK\" : \"FAIL\";'"`
          );

          const success = result.output.includes('OK') || result.success;
          return {
            assertion: 'service-exists',
            success,
            message: success
              ? `Service "${serviceId}" exists`
              : `Service "${serviceId}" not found`,
            details: { serviceId, output: result.output },
          };
        } catch (error: any) {
          return {
            assertion: 'service-exists',
            success: false,
            message: `Service validation error: ${error.message}`,
            details: { error: error.message },
          };
        }
      },
    });

    // Cache clearable validator
    registry.register({
      name: 'cache-clearable',
      validate: async (context: ValidationContext) => {
        try {
          const result = await scriptExecutor.executeCommand('ddev exec bash -c "drush cr"');
          return {
            assertion: 'cache-clearable',
            success: result.success,
            message: result.success
              ? 'Cache can be cleared successfully'
              : 'Cache clear failed',
            details: { output: result.output },
          };
        } catch (error: any) {
          return {
            assertion: 'cache-clearable',
            success: false,
            message: `Cache clear error: ${error.message}`,
            details: { error: error.message },
          };
        }
      },
    });

    // Entity type exists validator
    registry.register({
      name: 'entity-type-exists',
      validate: async (context: ValidationContext & { entityType?: string }) => {
        const entityType = context.entityType;
        if (!entityType) {
          return {
            assertion: 'entity-type-exists',
            success: false,
            message: 'entity-type-exists validator requires entityType in context',
          };
        }

        try {
          const result = await scriptExecutor.executeCommand(
            `ddev exec bash -c "drush ev 'echo \\Drupal::entityTypeManager()->getDefinition(\\\"${entityType}\\\") ? \"OK\" : \"FAIL\";'"`
          );

          const success = result.output.includes('OK') || result.success;
          return {
            assertion: 'entity-type-exists',
            success,
            message: success
              ? `Entity type "${entityType}" exists`
              : `Entity type "${entityType}" not found`,
            details: { entityType, output: result.output },
          };
        } catch (error: any) {
          return {
            assertion: 'entity-type-exists',
            success: false,
            message: `Entity type validation error: ${error.message}`,
            details: { error: error.message },
          };
        }
      },
    });

    // Config entity exists validator
    registry.register({
      name: 'config-entity-exists',
      validate: async (context: ValidationContext & { entityType?: string; entityId?: string }) => {
        const entityType = context.entityType;
        const entityId = context.entityId;
        if (!entityType || !entityId) {
          return {
            assertion: 'config-entity-exists',
            success: false,
            message: 'config-entity-exists validator requires entityType and entityId in context',
          };
        }

        try {
          const result = await scriptExecutor.executeCommand(
            `ddev exec bash -c "drush ev 'echo \\Drupal::entityTypeManager()->getStorage(\\\"${entityType}\\\")->load(\\\"${entityId}\\\") ? \"OK\" : \"FAIL\";'"`
          );

          const success = result.output.includes('OK') || result.success;
          return {
            assertion: 'config-entity-exists',
            success,
            message: success
              ? `Config entity "${entityType}.${entityId}" exists`
              : `Config entity "${entityType}.${entityId}" not found`,
            details: { entityType, entityId, output: result.output },
          };
        } catch (error: any) {
          return {
            assertion: 'config-entity-exists',
            success: false,
            message: `Config entity validation error: ${error.message}`,
            details: { error: error.message },
          };
        }
      },
    });

    if (debug) {
      logger.debug('[DrupalAssertionValidators] Registered Drupal-specific validators');
    }
  }
}






