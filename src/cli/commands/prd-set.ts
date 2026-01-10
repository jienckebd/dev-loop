import chalk from 'chalk';
import * as path from 'path';
import { PrdSetDiscovery } from "../../core/prd/set/discovery";
import { PrdSetValidator } from "../../core/prd/set/validator";
import { PrdSetOrchestrator } from "../../core/prd/set/orchestrator";
import { loadConfig } from '../../config/loader';

/**
 * PRD set execute command - One-shot execution for PRD sets
 * 
 * **Execution Mode**: One-shot (runs to completion)
 * **Use Case**: Multiple related PRDs orchestrated together
 * **Command**: `npx dev-loop prd-set execute <path>`
 * 
 * **How it works**:
 * - Executes once and runs until all PRDs in the set are complete
 * - PRD sets have defined completion criteria (all PRDs finished)
 * - Exits when execution completes (success or failure)
 * - Event streaming is active during execution
 * 
 * **When to use**:
 * - Working with multiple related PRDs
 * - PRDs have dependencies that need orchestration
 * - PRD set has defined completion criteria
 * - Want to execute all PRDs in a single command
 * 
 * **Why not daemon mode**: PRD sets orchestrate multiple PRDs and naturally complete
 * when all PRDs finish. Unlike single PRDs that may require continuous iteration,
 * PRD sets have defined completion criteria and don't need daemon mode.
 * 
 * **Not for**: Single PRDs (use `watch --until-complete` instead)
 * 
 * **See**: `docs/contributing/EXECUTION_MODES.md` for complete guide
 */
export async function prdSetExecuteCommand(options: {
  path: string;
  config?: string;
  debug?: boolean;
  parallel?: boolean;
  maxConcurrent?: number;
}): Promise<void> {
  const spinner = require('ora')('Loading configuration').start();
  const debug = options.debug || false;

  try {
    const config = await loadConfig(options.config);
    if (debug || (config as any).debug) {
      (config as any).debug = true;
    }
    spinner.succeed('Configuration loaded');

    spinner.start('Discovering PRD set');
    const discovery = new PrdSetDiscovery(debug);
    const discoveredSet = await discovery.discoverPrdSet(options.path);
    spinner.succeed(`PRD set discovered: ${discoveredSet.setId}`);

    spinner.start('Validating PRD set');
    const validator = new PrdSetValidator(debug);
    const validation = await validator.validatePrdSet(discoveredSet);

    if (!validation.success) {
      spinner.fail('PRD set validation failed');
      console.error(chalk.red('\nValidation Errors:'));
      validation.errors.forEach(err => console.error(chalk.red(`  ✗ ${err}`)));
      if (validation.warnings.length > 0) {
        console.error(chalk.yellow('\nWarnings:'));
        validation.warnings.forEach(warn => console.error(chalk.yellow(`  ⚠ ${warn}`)));
      }
      process.exit(1);
    }
    spinner.succeed('PRD set validation passed');

    console.log(chalk.cyan(`\nCreating tasks from PRD set: ${discoveredSet.setId}`));
    console.log(chalk.dim(`  PRDs in set: ${discoveredSet.prdSet.prds.length}`));
    console.log(chalk.dim(`  Parent PRD: ${discoveredSet.manifest.parentPrd.id}`));
    console.log(chalk.dim(`  Child PRDs: ${discoveredSet.manifest.childPrds.length}`));
    console.log(chalk.dim(`  Mode: Unified daemon (tasks created in Task Master, watch mode executes them)\n`));

    spinner.start('Initializing PRD set orchestrator');
    const orchestrator = new PrdSetOrchestrator(config, debug);
    spinner.succeed('Orchestrator initialized');

    spinner.start('Creating tasks from PRD set');
    const result = await orchestrator.executePrdSet(discoveredSet, {
      parallel: options.parallel ?? true,
      maxConcurrent: options.maxConcurrent ?? 2,
    });
    spinner.succeed(`Tasks created for ${result.completedPrds.length} PRD(s)`);

    console.log('\n');

    if (result.status === 'complete') {
      console.log(chalk.green('╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.green('║      ✓ PRD SET TASKS CREATED - All PRD tasks in Task Master  ║'));
      console.log(chalk.green('╚════════════════════════════════════════════════════════════╝'));
      console.log('');
      console.log(chalk.cyan('Task Creation Status:'));
      console.log(`  PRDs with tasks created: ${result.completedPrds.length}/${discoveredSet.prdSet.prds.length}`);
      console.log(`  Failed PRDs: ${result.failedPrds.length}`);
      console.log(`  Set ID: ${discoveredSet.setId}`);
      console.log('');
      console.log(chalk.yellow('Next Steps:'));
      console.log(`  1. Run: ${chalk.cyan('npx dev-loop watch --until-complete')}`);
      console.log(`  2. Watch mode daemon will execute tasks from Task Master`);
      console.log(`  3. Stop execution: ${chalk.cyan('npx dev-loop stop')}`);
      console.log('');
    } else if (result.status === 'blocked') {
      console.log(chalk.red('╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.red('║   ⚠ PRD SET TASK CREATION BLOCKED - Human intervention needed  ║'));
      console.log(chalk.red('╚════════════════════════════════════════════════════════════╝'));
      console.log('');
      console.log(chalk.yellow('Task creation blocked due to unresolved dependencies.'));
      console.log(`  PRDs with tasks created: ${result.completedPrds.length}/${discoveredSet.prdSet.prds.length}`);
      console.log(`  Failed PRDs: ${result.failedPrds.length}`);
      console.log(`  Set ID: ${discoveredSet.setId}`);
      if (result.errors.length > 0) {
        console.log('');
        console.log(chalk.red('Errors:'));
        result.errors.forEach(err => console.log(chalk.red(`  - ${err}`)));
      }
      console.log('');
      process.exit(1);
    } else {
      console.log(chalk.yellow(`PRD set task creation ${result.status}`));
      console.log(`  PRDs with tasks created: ${result.completedPrds.length}/${discoveredSet.prdSet.prds.length}`);
      if (result.errors.length > 0) {
        console.log('');
        console.log(chalk.red('Errors:'));
        result.errors.forEach(err => console.log(chalk.red(`  - ${err}`)));
      }
    }
  } catch (error) {
    spinner.fail('Failed to execute PRD set');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

/**
 * Get PRD set status
 */
export async function prdSetStatusCommand(options: {
  path: string;
  debug?: boolean;
}): Promise<void> {
  const debug = options.debug || false;

  try {
    const discovery = new PrdSetDiscovery(debug);
    const discoveredSet = await discovery.discoverPrdSet(options.path);

    // TODO: Load execution state and show status
    console.log(chalk.cyan(`\nPRD Set: ${discoveredSet.setId}`));
    console.log(chalk.dim(`  Index: ${discoveredSet.indexPath}`));
    console.log(chalk.dim(`  Directory: ${discoveredSet.directory}`));
    console.log(chalk.dim(`  Parent PRD: ${discoveredSet.manifest.parentPrd.id}`));
    console.log(chalk.dim(`  Child PRDs: ${discoveredSet.manifest.childPrds.length}`));
    console.log('');
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

/**
 * List all discovered PRD sets
 */
export async function prdSetListCommand(options: {
  planningDir?: string;
  debug?: boolean;
}): Promise<void> {
  const debug = options.debug || false;

  try {
    const discovery = new PrdSetDiscovery(debug);
    const sets = await discovery.listPrdSets(options.planningDir);

    if (sets.length === 0) {
      console.log(chalk.yellow('\nNo PRD sets found'));
      return;
    }

    console.log(chalk.cyan(`\nDiscovered PRD Sets (${sets.length}):\n`));
    for (const set of sets) {
      console.log(chalk.cyan(`  ${set.setId}`));
      console.log(chalk.dim(`    Index: ${set.indexPath}`));
      console.log(chalk.dim(`    PRDs: ${set.prdSet.prds.length}`));
      console.log('');
    }
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

/**
 * Validate PRD set without executing
 */
export async function prdSetValidateCommand(options: {
  path: string;
  debug?: boolean;
}): Promise<void> {
  const debug = options.debug || false;

  try {
    const spinner = require('ora')('Discovering PRD set').start();
    const discovery = new PrdSetDiscovery(debug);
    const discoveredSet = await discovery.discoverPrdSet(options.path);
    spinner.succeed('PRD set discovered');

    spinner.start('Validating PRD set');
    const validator = new PrdSetValidator(debug);
    const validation = await validator.validatePrdSet(discoveredSet);
    spinner.stop();

    console.log(chalk.blue(`\nValidating PRD Set: ${discoveredSet.setId}\n`));

    if (validation.success) {
      console.log(chalk.green('✓ PRD set validation passed!'));
      console.log(`\n  Set ID: ${discoveredSet.setId}`);
      console.log(`  PRDs: ${discoveredSet.prdSet.prds.length}`);
      console.log(`  Parent PRD: ${discoveredSet.manifest.parentPrd.id}`);
      console.log(`  Child PRDs: ${discoveredSet.manifest.childPrds.length}`);
      return;
    }

    // Report errors
    if (validation.errors.length > 0) {
      console.log(chalk.red(`\nErrors (${validation.errors.length}):`));
      validation.errors.forEach((err) => console.log(chalk.red(`  ✗ ${err}`)));
    }

    // Report warnings
    if (validation.warnings.length > 0) {
      console.log(chalk.yellow(`\nWarnings (${validation.warnings.length}):`));
      validation.warnings.forEach((warn) => console.log(chalk.yellow(`  ⚠ ${warn}`)));
    }

    console.log(chalk.red(`\nValidation failed with ${validation.errors.length} error(s)\n`));
    process.exit(validation.errors.length > 0 ? 1 : 0);
  } catch (error) {
    console.error(chalk.red(`Validation error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}






