/**
 * Validation Auto-Fixer
 *
 * Shared utility for validating and auto-fixing PRD sets until 100% executable.
 * Extracted from duplicated code in ConvertModeHandler, EnhanceModeHandler, and CreateModeHandler.
 */

import { PrdSetGenerator } from '../set/generator';
import { PrdSetDiscovery } from '../set/discovery';
import { ExecutabilityValidator, ExecutabilityValidationResult } from '../refinement/executability-validator';
import { Config } from '../../../config/schema/core';
import { logger } from '../../utils/logger';

/**
 * Validation Auto-Fixer Configuration
 */
export interface ValidationAutoFixerConfig {
  prdSetDir: string;
  setId: string;
  projectConfig?: Config;
  maxIterations?: number;
  debug?: boolean;
}

/**
 * Validation Auto-Fix Result
 */
export interface ValidationAutoFixResult {
  isExecutable: boolean;
  fixesApplied: string[];
  finalValidation: ExecutabilityValidationResult;
  iterations: number;
}

/**
 * Validates and auto-fixes PRD sets until 100% executable
 */
export class ValidationAutoFixer {
  private prdSetGenerator: PrdSetGenerator;
  private prdSetDiscovery: PrdSetDiscovery;
  private validator: ExecutabilityValidator;
  private debug: boolean;

  constructor(config: { debug?: boolean } = {}) {
    this.debug = config.debug || false;
    this.prdSetGenerator = new PrdSetGenerator(this.debug);
    this.prdSetDiscovery = new PrdSetDiscovery(this.debug);
    this.validator = new ExecutabilityValidator({ debug: this.debug });
  }

  /**
   * Validate and auto-fix PRD set until 100% executable or max iterations reached
   */
  async validateAndAutoFix(config: ValidationAutoFixerConfig): Promise<ValidationAutoFixResult> {
    const maxIterations = config.maxIterations || 5;
    let iteration = 0;
    let isExecutable = false;
    const fixesApplied: string[] = [];
    let finalValidation: ExecutabilityValidationResult | null = null;

    while (!isExecutable && iteration < maxIterations) {
      // Discover/reload PRD set
      const discoveredPrdSet = await this.prdSetDiscovery.discoverPrdSet(config.prdSetDir);

      // Validate
      const validationResult = await this.validator.validateExecutability(discoveredPrdSet);
      finalValidation = validationResult;

      logger.info(`[ValidationAutoFixer] Iteration ${iteration + 1}: score=${validationResult.score}, errors=${validationResult.errors.length}`);

      if (validationResult.executable && validationResult.score === 100) {
        isExecutable = true;
        break;
      }

      // Apply all available fixes
      let fixApplied = false;

      // Fix 1: ID pattern
      if (this.needsIdPatternFix(validationResult)) {
        if (await this.prdSetGenerator.fixIdPattern(config.prdSetDir, config.setId)) {
          fixesApplied.push('ID pattern corrected');
          fixApplied = true;
        }
      }

      // Fix 2: Testing config
      if (this.needsTestingConfigFix(validationResult)) {
        if (await this.prdSetGenerator.fixTestingConfig(config.prdSetDir, config.projectConfig)) {
          fixesApplied.push('Testing config updated');
          fixApplied = true;
        }
      }

      // Fix 3: Missing PRD ID
      if (this.needsPrdIdFix(validationResult)) {
        if (await this.prdSetGenerator.fixMissingPrdId(config.prdSetDir, config.setId)) {
          fixesApplied.push('PRD ID added');
          fixApplied = true;
        }
      }

      // Fix 4: Missing title
      if (this.needsTitleFix(validationResult)) {
        if (await this.prdSetGenerator.fixMissingTitle(config.prdSetDir, config.setId)) {
          fixesApplied.push('Title added');
          fixApplied = true;
        }
      }

      // Fix 5: Missing phase names
      if (this.needsPhaseNameFix(validationResult)) {
        if (await this.prdSetGenerator.fixMissingPhaseName(config.prdSetDir)) {
          fixesApplied.push('Phase names added');
          fixApplied = true;
        }
      }

      // Fix 6: Missing task titles
      if (this.needsTaskTitleFix(validationResult)) {
        if (await this.prdSetGenerator.fixMissingTaskTitles(config.prdSetDir)) {
          fixesApplied.push('Task titles added');
          fixApplied = true;
        }
      }

      // Fix 7: Missing task descriptions
      if (this.needsTaskDescriptionFix(validationResult)) {
        if (await this.prdSetGenerator.fixMissingTaskDescriptions(config.prdSetDir)) {
          fixesApplied.push('Task descriptions added');
          fixApplied = true;
        }
      }

      // Fix 8: Empty phases
      if (this.needsEmptyPhaseFix(validationResult)) {
        if (await this.prdSetGenerator.fixEmptyPhases(config.prdSetDir)) {
          fixesApplied.push('Placeholder tasks added');
          fixApplied = true;
        }
      }

      if (!fixApplied) {
        logger.debug(`[ValidationAutoFixer] No fixes available, stopping`);
        break;
      }

      logger.info(`[ValidationAutoFixer] Applied: ${fixesApplied.slice(-3).join(', ')}`);
      iteration++;
    }

    // Final summary
    if (isExecutable) {
      logger.info(`[ValidationAutoFixer] PRD set is 100% executable after ${iteration} iteration(s)`);
    } else {
      logger.warn(`[ValidationAutoFixer] PRD set not fully executable after ${iteration} iteration(s). Score: ${finalValidation?.score || 0}`);
      if (finalValidation?.errors && finalValidation.errors.length > 0) {
        logger.warn(`[ValidationAutoFixer] Remaining errors: ${finalValidation.errors.map(e => e.message).slice(0, 5).join('; ')}`);
      }
    }

    return {
      isExecutable,
      fixesApplied,
      finalValidation: finalValidation!,
      iterations: iteration,
    };
  }

  // Helper methods to detect when each fix is needed
  private needsIdPatternFix(result: ExecutabilityValidationResult): boolean {
    return result.errors.some(e =>
      e.type === 'invalid-structure' &&
      (e.message.includes('ID pattern') || e.message.includes('idPattern') || e.message.includes('does not match'))
    );
  }

  private needsTestingConfigFix(result: ExecutabilityValidationResult): boolean {
    return result.errors.some(e =>
      e.type === 'invalid-config' &&
      (e.message.includes('testing') || e.message.includes('framework') || e.message.includes('Testing directory'))
    ) || result.warnings.some(w =>
      w.type === 'missing-optional' && w.message.includes('testing')
    );
  }

  private needsPrdIdFix(result: ExecutabilityValidationResult): boolean {
    return result.errors.some(e =>
      e.type === 'invalid-structure' && e.message.includes('PRD ID is required')
    );
  }

  private needsTitleFix(result: ExecutabilityValidationResult): boolean {
    return result.errors.some(e =>
      e.type === 'invalid-structure' && e.message.includes('title is required')
    );
  }

  private needsPhaseNameFix(result: ExecutabilityValidationResult): boolean {
    return result.errors.some(e =>
      e.type === 'invalid-structure' && e.message.includes('missing a name')
    );
  }

  private needsTaskTitleFix(result: ExecutabilityValidationResult): boolean {
    return result.errors.some(e =>
      e.type === 'invalid-structure' && e.message.includes('missing a title')
    );
  }

  private needsTaskDescriptionFix(result: ExecutabilityValidationResult): boolean {
    return result.errors.some(e =>
      e.type === 'invalid-structure' && e.message.includes('missing a description')
    );
  }

  private needsEmptyPhaseFix(result: ExecutabilityValidationResult): boolean {
    return result.errors.some(e =>
      e.type === 'invalid-structure' && e.message.includes('has no tasks')
    );
  }
}
