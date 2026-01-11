import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import {
  validatePatternsFile,
  validateObservationsFile,
  validateMetricsFile,
  validateStateFile,
  validateTestResultsFile,
  validatePrdSetMetricsFile,
  validatePrdMetricsFile,
  validatePhaseMetricsFile,
  validateParallelMetricsFile,
  validateFeatureMetricsFile,
  validateSchemaMetricsFile,
  validateContributionModeFile,
  validateRetryCountsFile,
  validateEvolutionStateFile,
  validatePrdSetState,
  validateChatRequest,
  validateSession,
  validateCheckpoint,
  validateConversationFile,
  validatePrdContextV2File,
} from '../../config/schema/validation';

interface ValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
}

/**
 * Validate all .devloop JSON files
 */
export async function validateDataCommand(options: {
  json?: boolean;
  file?: string;
}): Promise<void> {
  const projectRoot = process.cwd();
  const devloopDir = path.join(projectRoot, '.devloop');
  const filesPrivateDir = path.join(projectRoot, 'files-private', 'cursor');

  const results: ValidationResult[] = [];

  // File validators mapping
  const validators: Array<{
    file: string;
    validator: (data: unknown) => any;
    optional?: boolean;
  }> = [
    { file: '.devloop/patterns.json', validator: validatePatternsFile, optional: true },
    { file: '.devloop/observations.json', validator: validateObservationsFile, optional: true },
    { file: '.devloop/metrics.json', validator: validateMetricsFile, optional: true },
    { file: '.devloop/state.json', validator: validateStateFile, optional: true },
    { file: '.devloop/test-results.json/test-results.json', validator: validateTestResultsFile, optional: true },
    { file: '.devloop/prd-set-metrics.json', validator: validatePrdSetMetricsFile, optional: true },
    { file: '.devloop/prd-metrics.json', validator: validatePrdMetricsFile, optional: true },
    { file: '.devloop/phase-metrics.json', validator: validatePhaseMetricsFile, optional: true },
    { file: '.devloop/parallel-metrics.json', validator: validateParallelMetricsFile, optional: true },
    { file: '.devloop/feature-metrics.json', validator: validateFeatureMetricsFile, optional: true },
    { file: '.devloop/schema-metrics.json', validator: validateSchemaMetricsFile, optional: true },
    { file: '.devloop/contribution-mode.json', validator: validateContributionModeFile, optional: true },
    { file: '.devloop/retry-counts.json', validator: validateRetryCountsFile, optional: true },
    { file: '.devloop/evolution-state.json', validator: validateEvolutionStateFile, optional: true },
    { file: '.devloop/prd-set-state.json', validator: validatePrdSetState, optional: true },
    { file: '.devloop/cursor-sessions.json', validator: validateSession, optional: true },
    { file: 'files-private/cursor/chat-requests.json', validator: validateChatRequest, optional: true },
  ];

  // If specific file provided, validate only that
  if (options.file) {
    const validator = validators.find(v => v.file === options.file || v.file.endsWith(options.file!));
    if (!validator) {
      console.error(chalk.red(`Unknown file: ${options.file}`));
      process.exit(1);
    }
    validators.length = 0;
    validators.push(validator);
  }

  // Validate each file
  for (const { file, validator, optional } of validators) {
    const filePath = path.join(projectRoot, file);
    const result: ValidationResult = {
      file,
      valid: true,
      errors: [],
    };

    try {
      if (!(await fs.pathExists(filePath))) {
        if (optional) {
          continue; // Skip optional files that don't exist
        }
        result.valid = false;
        result.errors.push('File does not exist');
      } else {
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        validator(data); // Will throw if invalid
      }
    } catch (error) {
      result.valid = false;
      if (error instanceof Error) {
        if (error.message.includes('Required')) {
          result.errors.push(error.message);
        } else {
          result.errors.push(error.message);
        }
      } else {
        result.errors.push(String(error));
      }
    }

    results.push(result);
  }

  // Validate conversation files
  const conversationsDir = path.join(devloopDir, 'conversations');
  if (await fs.pathExists(conversationsDir)) {
    const convFiles = await fs.readdir(conversationsDir);
    for (const convFile of convFiles) {
      if (convFile.endsWith('.json')) {
        const filePath = path.join(conversationsDir, convFile);
        const result: ValidationResult = {
          file: `.devloop/conversations/${convFile}`,
          valid: true,
          errors: [],
        };

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          validateConversationFile(data);
        } catch (error) {
          result.valid = false;
          result.errors.push(error instanceof Error ? error.message : String(error));
        }

        results.push(result);
      }
    }
  }

  // Validate checkpoint files
  const checkpointsDir = path.join(devloopDir, 'prd-building-checkpoints');
  if (await fs.pathExists(checkpointsDir)) {
    const checkpointFiles = await fs.readdir(checkpointsDir);
    for (const checkpointFile of checkpointFiles) {
      if (checkpointFile.endsWith('.json')) {
        const filePath = path.join(checkpointsDir, checkpointFile);
        const result: ValidationResult = {
          file: `.devloop/prd-building-checkpoints/${checkpointFile}`,
          valid: true,
          errors: [],
        };

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          validateCheckpoint(data);
        } catch (error) {
          result.valid = false;
          result.errors.push(error instanceof Error ? error.message : String(error));
        }

        results.push(result);
      }
    }
  }

  // Validate PRD context v2 files
  const prdContextDir = path.join(devloopDir, 'prd-context-v2');
  if (await fs.pathExists(prdContextDir)) {
    const contextFiles = await fs.readdir(prdContextDir);
    for (const contextFile of contextFiles) {
      if (contextFile.endsWith('.json')) {
        const filePath = path.join(prdContextDir, contextFile);
        const result: ValidationResult = {
          file: `.devloop/prd-context-v2/${contextFile}`,
          valid: true,
          errors: [],
        };

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const data = JSON.parse(content);
          validatePrdContextV2File(data);
        } catch (error) {
          result.valid = false;
          result.errors.push(error instanceof Error ? error.message : String(error));
        }

        results.push(result);
      }
    }
  }

  // Print results
  if (options.json) {
    console.log(JSON.stringify({
      results,
      summary: {
        total: results.length,
        valid: results.filter(r => r.valid).length,
        invalid: results.filter(r => !r.valid).length,
        errors: results.reduce((sum, r) => sum + r.errors.length, 0),
      },
    }, null, 2));
  } else {
    console.log(chalk.blue('\n=== Data File Validation Results ===\n'));

    for (const result of results) {
      if (result.valid) {
        console.log(chalk.green(`✓ ${result.file}`));
      } else {
        console.log(chalk.red(`✗ ${result.file}`));
        for (const error of result.errors) {
          console.log(chalk.red(`  - ${error}`));
        }
      }
    }

    const validCount = results.filter(r => r.valid).length;
    const invalidCount = results.filter(r => !r.valid).length;
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    console.log(chalk.blue('\n=== Summary ==='));
    console.log(`  Total files validated: ${results.length}`);
    console.log(`  Valid: ${chalk.green(validCount.toString())}`);
    console.log(`  Invalid: ${chalk.red(invalidCount.toString())}`);
    console.log(`  Total errors: ${chalk.red(totalErrors.toString())}`);
  }

  const hasErrors = results.some(r => !r.valid);
  process.exit(hasErrors ? 1 : 0);
}
