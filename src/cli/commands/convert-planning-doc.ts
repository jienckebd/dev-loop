import { Command } from 'commander';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { PlanningDocParser, ParsedPlanningDoc } from "../../core/prd/parser/planning-doc-parser";
import { PrdSetGenerator } from "../../core/prd/set/generator";
import { PrdSetDiscovery } from "../../core/prd/set/discovery";
import { validateConfigOverlay } from '../../config/schema';
import { logger } from "../../core/utils/logger";

interface ConvertOptions {
  outputDir?: string;
  setId?: string;
  iterations?: number;
  validateOnly?: boolean;
  force?: boolean;
  debug?: boolean;
}

/**
 * Register the convert-planning-doc command
 *
 * Converts planning documents (like design_system_prd.md, mcp_entity_bridge_prd.md)
 * into well-structured PRD sets that are 100% executable for TDD.
 */
export function registerConvertPlanningDocCommand(program: Command): void {
  program
    .command('convert-planning-doc <planningDocPath>')
    .description('Convert a planning document into a PRD set using AI-powered refinement')
    .option('-o, --output-dir <dir>', 'Output directory for PRD set')
    .option('-s, --set-id <id>', 'PRD set ID (default: extracted from document)')
    .option('-i, --iterations <n>', 'Number of refinement iterations', '3')
    .option('-v, --validate-only', 'Only validate, don\'t create files')
    .option('-f, --force', 'Overwrite existing PRD set')
    .option('-d, --debug', 'Enable debug output')
    .action(async (planningDocPath: string, options: ConvertOptions) => {
      await convertPlanningDoc(planningDocPath, options);
    });
}

async function convertPlanningDoc(planningDocPath: string, options: ConvertOptions): Promise<void> {
  console.log(chalk.blue('\n📄 Converting Planning Document to PRD Set\n'));

  const resolvedPath = path.resolve(process.cwd(), planningDocPath);

  // Validate input file exists
  if (!(await fs.pathExists(resolvedPath))) {
    console.error(chalk.red(`Error: Planning document not found: ${resolvedPath}`));
    process.exit(1);
  }

  const debug = options.debug || false;
  const iterations = parseInt(String(options.iterations || '3'), 10);

  try {
    // Step 1: Parse the planning document
    console.log(chalk.cyan('Step 1: Parsing planning document...'));
    const parser = new PlanningDocParser(debug);
    const parsedDoc = await parser.parse(resolvedPath);

    if (debug) {
      console.log(chalk.gray(`  Parsed: ${parsedDoc.prdId} v${parsedDoc.version}`));
      console.log(chalk.gray(`  Phases: ${parsedDoc.phases.length}`));
      console.log(chalk.gray(`  Config overlays: ${Object.keys(parsedDoc.configOverlay || {}).length}`));
    }

    // Step 2: Determine output directory
    const setId = options.setId || parsedDoc.prdId;
    const outputDir = options.outputDir ||
      path.join(process.cwd(), '.taskmaster', 'planning', `${setId}-prd-set`);

    console.log(chalk.cyan(`Step 2: Output directory: ${outputDir}`));

    // Check if output directory exists
    if (await fs.pathExists(outputDir)) {
      if (!options.force && !options.validateOnly) {
        console.error(chalk.red(`Error: Output directory already exists: ${outputDir}`));
        console.error(chalk.yellow('Use --force to overwrite'));
        process.exit(1);
      }
    }

    // Step 3: Validate parsed structure
    console.log(chalk.cyan('Step 3: Validating parsed structure...'));
    const validationResult = validateParsedDoc(parsedDoc);

    if (!validationResult.valid) {
      console.error(chalk.red('Validation failed:'));
      validationResult.errors.forEach(err => console.error(chalk.red(`  ✗ ${err}`)));
      process.exit(1);
    }

    if (validationResult.warnings.length > 0) {
      console.log(chalk.yellow('Warnings:'));
      validationResult.warnings.forEach(warn => console.log(chalk.yellow(`  ⚠ ${warn}`)));
    }

    console.log(chalk.green('  ✓ Validation passed'));

    // Step 4: Validate config overlay if present
    if (parsedDoc.configOverlay && Object.keys(parsedDoc.configOverlay).length > 0) {
      console.log(chalk.cyan('Step 4: Validating config overlay...'));
      const overlayValidation = validateConfigOverlay(parsedDoc.configOverlay, 'prd');

      if (!overlayValidation.valid) {
        console.error(chalk.red('Config overlay validation failed:'));
        overlayValidation.errors.forEach(err => console.error(chalk.red(`  ✗ ${err}`)));
        process.exit(1);
      }

      if (overlayValidation.warnings.length > 0) {
        console.log(chalk.yellow('Config warnings:'));
        overlayValidation.warnings.forEach(warn => console.log(chalk.yellow(`  ⚠ ${warn}`)));
      }

      console.log(chalk.green('  ✓ Config overlay valid'));
    } else {
      console.log(chalk.gray('Step 4: No config overlay to validate'));
    }

    // If validate-only, stop here
    if (options.validateOnly) {
      console.log(chalk.green('\n✓ Validation complete (--validate-only mode)\n'));
      return;
    }

    // Step 5: Generate PRD set structure
    console.log(chalk.cyan('Step 5: Generating PRD set structure...'));
    const generator = new PrdSetGenerator(debug);
    const generatedFiles = await generator.generate(parsedDoc, outputDir, setId);

    console.log(chalk.green(`  ✓ Generated ${generatedFiles.length} files`));

    // Step 6: Write files to disk
    console.log(chalk.cyan('Step 6: Writing files to disk...'));

    await fs.ensureDir(outputDir);

    for (const file of generatedFiles) {
      const filePath = path.join(outputDir, file.filename);
      await fs.writeFile(filePath, file.content, 'utf-8');
      if (debug) {
        console.log(chalk.gray(`  Created: ${file.filename}`));
      }
    }

    console.log(chalk.green(`  ✓ Files written to ${outputDir}`));

    // Step 7: Validate generated PRD set
    console.log(chalk.cyan('Step 7: Validating generated PRD set...'));
    const discovery = new PrdSetDiscovery(debug);

    try {
      const discoveredSet = await discovery.discoverPrdSet(outputDir);
      console.log(chalk.green(`  ✓ PRD set valid: ${discoveredSet.setId}`));
      console.log(chalk.green(`  ✓ Found ${discoveredSet.prdSet.prds.length} PRDs`));
    } catch (error) {
      console.error(chalk.red(`  ✗ PRD set validation failed: ${error instanceof Error ? error.message : String(error)}`));
      console.error(chalk.yellow('  The files have been created but may need manual fixes'));
    }

    // Summary
    console.log(chalk.blue('\n📋 Conversion Summary\n'));
    console.log(`  Source: ${planningDocPath}`);
    console.log(`  Output: ${outputDir}`);
    console.log(`  PRD ID: ${setId}`);
    console.log(`  Files created: ${generatedFiles.length}`);
    console.log(`  Phases: ${parsedDoc.phases.length}`);

    if (parsedDoc.configOverlay && Object.keys(parsedDoc.configOverlay).length > 0) {
      console.log(`  Config overlays: ${Object.keys(parsedDoc.configOverlay).join(', ')}`);
    }

    console.log(chalk.green('\n✓ Conversion complete!\n'));
    console.log(chalk.cyan('Next steps:'));
    console.log(`  1. Review generated files in ${outputDir}`);
    console.log(`  2. Run: dev-loop validate-prd-set ${outputDir}`);
    console.log(`  3. Execute: dev-loop prd-set ${outputDir}`);

  } catch (error) {
    console.error(chalk.red(`\nConversion failed: ${error instanceof Error ? error.message : String(error)}`));
    if (debug && error instanceof Error && error.stack) {
      console.error(chalk.gray(error.stack));
    }
    process.exit(1);
  }
}

function validateParsedDoc(doc: ParsedPlanningDoc): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!doc.prdId) {
    errors.push('Missing PRD ID');
  }
  if (!doc.version) {
    errors.push('Missing version');
  }
  if (!doc.phases || doc.phases.length === 0) {
    errors.push('No phases defined');
  }

  // Phase validation
  if (doc.phases) {
    const phaseIds = new Set<number>();
    for (const phase of doc.phases) {
      if (phaseIds.has(phase.id)) {
        errors.push(`Duplicate phase ID: ${phase.id}`);
      }
      phaseIds.add(phase.id);

      if (!phase.name) {
        errors.push(`Phase ${phase.id} missing name`);
      }

      // Check dependencies reference valid phases
      if (phase.dependsOn) {
        for (const depId of phase.dependsOn) {
          if (!phaseIds.has(depId) && !doc.phases.some(p => p.id === depId)) {
            warnings.push(`Phase ${phase.id} depends on non-existent phase ${depId}`);
          }
        }
      }
    }
  }

  // Warnings for optional but recommended fields
  if (!doc.testing?.directory) {
    warnings.push('No testing directory specified');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

