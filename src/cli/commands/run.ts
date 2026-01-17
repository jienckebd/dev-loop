import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { IterationRunner } from '../../core/execution/iteration-runner';

export async function runCommand(options: {
  config?: string;
  debug?: boolean;
  maxIterations?: number;
  contextThreshold?: number;
  persistLearnings?: boolean;
  updatePatterns?: boolean;
}): Promise<void> {
  const spinner = ora('Loading configuration').start();

  try {
    const config = await loadConfig(options.config);
    // Enable debug mode if flag is set
    if (options.debug) {
      (config as any).debug = true;
    }
    spinner.succeed('Configuration loaded');

    // Use fresh-context mode (IterationRunner) - the default and only execution mode
    spinner.start('Running with fresh-context mode');

    const iterationRunner = new IterationRunner(config, {
      maxIterations: options.maxIterations || 100,
      contextThreshold: options.contextThreshold || 90,
      autoHandoff: true,
      persistLearnings: options.persistLearnings !== false,
      updatePatterns: options.updatePatterns !== false,
      handoffInterval: 5,
    });

    const result = await iterationRunner.runWithFreshContext();

    if (result.status === 'complete') {
      spinner.succeed(`All tasks completed in ${result.iterations} iteration(s)`);
      console.log(chalk.green(`✓ Tasks completed: ${result.tasksCompleted}`));
      if (result.patternsDiscovered > 0) {
        console.log(chalk.cyan(`  Patterns discovered: ${result.patternsDiscovered}`));
      }
    } else if (result.status === 'max-iterations') {
      spinner.warn(`Max iterations reached (${result.iterations})`);
      console.log(chalk.yellow(`Tasks completed: ${result.tasksCompleted}, Failed: ${result.tasksFailed}`));
    } else if (result.status === 'stalled') {
      spinner.warn('Workflow stalled');
      console.log(chalk.red(`Stalled after ${result.iterations} iterations. Check .devloop/progress.md for details.`));
    } else {
      spinner.fail('Workflow failed');
      if (result.error) {
        console.error(chalk.red(`Error: ${result.error}`));
      }
    }
  } catch (error) {
    spinner.fail('Failed to run workflow');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
