import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from '../../core/execution/task-bridge';
import { IterationRunner } from '../../core/execution/iteration-runner';

export async function replayCommand(options: {
  config?: string;
  taskId: string;
  dryRun?: boolean;
}): Promise<void> {
  const spinner = ora('Loading configuration').start();

  try {
    const config = await loadConfig(options.config);
    const taskBridge = new TaskMasterBridge(config);

    const task = await taskBridge.getTask(options.taskId);
    if (!task) {
      spinner.fail(`Task not found: ${options.taskId}`);
      console.error(chalk.red(`Task ${options.taskId} does not exist`));
      process.exit(1);
    }

    spinner.succeed('Configuration loaded');

    if (options.dryRun) {
      spinner.info('Dry run mode - no changes will be made');
      console.log(chalk.bold('\nTask to replay:'));
      console.log(`  ID: ${task.id}`);
      console.log(`  Title: ${task.title}`);
      console.log(`  Status: ${task.status}`);
      console.log(chalk.gray('\nThis would reset the task to pending and re-run it.'));
      return;
    }

    // Reset task to pending
    spinner.start('Resetting task to pending');
    await taskBridge.updateTaskStatus(task.id, 'pending');
    spinner.succeed('Task reset to pending');

    // Run with fresh-context mode
    spinner.start('Re-running task with fresh-context mode');
    const iterationRunner = new IterationRunner(config, {
      maxIterations: 1, // Only run once for replay
      autoHandoff: false,
    });
    const result = await iterationRunner.runWithFreshContext();

    if (result.status === 'complete') {
      spinner.succeed('Task replayed successfully');
      console.log(chalk.green(`✓ Task ${options.taskId} completed`));
    } else {
      spinner.warn('Task replay finished with issues');
      if (result.error) {
        console.error(chalk.red(`Error: ${result.error}`));
      }
    }
  } catch (error) {
    spinner.fail('Failed to replay task');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
