import chalk from 'chalk';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from "../../core/execution/task-bridge";

export async function showCommand(options: {
  config?: string;
  taskId: string;
  history?: boolean;
}): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const taskBridge = new TaskMasterBridge(config);

    const task = await taskBridge.getTask(options.taskId);
    if (!task) {
      console.error(chalk.red(`Task not found: ${options.taskId}`));
      process.exit(1);
    }

    console.log(chalk.bold('\nTask Details\n'));
    console.log(chalk.gray('─'.repeat(80)));

    const statusColor = {
      'pending': chalk.yellow,
      'in-progress': chalk.blue,
      'blocked': chalk.red,
      'done': chalk.green,
    }[task.status || 'pending'] || chalk.white;

    console.log(chalk.bold('ID:'), task.id);
    console.log(chalk.bold('Title:'), task.title);
    console.log(chalk.bold('Status:'), statusColor(task.status || 'pending'));

    const priorityColor = {
      critical: chalk.red,
      high: chalk.yellow,
      medium: chalk.cyan,
      low: chalk.gray,
    }[task.priority || 'medium'] || chalk.white;
    console.log(chalk.bold('Priority:'), priorityColor(task.priority || 'medium'));

    if (task.description) {
      console.log(chalk.bold('\nDescription:'));
      console.log(task.description);
    }

    if (task.details) {
      console.log(chalk.bold('\nDetails:'));
      console.log(task.details);
    }

    if (task.dependencies && task.dependencies.length > 0) {
      console.log(chalk.bold('\nDependencies:'));
      for (const depId of task.dependencies) {
        const depTask = await taskBridge.getTask(depId.toString());
        if (depTask) {
          const depStatusColor = {
            'pending': chalk.yellow,
            'in-progress': chalk.blue,
            'blocked': chalk.red,
            'failed': chalk.red,
            'done': chalk.green,
          }[depTask.status || 'pending'] || chalk.white;
          console.log(`  - ${depId} ${depStatusColor(depTask.status || 'pending')} ${depTask.title}`);
        } else {
          console.log(`  - ${depId} ${chalk.gray('(not found)')}`);
        }
      }
    }

    if (task.subtasks && task.subtasks.length > 0) {
      console.log(chalk.bold('\nSubtasks:'));
      for (const subtask of task.subtasks) {
        const subtaskStatusColor = {
          'pending': chalk.yellow,
          'in-progress': chalk.blue,
          'blocked': chalk.red,
          'failed': chalk.red,
          'done': chalk.green,
        }[subtask.status || 'pending'] || chalk.white;
        console.log(`  - ${subtask.id} ${subtaskStatusColor(subtask.status || 'pending')} ${subtask.title}`);
      }
    }

    if ((task as any).testStrategy) {
      console.log(chalk.bold('\nTest Strategy:'));
      console.log((task as any).testStrategy);
    }

    if (options.history) {
      // TODO: Implement task history tracking
      console.log(chalk.bold('\nHistory:'));
      console.log(chalk.gray('History tracking not yet implemented'));
    }

    console.log(chalk.gray('\n─'.repeat(80)));

  } catch (error) {
    console.error(chalk.red(`Failed to show task: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
