/**
 * Migration Utility
 *
 * Upgrades JSON learning files from v1.0 to v2.0.
 * Wraps SchemaValidator migration functionality.
 */

import * as path from 'path';
import { SchemaValidator } from './schema-validator';
import { logger } from '../../utils/logger';

/**
 * Migration Options
 */
export interface MigrationOptions {
  patternsPath?: string;
  observationsPath?: string;
  testResultsPath?: string;
  prdSetStatePath?: string;
  backup?: boolean; // Create backup before migration (default: true)
  dryRun?: boolean; // Show what would be migrated without doing it (default: false)
  debug?: boolean;
}

/**
 * Migration Result
 */
export interface MigrationResult {
  migrated: string[]; // Files that were migrated
  skipped: string[]; // Files that were skipped (already v2.0 or don't exist)
  errors: string[]; // Files that failed to migrate
  backups: string[]; // Backup files created
}

/**
 * Migrate JSON learning files from v1.0 to v2.0
 */
export async function migrateLearningFiles(
  projectRoot: string,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const {
    patternsPath = path.join(projectRoot, '.devloop/patterns.json'),
    observationsPath = path.join(projectRoot, '.devloop/observations.json'),
    testResultsPath = path.join(projectRoot, '.devloop/test-results.json/test-results.json'),
    prdSetStatePath = path.join(projectRoot, '.devloop/prd-set-state.json'),
    backup = true,
    dryRun = false,
    debug = false,
  } = options;

  logger.debug(`[Migration] Starting migration of learning files (dryRun: ${dryRun})`);

  const result: MigrationResult = {
    migrated: [],
    skipped: [],
    errors: [],
    backups: [],
  };

  const validator = new SchemaValidator({
    autoFix: !dryRun,
    autoMigrate: !dryRun,
    backup,
    debug,
  });

  // Migrate patterns.json
  try {
    const validationResult = await validator.validatePatternsFile(patternsPath);
    if (validationResult.migrated) {
      result.migrated.push(patternsPath);
      logger.info(`[Migration] Migrated patterns.json to v2.0`);
    } else if (validationResult.warnings.length > 0 && validationResult.warnings[0].includes('old schema')) {
      if (dryRun) {
        result.migrated.push(patternsPath + ' (would migrate)');
      } else {
        result.errors.push(`patterns.json: ${validationResult.warnings.join('; ')}`);
      }
    } else {
      result.skipped.push(patternsPath);
    }
  } catch (error) {
    result.errors.push(`patterns.json: ${error}`);
    logger.error(`[Migration] Failed to migrate patterns.json: ${error}`);
  }

  // Migrate observations.json
  try {
    const validationResult = await validator.validateObservationsFile(observationsPath);
    if (validationResult.migrated) {
      result.migrated.push(observationsPath);
      logger.info(`[Migration] Migrated observations.json to v2.0`);
    } else if (validationResult.warnings.length > 0 && validationResult.warnings[0].includes('old schema')) {
      if (dryRun) {
        result.migrated.push(observationsPath + ' (would migrate)');
      } else {
        result.errors.push(`observations.json: ${validationResult.warnings.join('; ')}`);
      }
    } else {
      result.skipped.push(observationsPath);
    }
  } catch (error) {
    result.errors.push(`observations.json: ${error}`);
    logger.error(`[Migration] Failed to migrate observations.json: ${error}`);
  }

  // Validate test-results.json (may not need migration, but ensure schema is valid)
  try {
    const validationResult = await validator.validateTestResultsFile(testResultsPath);
    if (validationResult.fixed) {
      result.migrated.push(testResultsPath);
      logger.info(`[Migration] Fixed test-results.json schema`);
    } else {
      result.skipped.push(testResultsPath);
    }
  } catch (error) {
    result.errors.push(`test-results.json: ${error}`);
    logger.error(`[Migration] Failed to validate test-results.json: ${error}`);
  }

  // Validate prd-set-state.json (ensure it has proper schema)
  try {
    const validationResult = await validator.validatePrdSetStateFile(prdSetStatePath);
    if (validationResult.fixed) {
      result.migrated.push(prdSetStatePath);
      logger.info(`[Migration] Fixed prd-set-state.json schema`);
    } else {
      result.skipped.push(prdSetStatePath);
    }
  } catch (error) {
    result.errors.push(`prd-set-state.json: ${error}`);
    logger.error(`[Migration] Failed to validate prd-set-state.json: ${error}`);
  }

  logger.debug(`[Migration] Migration complete: ${result.migrated.length} migrated, ${result.skipped.length} skipped, ${result.errors.length} errors`);

  return result;
}
