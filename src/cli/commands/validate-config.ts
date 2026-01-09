import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { validateConfig, validateConfigOverlay } from '../../config/schema/validation';
import { ConfigOverlay } from '../../config/schema/overlays';
import { frameworkConfigSchema } from '../../config/schema/framework';
import { PrdSetDiscovery } from "../../core/prd/set/discovery";
import { PrdConfigParser } from "../../core/prd/parser/config-parser";
import { loadConfig } from '../../config/loader';

interface ValidationOutput {
  level: 'project' | 'framework' | 'prd-set' | 'prd' | 'phase';
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
    value?: any;
  }>;
  warnings: Array<{
    field: string;
    message: string;
    suggestion?: string;
  }>;
  schema: {
    validated: boolean;
    schemaVersion?: string;
  };
}

/**
 * Validate project config (devloop.config.js)
 */
async function validateProjectConfig(): Promise<ValidationOutput> {
  const output: ValidationOutput = {
    level: 'project',
    valid: true,
    errors: [],
    warnings: [],
    schema: { validated: false },
  };

  try {
    const config = await loadConfig(process.cwd());
    validateConfig(config);
    output.schema.validated = true;
    output.schema.schemaVersion = '1.3';
  } catch (error) {
    output.valid = false;
    output.errors.push({
      field: 'config',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return output;
}

/**
 * Validate framework config
 */
async function validateFrameworkConfig(): Promise<ValidationOutput> {
  const output: ValidationOutput = {
    level: 'framework',
    valid: true,
    errors: [],
    warnings: [],
    schema: { validated: false },
  };

  try {
    const config = await loadConfig(process.cwd());
    if (config.framework) {
      const result = frameworkConfigSchema.safeParse(config.framework);
      if (!result.success) {
        output.valid = false;
        for (const issue of result.error.issues) {
          output.errors.push({
            field: `framework.${issue.path.join('.')}`,
            message: issue.message,
          });
        }
      } else {
        output.schema.validated = true;
      }
    } else {
      output.warnings.push({
        field: 'framework',
        message: 'No framework config defined',
        suggestion: 'Add framework config if using a specific framework',
      });
    }
  } catch (error) {
    output.valid = false;
    output.errors.push({
      field: 'framework',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return output;
}

/**
 * Validate PRD set config
 */
async function validatePrdSetConfig(prdSetId?: string, prdSetPath?: string): Promise<ValidationOutput> {
  const output: ValidationOutput = {
    level: 'prd-set',
    valid: true,
    errors: [],
    warnings: [],
    schema: { validated: false },
  };

  try {
    const discovery = new PrdSetDiscovery();

    let setDir: string;
    if (prdSetPath) {
      setDir = path.resolve(process.cwd(), prdSetPath);
    } else if (prdSetId) {
      setDir = path.resolve(process.cwd(), '.taskmaster/planning', prdSetId);
    } else {
      output.valid = false;
      output.errors.push({
        field: 'prdSetId',
        message: 'Either prdSetId or prdSetPath is required',
      });
      return output;
    }

    if (!await fs.pathExists(setDir)) {
      output.valid = false;
      output.errors.push({
        field: 'path',
        message: `PRD set directory not found: ${setDir}`,
      });
      return output;
    }

    // Try to load config file
    const jsonPath = path.join(setDir, 'prd-set-config.json');
    const yamlPath = path.join(setDir, 'prd-set-config.yml');

    let configOverlay: ConfigOverlay | undefined;

    if (await fs.pathExists(jsonPath)) {
      const content = await fs.readFile(jsonPath, 'utf-8');
      configOverlay = JSON.parse(content);
    } else if (await fs.pathExists(yamlPath)) {
      const content = await fs.readFile(yamlPath, 'utf-8');
      configOverlay = parseYaml(content);
    } else {
      output.warnings.push({
        field: 'config',
        message: 'No PRD set config file found (prd-set-config.json or prd-set-config.yml)',
        suggestion: 'Create prd-set-config.json in the PRD set directory',
      });
      output.schema.validated = true;
      return output;
    }

    if (configOverlay) {
      const validation = validateConfigOverlay(configOverlay, 'prd-set');
      output.valid = validation.valid;
      for (const err of validation.errors) {
        output.errors.push({ field: 'config', message: err });
      }
      for (const warn of validation.warnings) {
        output.warnings.push({ field: 'config', message: warn });
      }
      output.schema.validated = true;
    }
  } catch (error) {
    output.valid = false;
    output.errors.push({
      field: 'prd-set',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return output;
}

/**
 * Validate PRD config
 */
async function validatePrdConfig(prdPath: string): Promise<ValidationOutput> {
  const output: ValidationOutput = {
    level: 'prd',
    valid: true,
    errors: [],
    warnings: [],
    schema: { validated: false },
  };

  try {
    const resolvedPath = path.resolve(process.cwd(), prdPath);

    if (!await fs.pathExists(resolvedPath)) {
      output.valid = false;
      output.errors.push({
        field: 'path',
        message: `PRD file not found: ${resolvedPath}`,
      });
      return output;
    }

    const parser = new PrdConfigParser();
    const config = await parser.parsePrdConfig(resolvedPath);

    if (config) {
      const validation = validateConfigOverlay(config as ConfigOverlay, 'prd');
      output.valid = validation.valid;
      for (const err of validation.errors) {
        output.errors.push({ field: 'config', message: err });
      }
      for (const warn of validation.warnings) {
        output.warnings.push({ field: 'config', message: warn });
      }
      output.schema.validated = true;
    } else {
      output.warnings.push({
        field: 'config',
        message: 'No config section found in PRD frontmatter',
        suggestion: 'Add a config: section to PRD frontmatter if needed',
      });
      output.schema.validated = true;
    }
  } catch (error) {
    output.valid = false;
    output.errors.push({
      field: 'prd',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return output;
}

/**
 * Validate phase config
 */
async function validatePhaseConfig(prdPath: string, phaseId: number): Promise<ValidationOutput> {
  const output: ValidationOutput = {
    level: 'phase',
    valid: true,
    errors: [],
    warnings: [],
    schema: { validated: false },
  };

  try {
    const resolvedPath = path.resolve(process.cwd(), prdPath);

    if (!await fs.pathExists(resolvedPath)) {
      output.valid = false;
      output.errors.push({
        field: 'path',
        message: `PRD file not found: ${resolvedPath}`,
      });
      return output;
    }

    const parser = new PrdConfigParser();
    const metadata = await parser.parsePrdMetadata(resolvedPath);

    if (!metadata?.requirements?.phases) {
      output.warnings.push({
        field: 'phases',
        message: 'No phases defined in PRD',
      });
      output.schema.validated = true;
      return output;
    }

    const phase = metadata.requirements.phases.find(p => p.id === phaseId);
    if (!phase) {
      output.valid = false;
      output.errors.push({
        field: 'phaseId',
        message: `Phase ${phaseId} not found in PRD`,
      });
      return output;
    }

    if (phase.config) {
      const validation = validateConfigOverlay(phase.config as ConfigOverlay, 'phase');
      output.valid = validation.valid;
      for (const err of validation.errors) {
        output.errors.push({ field: `phase.${phaseId}.config`, message: err });
      }
      for (const warn of validation.warnings) {
        output.warnings.push({ field: `phase.${phaseId}.config`, message: warn });
      }
      output.schema.validated = true;
    } else {
      output.warnings.push({
        field: `phase.${phaseId}.config`,
        message: `Phase ${phaseId} has no config overlay`,
        suggestion: 'Add a config: section to the phase if needed',
      });
      output.schema.validated = true;
    }
  } catch (error) {
    output.valid = false;
    output.errors.push({
      field: 'phase',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return output;
}

/**
 * Print validation output
 */
function printOutput(output: ValidationOutput, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const levelLabel = output.level.toUpperCase();
  const statusIcon = output.valid ? chalk.green('✓') : chalk.red('✗');

  console.log(`\n${statusIcon} ${levelLabel} Config Validation`);
  console.log(`  Schema validated: ${output.schema.validated ? 'yes' : 'no'}`);

  if (output.errors.length > 0) {
    console.log(chalk.red(`\n  Errors (${output.errors.length}):`));
    for (const err of output.errors) {
      console.log(chalk.red(`    ✗ [${err.field}] ${err.message}`));
    }
  }

  if (output.warnings.length > 0) {
    console.log(chalk.yellow(`\n  Warnings (${output.warnings.length}):`));
    for (const warn of output.warnings) {
      console.log(chalk.yellow(`    ⚠ [${warn.field}] ${warn.message}`));
      if (warn.suggestion) {
        console.log(chalk.gray(`      Suggestion: ${warn.suggestion}`));
      }
    }
  }

  if (output.valid && output.errors.length === 0) {
    console.log(chalk.green('\n  Config is valid!'));
  }
}

/**
 * Main validate-config command
 */
export async function validateConfigCommand(options: {
  level: 'project' | 'framework' | 'prd-set' | 'prd' | 'phase' | 'all';
  prdSetId?: string;
  prdSetPath?: string;
  prd?: string;
  phase?: number;
  json?: boolean;
}): Promise<void> {
  const { level, prdSetId, prdSetPath, prd, phase, json = false } = options;

  const outputs: ValidationOutput[] = [];
  let hasErrors = false;

  if (level === 'all' || level === 'project') {
    const output = await validateProjectConfig();
    outputs.push(output);
    if (!output.valid) hasErrors = true;
  }

  if (level === 'all' || level === 'framework') {
    const output = await validateFrameworkConfig();
    outputs.push(output);
    if (!output.valid) hasErrors = true;
  }

  if (level === 'all' || level === 'prd-set') {
    if (prdSetId || prdSetPath) {
      const output = await validatePrdSetConfig(prdSetId, prdSetPath);
      outputs.push(output);
      if (!output.valid) hasErrors = true;
    } else if (level === 'prd-set') {
      console.error(chalk.red('Error: --prd-set or --prd-set-path required for prd-set level'));
      process.exit(1);
    }
  }

  if (level === 'all' || level === 'prd') {
    if (prd) {
      const output = await validatePrdConfig(prd);
      outputs.push(output);
      if (!output.valid) hasErrors = true;
    } else if (level === 'prd') {
      console.error(chalk.red('Error: --prd required for prd level'));
      process.exit(1);
    }
  }

  if (level === 'all' || level === 'phase') {
    if (prd && phase !== undefined) {
      const output = await validatePhaseConfig(prd, phase);
      outputs.push(output);
      if (!output.valid) hasErrors = true;
    } else if (level === 'phase') {
      console.error(chalk.red('Error: --prd and --phase required for phase level'));
      process.exit(1);
    }
  }

  // Print results
  if (json) {
    console.log(JSON.stringify({
      results: outputs,
      summary: {
        total: outputs.length,
        valid: outputs.filter(o => o.valid).length,
        invalid: outputs.filter(o => !o.valid).length,
        errors: outputs.reduce((sum, o) => sum + o.errors.length, 0),
        warnings: outputs.reduce((sum, o) => sum + o.warnings.length, 0),
      },
    }, null, 2));
  } else {
    console.log(chalk.blue('\n=== Config Validation Results ==='));
    for (const output of outputs) {
      printOutput(output, false);
    }

    console.log(chalk.blue('\n=== Summary ==='));
    console.log(`  Total levels validated: ${outputs.length}`);
    console.log(`  Valid: ${chalk.green(outputs.filter(o => o.valid).length.toString())}`);
    console.log(`  Invalid: ${chalk.red(outputs.filter(o => !o.valid).length.toString())}`);
    console.log(`  Errors: ${outputs.reduce((sum, o) => sum + o.errors.length, 0)}`);
    console.log(`  Warnings: ${outputs.reduce((sum, o) => sum + o.warnings.length, 0)}`);
  }

  process.exit(hasErrors ? 1 : 0);
}

