import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { WorkflowEngine } from '../../core/workflow-engine';
import { writePidFile, removePidFile } from './stop';

export async function watchCommand(options: { config?: string; debug?: boolean }): Promise<void> {
  const spinner = ora('Loading configuration').start();
  const debug = options.debug || false;

  try {
    const config = await loadConfig(options.config);
    // Enable debug mode if flag is set OR if config has debug enabled
    if (debug || (config as any).debug) {
      (config as any).debug = true;
    }
    spinner.succeed('Configuration loaded');

    spinner.start('Initializing workflow engine');
    const engine = new WorkflowEngine(config);
    spinner.succeed('Workflow engine initialized');

    console.log(chalk.cyan('Starting daemon mode...'));
    if (debug) {
      console.log(chalk.magenta('[DEBUG MODE ENABLED]'));
    }
    console.log(chalk.gray('Press Ctrl+C to stop, or run: npx dev-loop stop\n'));

    // Write PID file for stop command
    await writePidFile();

    let iteration = 0;
    let shouldContinue = true;

    const shutdown = async () => {
      shouldContinue = false;
      console.log(chalk.yellow('\nShutting down gracefully...'));
      await removePidFile();
      engine.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    while (shouldContinue) {
      iteration++;
      const statusSpinner = ora(`Iteration ${iteration}: Running workflow`).start();

      try {
        const result = await engine.runOnce();

        if (result.completed) {
          statusSpinner.succeed(`Iteration ${iteration}: Task completed`);
          console.log(chalk.green(`  ✓ Task: ${result.taskId || 'N/A'}`));
        } else if (result.noTasks) {
          statusSpinner.info(`Iteration ${iteration}: No pending tasks`);
          console.log(chalk.yellow('  All tasks completed! Waiting for new tasks...'));
          await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before next check
        } else {
          statusSpinner.warn(`Iteration ${iteration}: Issues encountered`);
          if (result.error) {
            console.error(chalk.red(`  Error: ${result.error}`));
          }
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
        }
      } catch (error) {
        statusSpinner.fail(`Iteration ${iteration}: Failed`);
        console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
      }
    }
  } catch (error) {
    spinner.fail('Failed to start watch mode');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

