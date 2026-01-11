/**
 * Schema Validator
 *
 * Validates and auto-fixes JSON learning files to ensure they conform to expected schemas.
 * Runs validation when loaders initialize to ensure data integrity.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../utils/logger';
import {
  PatternsFile,
  PatternEntry,
  ObservationsFile,
  ObservationEntry,
  TestResultsFile,
  TestResultExecution,
  PrdSetStateFile,
  PrdStateEntry,
} from './types';

/**
 * Schema Validation Result
 */
export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fixed: boolean; // Whether auto-fixes were applied
  migrated: boolean; // Whether schema migration was performed
}

/**
 * Schema Validator Configuration
 */
export interface SchemaValidatorConfig {
  autoFix?: boolean; // Auto-fix common schema issues (default: true)
  autoMigrate?: boolean; // Auto-migrate from v1.0 to v2.0 (default: true)
  backup?: boolean; // Create backup before migration/fixing (default: true)
  debug?: boolean;
}

/**
 * Validates and auto-fixes JSON learning file schemas
 */
export class SchemaValidator {
  private config: Required<SchemaValidatorConfig>;
  private debug: boolean;

  constructor(config: SchemaValidatorConfig = {}) {
    this.config = {
      autoFix: config.autoFix !== false,
      autoMigrate: config.autoMigrate !== false,
      backup: config.backup !== false,
      debug: config.debug || false,
    };
    this.debug = this.config.debug;
  }

  /**
   * Validate patterns.json file
   */
  async validatePatternsFile(filePath: string): Promise<SchemaValidationResult> {
    logger.debug(`[SchemaValidator] Validating patterns file: ${filePath}`);

    const errors: string[] = [];
    const warnings: string[] = [];
    let fixed = false;
    let migrated = false;

    try {
      if (!(await fs.pathExists(filePath))) {
        // File doesn't exist - create empty v2.0 file
        if (this.config.autoFix) {
          const emptyFile: PatternsFile = {
            version: '2.0',
            updatedAt: new Date().toISOString(),
            patterns: [],
          };
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeJson(filePath, emptyFile, { spaces: 2 });
          fixed = true;
          logger.debug(`[SchemaValidator] Created empty patterns.json with v2.0 schema`);
        }
        return { valid: true, errors, warnings, fixed, migrated };
      }

      const data = await fs.readJson(filePath);
      
      // Check version
      if (!data.version || data.version === '1.0') {
        warnings.push(`Patterns file has old schema version (${data.version || 'unknown'}). Migration needed.`);
        if (this.config.autoMigrate) {
          await this.migratePatternsFile(filePath, data);
          migrated = true;
          // Re-read after migration
          return await this.validatePatternsFile(filePath);
        }
      }

      // Validate v2.0 schema
      if (!data.version || data.version !== '2.0') {
        errors.push(`Invalid version: expected "2.0", got "${data.version || 'missing'}"`);
      }

      if (!data.updatedAt) {
        if (this.config.autoFix) {
          data.updatedAt = new Date().toISOString();
          fixed = true;
        } else {
          errors.push('Missing required field: updatedAt');
        }
      }

      if (!Array.isArray(data.patterns)) {
        errors.push('Invalid patterns field: expected array');
        return { valid: false, errors, warnings, fixed, migrated };
      }

      // Validate each pattern entry
      for (let i = 0; i < data.patterns.length; i++) {
        const pattern = data.patterns[i];
        const patternErrors = this.validatePatternEntry(pattern, i);
        
        if (patternErrors.length > 0) {
          if (this.config.autoFix) {
            // Auto-fix pattern entry
            const fixedPattern = this.fixPatternEntry(pattern);
            data.patterns[i] = fixedPattern;
            fixed = true;
            warnings.push(`Auto-fixed pattern entry at index ${i}`);
          } else {
            errors.push(...patternErrors.map(e => `Pattern ${i}: ${e}`));
          }
        }
      }

      // Write fixed file if fixes were applied
      if (fixed || migrated) {
        await this.backupIfEnabled(filePath);
        await fs.writeJson(filePath, data, { spaces: 2 });
        logger.debug(`[SchemaValidator] Fixed and saved patterns file`);
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        fixed,
        migrated,
      };
    } catch (error) {
      errors.push(`Failed to validate patterns file: ${error}`);
      return { valid: false, errors, warnings, fixed, migrated };
    }
  }

  /**
   * Validate observations.json file
   */
  async validateObservationsFile(filePath: string): Promise<SchemaValidationResult> {
    logger.debug(`[SchemaValidator] Validating observations file: ${filePath}`);

    const errors: string[] = [];
    const warnings: string[] = [];
    let fixed = false;
    let migrated = false;

    try {
      if (!(await fs.pathExists(filePath))) {
        // File doesn't exist - create empty v2.0 file
        if (this.config.autoFix) {
          const emptyFile: ObservationsFile = {
            version: '2.0',
            updatedAt: new Date().toISOString(),
            observations: [],
          };
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeJson(filePath, emptyFile, { spaces: 2 });
          fixed = true;
          logger.debug(`[SchemaValidator] Created empty observations.json with v2.0 schema`);
        }
        return { valid: true, errors, warnings, fixed, migrated };
      }

      const data = await fs.readJson(filePath);
      
      // Check version
      if (!data.version || data.version === '1.0') {
        warnings.push(`Observations file has old schema version (${data.version || 'unknown'}). Migration needed.`);
        if (this.config.autoMigrate) {
          await this.migrateObservationsFile(filePath, data);
          migrated = true;
          // Re-read after migration
          return await this.validateObservationsFile(filePath);
        }
      }

      // Validate v2.0 schema
      if (!data.version || data.version !== '2.0') {
        errors.push(`Invalid version: expected "2.0", got "${data.version || 'missing'}"`);
      }

      if (!data.updatedAt) {
        if (this.config.autoFix) {
          data.updatedAt = new Date().toISOString();
          fixed = true;
        } else {
          errors.push('Missing required field: updatedAt');
        }
      }

      if (!Array.isArray(data.observations)) {
        errors.push('Invalid observations field: expected array');
        return { valid: false, errors, warnings, fixed, migrated };
      }

      // Validate each observation entry
      for (let i = 0; i < data.observations.length; i++) {
        const observation = data.observations[i];
        const observationErrors = this.validateObservationEntry(observation, i);
        
        if (observationErrors.length > 0) {
          if (this.config.autoFix) {
            // Auto-fix observation entry
            const fixedObservation = this.fixObservationEntry(observation);
            data.observations[i] = fixedObservation;
            fixed = true;
            warnings.push(`Auto-fixed observation entry at index ${i}`);
          } else {
            errors.push(...observationErrors.map(e => `Observation ${i}: ${e}`));
          }
        }
      }

      // Write fixed file if fixes were applied
      if (fixed || migrated) {
        await this.backupIfEnabled(filePath);
        await fs.writeJson(filePath, data, { spaces: 2 });
        logger.debug(`[SchemaValidator] Fixed and saved observations file`);
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        fixed,
        migrated,
      };
    } catch (error) {
      errors.push(`Failed to validate observations file: ${error}`);
      return { valid: false, errors, warnings, fixed, migrated };
    }
  }

  /**
   * Validate test-results.json file
   */
  async validateTestResultsFile(filePath: string): Promise<SchemaValidationResult> {
    logger.debug(`[SchemaValidator] Validating test results file: ${filePath}`);

    const errors: string[] = [];
    const warnings: string[] = [];
    let fixed = false;
    let migrated = false;

    try {
      if (!(await fs.pathExists(filePath))) {
        // File doesn't exist - create empty file
        if (this.config.autoFix) {
          const emptyFile: TestResultsFile = {
            version: '2.0',
            executions: [],
          };
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeJson(filePath, emptyFile, { spaces: 2 });
          fixed = true;
          logger.debug(`[SchemaValidator] Created empty test-results.json`);
        }
        return { valid: true, errors, warnings, fixed, migrated };
      }

      const data = await fs.readJson(filePath);
      
      // Check version (test-results might be v1.0 or v2.0)
      if (!data.version) {
        warnings.push('Test results file missing version field. Assuming v2.0.');
        if (this.config.autoFix) {
          data.version = '2.0';
          fixed = true;
        }
      }

      if (!Array.isArray(data.executions)) {
        errors.push('Invalid executions field: expected array');
        return { valid: false, errors, warnings, fixed, migrated };
      }

      // Validate each execution entry
      for (let i = 0; i < data.executions.length; i++) {
        const execution = data.executions[i];
        const executionErrors = this.validateTestResultExecution(execution, i);
        
        if (executionErrors.length > 0) {
          if (this.config.autoFix) {
            // Auto-fix execution entry
            const fixedExecution = this.fixTestResultExecution(execution);
            data.executions[i] = fixedExecution;
            fixed = true;
            warnings.push(`Auto-fixed test result execution at index ${i}`);
          } else {
            errors.push(...executionErrors.map(e => `Execution ${i}: ${e}`));
          }
        }
      }

      // Write fixed file if fixes were applied
      if (fixed || migrated) {
        await this.backupIfEnabled(filePath);
        await fs.writeJson(filePath, data, { spaces: 2 });
        logger.debug(`[SchemaValidator] Fixed and saved test results file`);
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        fixed,
        migrated,
      };
    } catch (error) {
      errors.push(`Failed to validate test results file: ${error}`);
      return { valid: false, errors, warnings, fixed, migrated };
    }
  }

  /**
   * Validate prd-set-state.json file
   */
  async validatePrdSetStateFile(filePath: string): Promise<SchemaValidationResult> {
    logger.debug(`[SchemaValidator] Validating PRD set state file: ${filePath}`);

    const errors: string[] = [];
    const warnings: string[] = [];
    let fixed = false;
    let migrated = false;

    try {
      if (!(await fs.pathExists(filePath))) {
        // File doesn't exist - create empty file
        if (this.config.autoFix) {
          const emptyFile: PrdSetStateFile = {
            prdStates: {},
            sharedState: {},
          };
          await fs.ensureDir(path.dirname(filePath));
          await fs.writeJson(filePath, emptyFile, { spaces: 2 });
          fixed = true;
          logger.debug(`[SchemaValidator] Created empty prd-set-state.json`);
        }
        return { valid: true, errors, warnings, fixed, migrated };
      }

      const data = await fs.readJson(filePath);
      
      if (!data.prdStates || typeof data.prdStates !== 'object') {
        errors.push('Invalid prdStates field: expected object');
        return { valid: false, errors, warnings, fixed, migrated };
      }

      if (!data.sharedState || typeof data.sharedState !== 'object') {
        if (this.config.autoFix) {
          data.sharedState = {};
          fixed = true;
        } else {
          warnings.push('Missing sharedState field: expected object');
        }
      }

      // Validate each PRD state entry
      for (const [prdId, state] of Object.entries(data.prdStates)) {
        const stateErrors = this.validatePrdStateEntry(state as any, prdId);
        
        if (stateErrors.length > 0) {
          if (this.config.autoFix) {
            // Auto-fix PRD state entry
            const fixedState = this.fixPrdStateEntry(state as any, prdId);
            data.prdStates[prdId] = fixedState;
            fixed = true;
            warnings.push(`Auto-fixed PRD state entry for ${prdId}`);
          } else {
            errors.push(...stateErrors.map(e => `PRD ${prdId}: ${e}`));
          }
        }
      }

      // Write fixed file if fixes were applied
      if (fixed || migrated) {
        await this.backupIfEnabled(filePath);
        await fs.writeJson(filePath, data, { spaces: 2 });
        logger.debug(`[SchemaValidator] Fixed and saved PRD set state file`);
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        fixed,
        migrated,
      };
    } catch (error) {
      errors.push(`Failed to validate PRD set state file: ${error}`);
      return { valid: false, errors, warnings, fixed, migrated };
    }
  }

  /**
   * Validate a single pattern entry
   */
  private validatePatternEntry(pattern: any, index: number): string[] {
    const errors: string[] = [];

    if (!pattern.id) {
      errors.push('Missing required field: id');
    }

    if (!pattern.createdAt) {
      errors.push('Missing required field: createdAt');
    }

    if (!pattern.lastUsedAt) {
      errors.push('Missing required field: lastUsedAt');
    }

    if (typeof pattern.relevanceScore !== 'number' || pattern.relevanceScore < 0 || pattern.relevanceScore > 1) {
      errors.push('Invalid relevanceScore: must be number between 0 and 1');
    }

    if (!pattern.category) {
      errors.push('Missing required field: category');
    }

    if (!pattern.pattern) {
      errors.push('Missing required field: pattern');
    }

    return errors;
  }

  /**
   * Auto-fix a pattern entry (add missing required fields with defaults)
   */
  private fixPatternEntry(pattern: any): PatternEntry {
    const now = new Date().toISOString();
    
    return {
      id: pattern.id || `pattern-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: pattern.createdAt || now,
      lastUsedAt: pattern.lastUsedAt || now,
      relevanceScore: typeof pattern.relevanceScore === 'number' && pattern.relevanceScore >= 0 && pattern.relevanceScore <= 1
        ? pattern.relevanceScore
        : 1.0,
      expiresAt: pattern.expiresAt || null,
      prdId: pattern.prdId,
      framework: pattern.framework,
      category: pattern.category || 'general',
      pattern: pattern.pattern || pattern.text || '',
      examples: pattern.examples || [],
      metadata: pattern.metadata || {},
    };
  }

  /**
   * Validate a single observation entry
   */
  private validateObservationEntry(observation: any, index: number): string[] {
    const errors: string[] = [];

    if (!observation.id) {
      errors.push('Missing required field: id');
    }

    if (!observation.createdAt) {
      errors.push('Missing required field: createdAt');
    }

    if (typeof observation.relevanceScore !== 'number' || observation.relevanceScore < 0 || observation.relevanceScore > 1) {
      errors.push('Invalid relevanceScore: must be number between 0 and 1');
    }

    if (!observation.prdId) {
      errors.push('Missing required field: prdId');
    }

    if (!observation.category) {
      errors.push('Missing required field: category');
    }

    if (!observation.observation) {
      errors.push('Missing required field: observation');
    }

    return errors;
  }

  /**
   * Auto-fix an observation entry (add missing required fields with defaults)
   */
  private fixObservationEntry(observation: any): ObservationEntry {
    const now = new Date().toISOString();
    
    return {
      id: observation.id || `observation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: observation.createdAt || now,
      relevanceScore: typeof observation.relevanceScore === 'number' && observation.relevanceScore >= 0 && observation.relevanceScore <= 1
        ? observation.relevanceScore
        : 1.0,
      expiresAt: observation.expiresAt || null,
      prdId: observation.prdId || 'unknown',
      phaseId: observation.phaseId,
      category: observation.category || 'general',
      observation: observation.observation || observation.text || '',
      context: observation.context || {},
      metadata: observation.metadata || {},
    };
  }

  /**
   * Validate a single test result execution
   */
  private validateTestResultExecution(execution: any, index: number): string[] {
    const errors: string[] = [];

    if (!execution.executionId) {
      errors.push('Missing required field: executionId');
    }

    if (!execution.prdId) {
      errors.push('Missing required field: prdId');
    }

    if (typeof execution.phaseId !== 'number') {
      errors.push('Missing or invalid required field: phaseId (must be number)');
    }

    if (!execution.timestamp) {
      errors.push('Missing required field: timestamp');
    }

    return errors;
  }

  /**
   * Auto-fix a test result execution (add missing required fields)
   */
  private fixTestResultExecution(execution: any): TestResultExecution {
    const now = new Date().toISOString();
    
    // Derive status from results if not present
    let status: 'passing' | 'failing' | 'flaky' | undefined = execution.status;
    if (!status) {
      if (execution.flaky) {
        status = 'flaky';
      } else if (execution.failing === 0 && execution.passing > 0) {
        status = 'passing';
      } else if (execution.failing > 0) {
        status = 'failing';
      }
    }

    return {
      executionId: execution.executionId || `execution-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      prdId: execution.prdId || 'unknown',
      phaseId: typeof execution.phaseId === 'number' ? execution.phaseId : 0,
      timestamp: execution.timestamp || now,
      total: execution.total || 0,
      passing: execution.passing || 0,
      failing: execution.failing || 0,
      skipped: execution.skipped || 0,
      duration: execution.duration || 0,
      tests: execution.tests || [],
      flaky: execution.flaky || false,
      status,
      framework: execution.framework,
      testFramework: execution.testFramework,
    };
  }

  /**
   * Validate a single PRD state entry
   */
  private validatePrdStateEntry(state: any, prdId: string): string[] {
    const errors: string[] = [];

    if (!state.prdId || state.prdId !== prdId) {
      errors.push(`PRD ID mismatch: expected "${prdId}", got "${state.prdId || 'missing'}"`);
    }

    if (!state.status || !['pending', 'running', 'done', 'cancelled', 'failed'].includes(state.status)) {
      errors.push(`Invalid or missing status: expected one of [pending, running, done, cancelled, failed], got "${state.status || 'missing'}"`);
    }

    if (!Array.isArray(state.completedPhases)) {
      errors.push('Invalid completedPhases: expected array');
    }

    if (!state.createdAt) {
      errors.push('Missing required field: createdAt');
    }

    if (!state.updatedAt) {
      errors.push('Missing required field: updatedAt');
    }

    return errors;
  }

  /**
   * Auto-fix a PRD state entry (add missing required fields)
   */
  private fixPrdStateEntry(state: any, prdId: string): PrdStateEntry {
    const now = new Date().toISOString();
    
    return {
      prdId: state.prdId || prdId,
      status: state.status || 'pending',
      completedPhases: Array.isArray(state.completedPhases) ? state.completedPhases : [],
      createdAt: state.createdAt || now,
      updatedAt: state.updatedAt || now,
      cancelledAt: state.cancelledAt,
      completedAt: state.completedAt,
      lastPhaseId: state.lastPhaseId,
    };
  }

  /**
   * Migrate patterns.json from v1.0 to v2.0
   */
  private async migratePatternsFile(filePath: string, data: any): Promise<void> {
    logger.debug(`[SchemaValidator] Migrating patterns.json from v1.0 to v2.0`);
    
    await this.backupIfEnabled(filePath);

    const now = new Date().toISOString();
    const migratedFile: PatternsFile = {
      version: '2.0',
      updatedAt: now,
      patterns: (data.patterns || []).map((pattern: any, index: number) => ({
        id: pattern.id || `pattern-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: pattern.createdAt || now,
        lastUsedAt: pattern.lastUsedAt || now,
        relevanceScore: typeof pattern.relevanceScore === 'number' ? pattern.relevanceScore : 1.0,
        expiresAt: pattern.expiresAt || null,
        prdId: pattern.prdId,
        framework: pattern.framework,
        category: pattern.category || 'general',
        pattern: pattern.pattern || pattern.text || '',
        examples: pattern.examples || [],
        metadata: pattern.metadata || {},
      })),
    };

    await fs.writeJson(filePath, migratedFile, { spaces: 2 });
    logger.debug(`[SchemaValidator] Migrated patterns.json to v2.0`);
  }

  /**
   * Migrate observations.json from v1.0 to v2.0
   */
  private async migrateObservationsFile(filePath: string, data: any): Promise<void> {
    logger.debug(`[SchemaValidator] Migrating observations.json from v1.0 to v2.0`);
    
    await this.backupIfEnabled(filePath);

    const now = new Date().toISOString();
    const migratedFile: ObservationsFile = {
      version: '2.0',
      updatedAt: now,
      observations: (data.observations || []).map((observation: any, index: number) => ({
        id: observation.id || `observation-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: observation.createdAt || now,
        relevanceScore: typeof observation.relevanceScore === 'number' ? observation.relevanceScore : 1.0,
        expiresAt: observation.expiresAt || null,
        prdId: observation.prdId || 'unknown',
        phaseId: observation.phaseId,
        category: observation.category || 'general',
        observation: observation.observation || observation.text || '',
        context: observation.context || {},
        metadata: observation.metadata || {},
      })),
    };

    await fs.writeJson(filePath, migratedFile, { spaces: 2 });
    logger.debug(`[SchemaValidator] Migrated observations.json to v2.0`);
  }

  /**
   * Create backup of file before modification (if enabled)
   */
  private async backupIfEnabled(filePath: string): Promise<void> {
    if (!this.config.backup || !(await fs.pathExists(filePath))) {
      return;
    }

    const backupPath = `${filePath}.backup.${Date.now()}`;
    try {
      await fs.copy(filePath, backupPath);
      logger.debug(`[SchemaValidator] Created backup: ${backupPath}`);
    } catch (error) {
      logger.warn(`[SchemaValidator] Failed to create backup: ${error}`);
    }
  }
}
