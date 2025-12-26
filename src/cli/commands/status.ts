import chalk from 'chalk';
import { loadConfig } from '../../config/loader';
import { StateManager } from '../../core/state-manager';

export async function statusCommand(options: { config?: string }): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const stateManager = new StateManager(config);

    const state = await stateManager.getWorkflowState();

    console.log(chalk.bold('\nWorkflow Status\n'));
    console.log(chalk.gray('─'.repeat(50)));

    if (state.currentTask) {
      console.log(chalk.cyan('Current Task:'));
      console.log(`  ID: ${chalk.yellow(state.currentTask.id)}`);
      console.log(`  Title: ${state.currentTask.title}`);
      console.log(`  Status: ${chalk.blue(state.currentTask.status)}`);
      console.log(`  Priority: ${state.currentTask.priority}`);
    } else {
      console.log(chalk.yellow('No active task'));
    }

    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan('Progress:'));
    console.log(`  Status: ${chalk.blue(state.status)}`);
    console.log(`  Completed: ${chalk.green(state.completedTasks)}/${chalk.yellow(state.totalTasks)}`);
    console.log(`  Progress: ${chalk.green(`${Math.round(state.progress * 100)}%`)}`);

    console.log(chalk.gray('─'.repeat(50)));
  } catch (error) {
    console.error(chalk.red('Failed to get status'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

