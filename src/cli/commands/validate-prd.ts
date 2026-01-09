import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { validateConfigOverlay, ConfigOverlay } from '../../config/schema';

interface ValidationResult {
  errors: string[];
  warnings: string[];
}

interface Phase {
  id: number;
  name?: string;
  parallel?: boolean;
  dependsOn?: number[];
  status?: string;
  deferredReason?: string;
  note?: string;
  config?: ConfigOverlay;
}

interface Frontmatter {
  prd?: {
    id?: string;
    version?: string;
    status?: string;
  };
  execution?: {
    strategy?: string;
  };
  requirements?: {
    idPattern?: string;
    phases?: Phase[];
  };
  testing?: {
    directory?: string;
  };
  config?: ConfigOverlay;
}

/**
 * Extract YAML frontmatter from markdown file
 */
function extractFrontmatter(filePath: string): Frontmatter {
  const content = fs.readFileSync(filePath, 'utf8');

  // Match YAML frontmatter between --- markers
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    throw new Error('No YAML frontmatter found (expected between --- markers)');
  }

  try {
    return parseYaml(match[1]) as Frontmatter;
  } catch (e) {
    throw new Error(`YAML parsing error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Validate required fields
 */
function validateRequiredFields(frontmatter: Frontmatter): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required top-level sections
  const required = ['prd', 'execution', 'requirements', 'testing'];
  for (const section of required) {
    if (!frontmatter[section as keyof Frontmatter]) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  // Required prd fields
  if (frontmatter.prd) {
    if (!frontmatter.prd.id) errors.push('Missing prd.id');
    if (!frontmatter.prd.version) errors.push('Missing prd.version');
    if (!frontmatter.prd.status) errors.push('Missing prd.status');
    if (
      frontmatter.prd.status &&
      !['ready', 'draft', 'deprecated'].includes(frontmatter.prd.status)
    ) {
      errors.push(
        `Invalid prd.status: ${frontmatter.prd.status} (must be: ready, draft, deprecated)`
      );
    }
  }

  // Required execution fields
  if (frontmatter.execution) {
    if (!frontmatter.execution.strategy) {
      errors.push('Missing execution.strategy');
    } else if (frontmatter.execution.strategy !== 'phased') {
      errors.push(
        `Invalid execution.strategy: ${frontmatter.execution.strategy} (must be: phased)`
      );
    }
  }

  // Required requirements fields
  if (frontmatter.requirements) {
    if (!frontmatter.requirements.idPattern) {
      errors.push('Missing requirements.idPattern');
    } else if (!frontmatter.requirements.idPattern.includes('{id}')) {
      errors.push('requirements.idPattern must contain {id} placeholder');
    }
    if (
      !frontmatter.requirements.phases ||
      !Array.isArray(frontmatter.requirements.phases)
    ) {
      errors.push('Missing or invalid requirements.phases (must be array)');
    }
  }

  // Required testing fields
  if (frontmatter.testing) {
    if (!frontmatter.testing.directory) {
      errors.push('Missing testing.directory');
    }
  }

  return { errors, warnings };
}

/**
 * Detect circular dependencies using DFS
 */
function detectCircularDependencies(phases: Phase[]): string[] {
  const circular: string[] = [];
  const visited = new Set<number>();
  const recursionStack = new Set<number>();

  function dfs(phaseId: number): number[] {
    if (recursionStack.has(phaseId)) {
      // Found cycle
      return [phaseId];
    }

    if (visited.has(phaseId)) {
      return [];
    }

    visited.add(phaseId);
    recursionStack.add(phaseId);

    const phase = phases.find((p) => p.id === phaseId);
    if (!phase || !phase.dependsOn) {
      recursionStack.delete(phaseId);
      return [];
    }

    for (const depId of phase.dependsOn) {
      const cycle = dfs(depId);
      if (cycle.length > 0) {
        recursionStack.delete(phaseId);
        return [phaseId, ...cycle];
      }
    }

    recursionStack.delete(phaseId);
    return [];
  }

  for (const phase of phases) {
    if (!visited.has(phase.id)) {
      const cycle = dfs(phase.id);
      if (cycle.length > 0) {
        // Simplify cycle to show the actual loop
        const cycleStr = cycle.join(' → ') + ' → ' + cycle[0];
        circular.push(cycleStr);
      }
    }
  }

  return circular;
}

/**
 * Validate phase configuration
 */
function validatePhases(phases: Phase[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(phases) || phases.length === 0) {
    errors.push('phases must be a non-empty array');
    return { errors, warnings };
  }

  const phaseIds = new Set<number>();
  const phaseStatuses: Record<number, string> = {};

  // Collect phase data
  for (const phase of phases) {
    if (phase.id === undefined || phase.id === null) {
      errors.push('Phase missing id field');
      continue;
    }

    if (typeof phase.id !== 'number') {
      errors.push(`Phase id must be number, got: ${typeof phase.id}`);
      continue;
    }

    if (phase.id < 0 || phase.id > 999) {
      warnings.push(`Phase id ${phase.id} outside recommended range (0-999)`);
    }

    if (phaseIds.has(phase.id)) {
      errors.push(`Duplicate phase id: ${phase.id}`);
    }
    phaseIds.add(phase.id);

    if (!phase.name) {
      errors.push(`Phase ${phase.id} missing name`);
    }

    // Track status
    const status = phase.status || 'pending';
    phaseStatuses[phase.id] = status;

    // Validate status values
    const validStatuses = [
      'pending',
      'complete',
      'mostly_complete',
      'deferred',
      'optional',
      'low_priority',
    ];
    if (status && !validStatuses.includes(status)) {
      errors.push(`Phase ${phase.id} has invalid status: ${status}`);
    }

    // Deferred phases must have deferredReason
    if (status === 'deferred' && !phase.deferredReason) {
      errors.push(
        `Phase ${phase.id} has status: deferred but missing deferredReason`
      );
    }
  }

  // Validate dependencies
  for (const phase of phases) {
    if (!phase.dependsOn || !Array.isArray(phase.dependsOn)) {
      continue;
    }

    for (const depId of phase.dependsOn) {
      // Check dependency exists
      if (!phaseIds.has(depId)) {
        errors.push(`Phase ${phase.id} depends on non-existent phase ${depId}`);
        continue;
      }

      // Check not depending on optional/deferred
      const depStatus = phaseStatuses[depId] || 'pending';
      if (depStatus === 'optional') {
        errors.push(
          `Phase ${phase.id} depends on optional phase ${depId} (not allowed)`
        );
      }
      if (depStatus === 'deferred') {
        errors.push(
          `Phase ${phase.id} depends on deferred phase ${depId} (not allowed)`
        );
      }
    }
  }

  // Check for circular dependencies
  const circular = detectCircularDependencies(phases);
  if (circular.length > 0) {
    errors.push(`Circular dependencies detected: ${circular.join(', ')}`);
  }

  // Validate phase config overlays
  for (const phase of phases) {
    if (phase.config) {
      const configValidation = validateConfigOverlay(phase.config, 'phase');
      if (!configValidation.valid) {
        for (const err of configValidation.errors) {
          errors.push(`Phase ${phase.id} config: ${err}`);
        }
      }
      for (const warn of configValidation.warnings) {
        warnings.push(`Phase ${phase.id} config: ${warn}`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validate PRD config overlay
 */
function validatePrdConfig(frontmatter: Frontmatter): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (frontmatter.config) {
    const configValidation = validateConfigOverlay(frontmatter.config, 'prd');
    if (!configValidation.valid) {
      for (const err of configValidation.errors) {
        errors.push(`PRD config: ${err}`);
      }
    }
    for (const warn of configValidation.warnings) {
      warnings.push(`PRD config: ${warn}`);
    }
  }

  return { errors, warnings };
}

/**
 * Main validation function
 */
export async function validatePrdCommand(options: {
  prd: string;
  schema?: string;
  verbose?: boolean;
}): Promise<void> {
  const filePath = path.resolve(process.cwd(), options.prd);

  console.log(chalk.blue(`\nValidating PRD: ${filePath}\n`));

  try {
    if (!(await fs.pathExists(filePath))) {
      console.error(chalk.red(`File not found: ${filePath}`));
      process.exit(1);
    }

    const frontmatter = extractFrontmatter(filePath);

    // Validate required fields
    const { errors: reqErrors, warnings: reqWarnings } =
      validateRequiredFields(frontmatter);

    // Validate phases
    let phaseErrors: string[] = [];
    let phaseWarnings: string[] = [];
    if (frontmatter.requirements && frontmatter.requirements.phases) {
      const phaseValidation = validatePhases(frontmatter.requirements.phases);
      phaseErrors = phaseValidation.errors;
      phaseWarnings = phaseValidation.warnings;
    }

    // Validate PRD config overlay
    const { errors: configErrors, warnings: configWarnings } =
      validatePrdConfig(frontmatter);

    // Combine all errors and warnings
    const allErrors = [...reqErrors, ...phaseErrors, ...configErrors];
    const allWarnings = [...reqWarnings, ...phaseWarnings, ...configWarnings];

    // Report results
    if (allErrors.length === 0 && allWarnings.length === 0) {
      console.log(chalk.green('✓ PRD frontmatter is valid!'));
      console.log(`\n  PRD ID: ${frontmatter.prd?.id || 'N/A'}`);
      console.log(`  Version: ${frontmatter.prd?.version || 'N/A'}`);
      console.log(`  Status: ${frontmatter.prd?.status || 'N/A'}`);
      console.log(`  Phases: ${frontmatter.requirements?.phases?.length || 0}`);
      return;
    }

    // Report errors
    if (allErrors.length > 0) {
      console.log(chalk.red(`\nErrors (${allErrors.length}):`));
      allErrors.forEach((err) => console.log(chalk.red(`  ✗ ${err}`)));
    }

    // Report warnings
    if (allWarnings.length > 0) {
      console.log(chalk.yellow(`\nWarnings (${allWarnings.length}):`));
      allWarnings.forEach((warn) => console.log(chalk.yellow(`  ⚠ ${warn}`)));
    }

    console.log(chalk.red(`\nValidation failed with ${allErrors.length} error(s)\n`));
    process.exit(allErrors.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(chalk.red(`Validation error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
