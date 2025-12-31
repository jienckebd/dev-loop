import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { WorkflowEngine } from '../../core/workflow-engine';
import { PrdConfigParser } from '../../core/prd-config-parser';

export async function prdCommand(options: {
  prd: string;
  config?: string;
  debug?: boolean;
  resume?: boolean;
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

    spinner.start('Initializing workflow engine');
    const engine = new WorkflowEngine(config);
    spinner.succeed('Workflow engine initialized');

    console.log(chalk.cyan(`Starting autonomous PRD execution: ${options.prd}`));
    if (options.resume) {
      console.log(chalk.yellow('Resuming from previous state...'));
    }

    const result = await engine.runAutonomousPrd(prdPath);

    console.log('\n');

    if (result.status === 'complete') {
      console.log(chalk.green('╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.green('║              ✓ PRD COMPLETE - All tests passing           ║'));
      console.log(chalk.green('╚════════════════════════════════════════════════════════════╝'));
      console.log('');
      console.log(chalk.cyan('Final Status:'));
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Tests: ${chalk.green(result.testsPassing)}/${result.testsTotal} passing`);
      console.log(`  PRD ID: ${result.prdId}`);
      console.log('');
    } else if (result.status === 'blocked') {
      console.log(chalk.red('╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.red('║         ⚠ PRD BLOCKED - Human intervention needed           ║'));
      console.log(chalk.red('╚════════════════════════════════════════════════════════════╝'));
      console.log('');
      console.log(chalk.yellow('Execution appears stuck or max iterations reached.'));
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Tests: ${result.testsPassing}/${result.testsTotal} passing`);
      console.log(`  PRD ID: ${result.prdId}`);
      console.log('');
      console.log(chalk.cyan('Review context:'));
      console.log(`  .devloop/prd-context/${result.prdId}.json`);
      console.log('');
      process.exit(1);
    } else {
      console.log(chalk.yellow(`PRD execution ${result.status}`));
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Tests: ${result.testsPassing}/${result.testsTotal} passing`);
    }
  } catch (error) {
    spinner.fail('Failed to execute PRD');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
