import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { TaskMasterBridge } from '../../core/task-bridge';

export async function validateCommand(options: {
  configPath?: string;
  checkConfig?: boolean;
  checkTasks?: boolean;
  checkEnvironment?: boolean;
  fix?: boolean;
}): Promise<void> {
  const spinner = ora('Validating').start();
  const issues: string[] = [];
  const warnings: string[] = [];

  try {
    // Validate configuration
    if (options.checkConfig || (!options.checkTasks && !options.checkEnvironment)) {
      spinner.text = 'Validating configuration';
      try {
        const config = await loadConfig(options.configPath);
        spinner.succeed('Configuration file loaded successfully');

        // Check required fields
        if (!(config as any).ai?.provider) {
          warnings.push('AI provider not configured');
        }
        if (!(config as any).ai?.model) {
          warnings.push('AI model not configured');
        }
        if (!config.taskMaster?.tasksPath) {
          warnings.push('Task master path not configured');
        }

        // Check log output path
        if (!(config as any).logs?.outputPath) {
          warnings.push('Log output path not configured - logging will be limited');
        }

      } catch (error) {
        issues.push(`Configuration error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Validate tasks
    if (options.checkTasks || (!options.checkConfig && !options.checkEnvironment)) {
      spinner.text = 'Validating tasks';
      try {
        const config = await loadConfig(options.configPath);
        const tasksPath = path.resolve(process.cwd(), config.taskMaster.tasksPath);

        if (await fs.pathExists(tasksPath)) {
          const taskBridge = new TaskMasterBridge(config);
          const tasks = await taskBridge.getAllTasks();

          if (tasks.length === 0) {
            warnings.push('No tasks found in tasks.json');
          } else {
            const pendingCount = tasks.filter(t => t.status === 'pending').length;
            const doneCount = tasks.filter(t => t.status === 'done').length;
            const blockedCount = tasks.filter(t => t.status === 'blocked').length;

            spinner.succeed(`Tasks validated: ${tasks.length} total (${pendingCount} pending, ${doneCount} done, ${blockedCount} blocked)`);

            // Check for orphan dependencies
            const taskIds = new Set(tasks.map(t => t.id.toString()));
            for (const task of tasks) {
              if (task.dependencies) {
                for (const depId of task.dependencies) {
                  if (!taskIds.has(depId.toString())) {
                    warnings.push(`Task ${task.id} has missing dependency: ${depId}`);
                  }
                }
              }
            }
          }
        } else {
          issues.push(`Tasks file not found: ${tasksPath}`);
        }
      } catch (error) {
        issues.push(`Tasks validation error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Validate environment
    if (options.checkEnvironment || (!options.checkConfig && !options.checkTasks)) {
      spinner.text = 'Validating environment';

      // Check Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
      if (majorVersion < 18) {
        issues.push(`Node.js version ${nodeVersion} is below minimum required (18+)`);
      } else if (majorVersion < 20) {
        warnings.push(`Node.js ${nodeVersion} works but 20+ is recommended`);
      } else {
        spinner.succeed(`Node.js ${nodeVersion} OK`);
      }

      // Check for API keys (skip for cursor provider)
      // Load config to check provider
      let config;
      try {
        config = await loadConfig(options.configPath);
      } catch (error) {
        // Config might not be available, skip provider check
        config = null;
      }

      const aiProvider = config ? (config as any).ai?.provider : null;
      if (aiProvider !== 'cursor') {
        if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
          warnings.push('No AI API key found in environment (ANTHROPIC_API_KEY or OPENAI_API_KEY)');
        }
      } else {
        // Cursor provider validation - uses direct MCP invocation, no files needed
        spinner.succeed('Cursor provider configured (uses direct MCP invocation, no API key needed)');
      }

      // Check .devloop directory
      const devloopDir = path.join(process.cwd(), '.devloop');
      if (!await fs.pathExists(devloopDir)) {
        if (options.fix) {
          await fs.ensureDir(devloopDir);
          spinner.succeed('Created .devloop directory');
        } else {
          warnings.push('.devloop directory does not exist (run with --fix to create)');
        }
      }
    }

    spinner.stop();

    // Display results
    console.log(chalk.bold('\nValidation Results\n'));
    console.log(chalk.gray('─'.repeat(60)));

    if (issues.length === 0 && warnings.length === 0) {
      console.log(chalk.green('✓ All checks passed'));
    } else {
      if (issues.length > 0) {
        console.log(chalk.red(`\nErrors (${issues.length}):`));
        issues.forEach(issue => console.log(chalk.red(`  ✗ ${issue}`)));
      }

      if (warnings.length > 0) {
        console.log(chalk.yellow(`\nWarnings (${warnings.length}):`));
        warnings.forEach(warning => console.log(chalk.yellow(`  ⚠ ${warning}`)));
      }
    }

    console.log(chalk.gray('\n─'.repeat(60)));

    if (issues.length > 0) {
      process.exit(1);
    }

  } catch (error) {
    spinner.fail('Validation failed');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
