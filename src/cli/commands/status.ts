import chalk from 'chalk';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from '../../core/execution/task-bridge';

export async function statusCommand(options: { config?: string }): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const taskBridge = new TaskMasterBridge(config);
    
    // Get status from task counts
    const allTasks = await taskBridge.getAllTasks();
    const pendingTasks = allTasks.filter((t: any) => t.status === 'pending');
    const completedTasks = allTasks.filter((t: any) => t.status === 'done');
    const inProgressTasks = allTasks.filter((t: any) => t.status === 'in-progress');
    
    const currentTask = inProgressTasks[0] || null;
    const totalTasks = allTasks.length;
    const completedCount = completedTasks.length;
    const progress = totalTasks > 0 ? completedCount / totalTasks : 0;
    const status = inProgressTasks.length > 0 ? 'running' : (pendingTasks.length > 0 ? 'idle' : 'complete');

    console.log(chalk.bold('\nWorkflow Status\n'));
    console.log(chalk.gray('─'.repeat(50)));

    if (currentTask) {
      console.log(chalk.cyan('Current Task:'));
      console.log(`  ID: ${chalk.yellow(currentTask.id)}`);
      console.log(`  Title: ${currentTask.title}`);
      console.log(`  Status: ${chalk.blue(currentTask.status)}`);
      console.log(`  Priority: ${currentTask.priority}`);
    } else {
      console.log(chalk.yellow('No active task'));
    }

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan('Progress:'));
    console.log(`  Status: ${chalk.blue(status)}`);
    console.log(`  Completed: ${chalk.green(completedCount)}/${chalk.yellow(totalTasks)}`);
    console.log(`  Progress: ${chalk.green(`${Math.round(progress * 100)}%`)}`);

    console.log(chalk.gray('─'.repeat(50)));
  } catch (error) {
    console.error(chalk.red('Failed to get status'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

