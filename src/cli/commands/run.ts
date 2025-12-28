import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { WorkflowEngine } from '../../core/workflow-engine';

export async function runCommand(options: { config?: string; debug?: boolean }): Promise<void> {
  const spinner = ora('Loading configuration').start();

  try {
    const config = await loadConfig(options.config);
    // Enable debug mode if flag is set
    if (options.debug) {
      (config as any).debug = true;
    }
    spinner.succeed('Configuration loaded');

    spinner.start('Initializing workflow engine');
    const engine = new WorkflowEngine(config);
    spinner.succeed('Workflow engine initialized');

    spinner.start('Running workflow iteration');
    const result = await engine.runOnce();

    if (result.completed) {
      spinner.succeed('Workflow iteration completed');
      console.log(chalk.green(`✓ Task completed: ${result.taskId || 'N/A'}`));
    } else if (result.noTasks) {
      spinner.info('No pending tasks found');
      console.log(chalk.yellow('No tasks to process'));
    } else {
      spinner.warn('Workflow iteration finished with issues');
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

