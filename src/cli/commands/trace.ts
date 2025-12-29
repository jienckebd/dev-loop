import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from '../../core/task-bridge';

export async function traceCommand(options: {
  config?: string;
  taskId: string;
  tokens?: boolean;
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

    console.log(chalk.bold('\nExecution Trace\n'));
    console.log(chalk.gray('─'.repeat(80)));

    console.log(chalk.bold('Task:'), `${task.id} - ${task.title}`);
    console.log(chalk.bold('Status:'), task.status || 'pending');

    // Read logs to find execution trace
    if (config.logs.outputPath && await fs.pathExists(config.logs.outputPath)) {
      spinner.start('Reading execution logs');
      const logContent = await fs.readFile(config.logs.outputPath, 'utf-8');
      spinner.succeed('Logs loaded');

      // Extract log entries related to this task
      const lines = logContent.split('\n');
      const taskLogs = lines.filter(line =>
        line.includes(`Task: ${task.id}`) ||
        line.includes(`taskId: ${task.id}`) ||
        line.includes(`task ${task.id}`)
      );

      if (taskLogs.length > 0) {
        console.log(chalk.bold('\nExecution Log:\n'));
        taskLogs.forEach((line, idx) => {
          if (line.includes('[ERROR]')) {
            console.log(chalk.red(`${idx + 1}. ${line}`));
          } else if (line.includes('[WARN]')) {
            console.log(chalk.yellow(`${idx + 1}. ${line}`));
          } else if (line.includes('[INFO]')) {
            console.log(chalk.blue(`${idx + 1}. ${line}`));
          } else if (line.includes('[DEBUG]')) {
            console.log(chalk.gray(`${idx + 1}. ${line}`));
          } else if (line.includes('>>> AI REQUEST') || line.includes('<<< AI RESPONSE')) {
            console.log(chalk.cyan(`${idx + 1}. ${line}`));
          } else {
            console.log(`${idx + 1}. ${line}`);
          }
        });
      } else {
        console.log(chalk.yellow('\nNo execution logs found for this task'));
      }

      // Extract token usage if requested
      if (options.tokens) {
        const tokenLines = lines.filter(line =>
          line.includes('tokens') ||
          line.includes('token_usage') ||
          line.includes('Token usage')
        );

        if (tokenLines.length > 0) {
          console.log(chalk.bold('\nToken Usage:\n'));
          tokenLines.forEach(line => {
            console.log(chalk.cyan(`  ${line}`));
          });
        } else {
          console.log(chalk.gray('\nToken usage information not available'));
        }
      }
    } else {
      console.log(chalk.yellow('\nNo log file found'));
      console.log(chalk.gray('Run dev-loop to generate logs'));
    }

    // Show task details
    if (task.description) {
      console.log(chalk.bold('\nTask Description:\n'));
      console.log(task.description);
    }

    if ((task as any).testStrategy) {
      console.log(chalk.bold('\nTest Strategy:\n'));
      console.log((task as any).testStrategy);
    }

    console.log(chalk.gray('\n─'.repeat(80)));
  } catch (error) {
    spinner.fail('Failed to trace task');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
