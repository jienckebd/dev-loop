import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { WorkflowEngine } from '../../core/execution/workflow';
import { TaskMasterBridge } from '../../core/execution/task-bridge';
import { IterationRunner } from '../../core/execution/iteration-runner';

export async function runCommand(options: {
  config?: string;
  debug?: boolean;
  task?: string;
  all?: boolean;
  until?: string;
  skip?: string;
  legacy?: boolean;
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

    spinner.start('Initializing workflow engine');
    const engine = new WorkflowEngine(config);
    spinner.succeed('Workflow engine initialized');

    // Handle --task option: run specific task
    if (options.task) {
      const taskBridge = new TaskMasterBridge(config);
      const task = await taskBridge.getTask(options.task);
      if (!task) {
        spinner.fail(`Task not found: ${options.task}`);
        console.error(chalk.red(`Task ${options.task} does not exist`));
        process.exit(1);
      }

      // Ensure task is pending
      if (task.status !== 'pending' && task.status !== 'in-progress') {
        await taskBridge.updateTaskStatus(task.id, 'pending');
      }

      spinner.start(`Running task ${options.task}`);
      const result = await engine.runOnce();

      if (result.completed) {
        spinner.succeed(`Task ${options.task} completed`);
        console.log(chalk.green(`✓ Task completed: ${result.taskId || options.task}`));
      } else {
        spinner.warn(`Task ${options.task} finished with issues`);
        if (result.error) {
          console.error(chalk.red(`Error: ${result.error}`));
        }
      }
      return;
    }

    // Handle --all option: run all pending tasks
    if (options.all) {
      const taskBridge = new TaskMasterBridge(config);
      let completedCount = 0;
      let failedCount = 0;

      while (true) {
        const pendingTasks = await taskBridge.getPendingTasks();
        if (pendingTasks.length === 0) {
          break;
        }

        spinner.start(`Running task ${pendingTasks[0].id} (${pendingTasks.length} remaining)`);
        const result = await engine.runOnce();

        if (result.completed) {
          completedCount++;
          spinner.succeed(`Task ${result.taskId} completed (${completedCount} completed, ${pendingTasks.length - 1} remaining)`);
        } else if (result.noTasks) {
          break;
        } else {
          failedCount++;
          spinner.warn(`Task failed (${failedCount} failed, ${pendingTasks.length - 1} remaining)`);
          if (result.error) {
            console.error(chalk.red(`Error: ${result.error}`));
          }
        }
      }

      console.log(chalk.bold(`\nCompleted: ${completedCount} tasks`));
      if (failedCount > 0) {
        console.log(chalk.red(`Failed: ${failedCount} tasks`));
      }
      return;
    }

    // Default: use fresh-context mode (IterationRunner)
    // Legacy mode available with --legacy flag
    if (options.legacy) {
      console.log(chalk.yellow('[DEPRECATED] Legacy mode is deprecated. Fresh-context mode is recommended.'));
      spinner.start('Running workflow iteration (legacy mode)');
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
    } else {
      // Fresh-context mode (default)
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
    }
  } catch (error) {
    spinner.fail('Failed to run workflow');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

