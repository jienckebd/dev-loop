import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from "../../core/execution/task-bridge";
import { LogAnalyzerFactory } from '../../providers/log-analyzers/factory';

export async function diagnoseCommand(options: {
  config?: string;
  taskId?: string;
  suggest?: boolean;
  autoFix?: boolean;
}): Promise<void> {
  const spinner = ora('Loading configuration').start();

  try {
    const config = await loadConfig(options.config);
    spinner.succeed('Configuration loaded');

    if (options.taskId) {
      // Diagnose specific task
      spinner.start(`Analyzing task ${options.taskId}`);
      const taskBridge = new TaskMasterBridge(config);
      const task = await taskBridge.getTask(options.taskId);

      if (!task) {
        spinner.fail(`Task not found: ${options.taskId}`);
        console.error(chalk.red(`Task ${options.taskId} does not exist`));
        process.exit(1);
      }

      spinner.succeed(`Analyzed task ${options.taskId}`);

      console.log(chalk.bold('\nTask Analysis\n'));
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

      if (task.status === 'blocked') {
        console.log(chalk.red('\nIssues detected:'));

        if (task.description) {
          // Try to extract error information from description
          const errorMatches = task.description.match(/Error:?\s*(.+?)(?:\n\n|$)/is);
          if (errorMatches) {
            console.log(chalk.red(`  ${errorMatches[1].substring(0, 200)}`));
          }
        }

        // Analyze logs if available
        if (config.logs.outputPath && await fs.pathExists(config.logs.outputPath)) {
          spinner.start('Analyzing logs');
          const logContent = await fs.readFile(config.logs.outputPath, 'utf-8');
          const analyzer = LogAnalyzerFactory.create(config);
          const analysis = await analyzer.analyze([{ type: 'file', path: config.logs.outputPath }]);
          spinner.succeed('Log analysis complete');

          if (analysis.errors.length > 0) {
            console.log(chalk.red('\nErrors found in logs:'));
            analysis.errors.slice(0, 5).forEach((error) => {
              console.log(chalk.red(`  • ${error}`));
            });
          }

          if (analysis.warnings.length > 0) {
            console.log(chalk.yellow('\nWarnings:'));
            analysis.warnings.slice(0, 5).forEach((warning) => {
              console.log(chalk.yellow(`  • ${warning}`));
            });
          }

          if (analysis.recommendations && analysis.recommendations.length > 0 && options.suggest) {
            console.log(chalk.cyan('\nSuggestions:'));
            analysis.recommendations.forEach((rec) => {
              console.log(chalk.gray(`  • ${rec}`));
            });
          }
        }

        if (options.autoFix) {
          spinner.info('Auto-fix would attempt to:');
          console.log(chalk.gray('  1. Reset task to pending'));
          console.log(chalk.gray('  2. Re-run with additional context'));
          console.log(chalk.gray('  3. Apply learned patterns'));
          // TODO: Implement auto-fix
        }
      } else {
        console.log(chalk.green('\nNo issues detected for this task'));
      }

      console.log(chalk.gray('\n─'.repeat(80)));
    } else {
      // Diagnose recent failures
      spinner.start('Analyzing recent failures');
      const taskBridge = new TaskMasterBridge(config);
      const allTasks = await taskBridge.getAllTasks();
      const failedTasks = allTasks.filter(t => t.status === 'blocked');

      spinner.succeed(`Found ${failedTasks.length} failed/blocked tasks`);

      console.log(chalk.bold('\nFailure Analysis\n'));
      console.log(chalk.gray('─'.repeat(80)));

      if (failedTasks.length === 0) {
        console.log(chalk.green('No failed tasks found'));
        return;
      }

      console.log(chalk.red(`Total blocked/failed tasks: ${failedTasks.length}\n`));

      for (const task of failedTasks.slice(0, 10)) {
        console.log(chalk.bold(`${task.id}: ${task.title}`));
        console.log(chalk.gray(`  Status: ${task.status}`));
        if (task.description) {
          const errorMatch = task.description.match(/Error:?\s*(.+?)(?:\n\n|$)/is);
          if (errorMatch) {
            console.log(chalk.red(`  Error: ${errorMatch[1].substring(0, 100)}...`));
          }
        }
        console.log('');
      }

      if (failedTasks.length > 10) {
        console.log(chalk.gray(`... and ${failedTasks.length - 10} more`));
      }

      if (options.suggest) {
        console.log(chalk.cyan('\nCommon patterns:'));
        console.log(chalk.gray('  • Review error messages for syntax errors'));
        console.log(chalk.gray('  • Check task dependencies'));
        console.log(chalk.gray('  • Verify file paths and permissions'));
        console.log(chalk.gray('  • Run with --debug for verbose output'));
      }
    }
  } catch (error) {
    spinner.fail('Failed to diagnose');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
