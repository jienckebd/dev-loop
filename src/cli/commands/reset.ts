import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from "../../core/execution/task-bridge";

export async function resetCommand(options: {
  config?: string;
  taskId?: string;
  allFailed?: boolean;
  all?: boolean;
}): Promise<void> {
  const spinner = ora('Loading configuration').start();

  try {
    const config = await loadConfig(options.config);
    const taskBridge = new TaskMasterBridge(config);
    spinner.succeed('Configuration loaded');

    if (options.taskId) {
      // Reset specific task
      spinner.start(`Resetting task ${options.taskId}`);
      const task = await taskBridge.getTask(options.taskId);
      if (!task) {
        spinner.fail(`Task not found: ${options.taskId}`);
        console.error(chalk.red(`Task ${options.taskId} does not exist`));
        process.exit(1);
      }

      await taskBridge.updateTaskStatus(options.taskId, 'pending');
      spinner.succeed(`Task ${options.taskId} reset to pending`);
      console.log(chalk.green(`✓ Task "${task.title}" is now pending`));
      return;
    }

    if (options.allFailed) {
      // Reset all blocked tasks
      spinner.start('Finding blocked tasks');
      const allTasks = await taskBridge.getAllTasks();
      const blockedTasks = allTasks.filter(t => t.status === 'blocked');

      if (blockedTasks.length === 0) {
        spinner.info('No blocked tasks found');
        return;
      }

      spinner.text = `Resetting ${blockedTasks.length} blocked tasks`;
      for (const task of blockedTasks) {
        await taskBridge.updateTaskStatus(task.id, 'pending');
      }
      spinner.succeed(`Reset ${blockedTasks.length} blocked tasks to pending`);

      console.log(chalk.green(`\nReset tasks:`));
      for (const task of blockedTasks) {
        console.log(`  - ${task.id}: ${task.title}`);
      }
      return;
    }

    if (options.all) {
      // Reset all tasks
      spinner.start('Resetting all tasks');
      const allTasks = await taskBridge.getAllTasks();
      const nonPendingTasks = allTasks.filter(t => t.status !== 'pending');

      if (nonPendingTasks.length === 0) {
        spinner.info('All tasks are already pending');
        return;
      }

      for (const task of nonPendingTasks) {
        await taskBridge.updateTaskStatus(task.id, 'pending');
      }
      spinner.succeed(`Reset ${nonPendingTasks.length} tasks to pending`);
      return;
    }

    // No options provided - show help
    console.log(chalk.bold('\nUsage:'));
    console.log('  dev-loop reset <taskId>     Reset specific task to pending');
    console.log('  dev-loop reset --all-failed Reset all blocked tasks');
    console.log('  dev-loop reset --all        Reset all tasks to pending');

  } catch (error) {
    spinner.fail('Failed to reset tasks');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
