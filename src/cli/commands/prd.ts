import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { IterationRunner } from '../../core/execution/iteration-runner';
import { PrdConfigParser } from '../../core/prd/parser/config-parser';

export async function prdCommand(options: {
  prd: string;
  config?: string;
  debug?: boolean;
}): Promise<void> {
  const spinner = require('ora')('Loading configuration').start();
  const debug = options.debug || false;

  try {
    const config = await loadConfig(options.config);
    if (debug || (config as any).debug) {
      (config as any).debug = true;
    }
    spinner.succeed('Configuration loaded');

    const prdPath = path.resolve(process.cwd(), options.prd);

    if (!(await require('fs-extra').pathExists(prdPath))) {
      console.error(chalk.red(`PRD file not found: ${prdPath}`));
      process.exit(1);
    }

    // Check for PRD config overlay
    const configParser = new PrdConfigParser(debug);
    const prdConfigOverlay = await configParser.parsePrdConfig(prdPath);
    if (prdConfigOverlay) {
      const overlayKeys = Object.keys(prdConfigOverlay);
      console.log(chalk.green(`✓ PRD config overlay detected (${overlayKeys.length} section(s): ${overlayKeys.join(', ')})`));
      console.log(chalk.dim('  Configuration will be merged during PRD execution'));
    }

    console.log(chalk.cyan(`Starting PRD execution with fresh-context mode: ${options.prd}`));

    // Use IterationRunner for PRD execution
    const iterationRunner = new IterationRunner(config, {
      maxIterations: 100,
      autoHandoff: true,
      persistLearnings: true,
      updatePatterns: true,
    });

    const result = await iterationRunner.runWithFreshContext(prdPath);

    console.log('\n');

    if (result.status === 'complete') {
      console.log(chalk.green('╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.green('║              ✓ PRD COMPLETE - All tasks finished           ║'));
      console.log(chalk.green('╚════════════════════════════════════════════════════════════╝'));
      console.log('');
      console.log(chalk.cyan('Final Status:'));
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Tasks completed: ${result.tasksCompleted}`);
      console.log(`  Patterns discovered: ${result.patternsDiscovered}`);
      console.log('');
    } else if (result.status === 'max-iterations' || result.status === 'stalled') {
      console.log(chalk.red('╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.red('║         ⚠ PRD BLOCKED - Human intervention needed           ║'));
      console.log(chalk.red('╚════════════════════════════════════════════════════════════╝'));
      console.log('');
      console.log(chalk.yellow('Execution appears stuck or max iterations reached.'));
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Tasks completed: ${result.tasksCompleted}`);
      console.log(`  Tasks failed: ${result.tasksFailed}`);
      console.log('');
      console.log(chalk.cyan('Review context:'));
      console.log('  .devloop/progress.md');
      console.log('');
      process.exit(1);
    } else {
      console.log(chalk.yellow(`PRD execution ${result.status}`));
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Tasks completed: ${result.tasksCompleted}`);
      if (result.error) {
        console.error(chalk.red(`  Error: ${result.error}`));
      }
    }
  } catch (error) {
    spinner.fail('Failed to execute PRD');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
