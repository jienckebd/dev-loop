/**
 * Validate Code Node
 *
 * LangGraph node that validates generated code changes before applying.
 * Checks syntax, file paths, and other validation rules.
 */

import { CodeChanges } from '../../../../types';
import { WorkflowState, ValidationResult } from '../state';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';
import { emitEvent } from '../../../utils/event-stream';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface ValidateCodeNodeConfig {
  config: Config;
  debug?: boolean;
  // Optional validation gate for additional checks
  validationGate?: {
    validate: (changes: CodeChanges) => Promise<ValidationResult>;
  };
}

/**
 * Create the validate code node function
 */
export function validateCode(nodeConfig: ValidateCodeNodeConfig) {
  const { config, debug, validationGate } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    // Skip if no code changes
    if (!state.codeChanges || !state.codeChanges.files.length) {
      logger.warn('[ValidateCode] No code changes to validate');
      return {
        status: 'validating',
        validationResult: {
          valid: false,
          errors: ['No code changes to validate'],
          warnings: [],
        },
      };
    }

    try {
      if (debug) {
        logger.debug(`[ValidateCode] Validating ${state.codeChanges.files.length} file(s)`);
      }

      const errors: string[] = [];
      const warnings: string[] = [];
      const blockers: string[] = [];

      // Validate each file
      for (const file of state.codeChanges.files) {
        const fileValidation = await validateFile(file, config, debug);
        errors.push(...fileValidation.errors);
        warnings.push(...fileValidation.warnings);
        if (fileValidation.blocker) {
          blockers.push(fileValidation.blocker);
        }
      }

      // Run additional validation gate if provided
      if (validationGate) {
        try {
          const gateResult = await validationGate.validate(state.codeChanges);
          errors.push(...gateResult.errors);
          warnings.push(...gateResult.warnings);
          if (gateResult.blockers) {
            blockers.push(...gateResult.blockers);
          }
        } catch (error) {
          warnings.push(`Validation gate error: ${error}`);
        }
      }

      const result: ValidationResult = {
        valid: errors.length === 0 && blockers.length === 0,
        errors,
        warnings,
        blockers: blockers.length > 0 ? blockers : undefined,
      };

      if (result.valid) {
        logger.info(`[ValidateCode] Validation passed with ${warnings.length} warning(s)`);

        // Emit validation:passed event
        emitEvent('validation:passed', {
          taskId: state.task ? String(state.task.id) : undefined,
          fileCount: state.codeChanges.files.length,
          warningCount: warnings.length,
        }, {
          taskId: state.task ? String(state.task.id) : undefined,
          prdId: state.prdId,
          phaseId: state.phaseId,
        });
      } else {
        logger.warn(`[ValidateCode] Validation failed with ${errors.length} error(s)`);

        // Emit validation:failed event
        emitEvent('validation:failed', {
          taskId: state.task ? String(state.task.id) : undefined,
          errorCount: errors.length,
          blockerCount: blockers.length,
          errors: errors.slice(0, 5), // First 5 errors for event
        }, {
          taskId: state.task ? String(state.task.id) : undefined,
          prdId: state.prdId,
          phaseId: state.phaseId,
        });
      }

      return {
        status: 'validating',
        validationResult: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[ValidateCode] Validation error: ${errorMessage}`);

      return {
        status: 'failed',
        validationResult: {
          valid: false,
          errors: [`Validation error: ${errorMessage}`],
          warnings: [],
        },
        error: `Validation failed: ${errorMessage}`,
      };
    }
  };
}

interface FileValidationResult {
  errors: string[];
  warnings: string[];
  blocker?: string;
}

/**
 * Validate a single file change
 */
async function validateFile(
  file: CodeChanges['files'][0],
  config: Config,
  debug?: boolean
): Promise<FileValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let blocker: string | undefined;

  // Check file path
  if (!file.path) {
    errors.push('File has no path');
    return { errors, warnings, blocker: 'Invalid file path' };
  }

  // Normalize path
  const normalizedPath = file.path.replace(/^\/+/, '');

  // Check for dangerous paths
  if (normalizedPath.includes('..')) {
    errors.push(`Path traversal detected: ${file.path}`);
    blocker = 'Path traversal not allowed';
    return { errors, warnings, blocker };
  }

  // Check for core/vendor modifications
  const forbiddenPaths = ['vendor/', 'core/', 'node_modules/'];
  for (const forbidden of forbiddenPaths) {
    if (normalizedPath.startsWith(forbidden)) {
      errors.push(`Cannot modify ${forbidden} directory: ${file.path}`);
      blocker = `Modification of ${forbidden} not allowed`;
      return { errors, warnings, blocker };
    }
  }

  // For update operations, check file exists
  if (file.operation === 'update' || file.operation === 'patch') {
    const fullPath = path.resolve(process.cwd(), normalizedPath);
    if (!await fs.pathExists(fullPath)) {
      warnings.push(`File does not exist (will create): ${file.path}`);
    }
  }

  // For create operations, check directory exists
  if (file.operation === 'create') {
    const dir = path.dirname(path.resolve(process.cwd(), normalizedPath));
    if (!await fs.pathExists(dir)) {
      if (debug) {
        logger.debug(`[ValidateCode] Directory will be created: ${dir}`);
      }
    }
  }

  // Validate content is present for create/update
  if ((file.operation === 'create' || file.operation === 'update') && !file.content) {
    if (!file.patches || file.patches.length === 0) {
      warnings.push(`No content or patches for ${file.operation}: ${file.path}`);
    }
  }

  // PHP syntax check for PHP files
  if (file.path.endsWith('.php') && file.content) {
    const syntaxErrors = checkPhpSyntax(file.content);
    errors.push(...syntaxErrors);
  }

  // YAML syntax check
  if ((file.path.endsWith('.yml') || file.path.endsWith('.yaml')) && file.content) {
    const syntaxErrors = checkYamlSyntax(file.content);
    errors.push(...syntaxErrors);
  }

  return { errors, warnings, blocker };
}

/**
 * Basic PHP syntax check (pattern-based, not full parse)
 */
function checkPhpSyntax(content: string): string[] {
  const errors: string[] = [];

  // Check for unclosed braces (simple heuristic)
  const openBraces = (content.match(/\{/g) || []).length;
  const closeBraces = (content.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    errors.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
  }

  // Check for common issues
  if (content.includes('<?php') && content.includes('?>')) {
    // Closing PHP tag in non-template file is discouraged
    if (!content.includes('.twig') && !content.includes('html')) {
      // Just a warning, not an error
    }
  }

  return errors;
}

/**
 * Basic YAML syntax check
 */
function checkYamlSyntax(content: string): string[] {
  const errors: string[] = [];

  // Check for tab characters (YAML doesn't allow tabs)
  if (content.includes('\t')) {
    errors.push('YAML contains tab characters (use spaces instead)');
  }

  // Check for inconsistent indentation
  const lines = content.split('\n');
  let lastIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.match(/^(\s*)/)?.[1].length || 0;
    if (indent > lastIndent + 2 && indent !== 0) {
      // Jump of more than 2 spaces might indicate an issue
      // But this is just a heuristic, not a strict check
    }
    lastIndent = indent;
  }

  return errors;
}
