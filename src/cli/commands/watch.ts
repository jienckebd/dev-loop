import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { WorkflowEngine } from '../../core/workflow-engine';
import { PrdTracker } from '../../core/prd-tracker';
import { writePidFile, removePidFile } from './stop';
import { ChatRequestAutoProcessor } from '../../providers/ai/cursor-chat-auto-processor';
import { getReportGenerator, PrdExecutionReport } from '../../core/report-generator';
import { getParallelMetricsTracker } from '../../core/parallel-metrics';
import { ProgressTracker } from '../../core/progress-tracker';
import { PrdConfigParser } from '../../core/prd-config-parser';

export async function watchCommand(options: {
  config?: string;
  debug?: boolean;
  untilComplete?: boolean;
  maxIterations?: number;
}): Promise<void> {
  const spinner = ora('Loading configuration').start();
  const debug = options.debug || false;

  try {
    const config = await loadConfig(options.config);
    // Enable debug mode if flag is set OR if config has debug enabled
    if (debug || (config as any).debug) {
      (config as any).debug = true;
    }
    spinner.succeed('Configuration loaded');

    spinner.start('Initializing workflow engine');
    const engine = new WorkflowEngine(config);
    spinner.succeed('Workflow engine initialized');

    // CRITICAL FIX: Load PRD metadata from contribution mode and set target module
    // This ensures watch mode respects targetModule from PRD execution config
    const contributionModeFile = path.join(process.cwd(), '.devloop', 'contribution-mode.json');
    if (await fs.pathExists(contributionModeFile)) {
      try {
        const contributionState = await fs.readJson(contributionModeFile);
        if (contributionState.active && contributionState.prdPath) {
          const prdPath = contributionState.prdPath;
          const configParser = new PrdConfigParser(debug);
          const prdMetadata = await configParser.parsePrdMetadata(prdPath);
          
          // Set target module from PRD execution config
          if (prdMetadata?.execution?.targetModule) {
            (engine as any).currentPrdTargetModule = prdMetadata.execution.targetModule;
            if (debug) {
              console.log(chalk.cyan(`[Watch] Loaded target module from PRD: ${prdMetadata.execution.targetModule}`));
            }
          }
          
          // Also set PRD ID for better context
          if (prdMetadata?.prd?.id) {
            (engine as any).currentPrdId = prdMetadata.prd.id;
          }
        }
      } catch (error) {
        if (debug) {
          console.warn(`[Watch] Failed to load contribution mode PRD metadata: ${error}`);
        }
      }
    }

    // Initialize progress tracker
    const progressTracker = new ProgressTracker();

    // Set up progress event listeners
    progressTracker.on('task-start', (event) => {
      if (debug) {
        console.log(chalk.cyan(`[Progress] Task started: ${event.taskTitle}`));
      }
    });

    progressTracker.on('task-complete', (event) => {
      if (debug) {
        console.log(chalk.green(`[Progress] Task completed: ${event.taskTitle}`));
      }
    });

    progressTracker.on('task-fail', (event) => {
      console.log(chalk.red(`[Progress] Task failed: ${event.taskId} - ${event.error}`));
    });

    progressTracker.on('progress', (event) => {
      // Display progress bar periodically
      if (event.progress && event.progress % 10 === 0) {
        progressTracker.displayProgressBar();
      }
    });

    // NEW: Initialize and start chat auto-processor (after engine initialization, before loop)
    let chatProcessor: ChatRequestAutoProcessor | null = null;
    if ((config as any).cursor?.agents?.enabled !== false &&
        (config as any).cursor?.agents?.autoProcess !== false) {
      chatProcessor = new ChatRequestAutoProcessor(config);
      await chatProcessor.startWatching();
      console.log(chalk.cyan('Chat request auto-processor started'));
    }

    const prdTracker = options.untilComplete ? new PrdTracker(config) : null;
    const maxIterations = options.maxIterations || 1000;

    if (options.untilComplete) {
      console.log(chalk.cyan('Starting daemon mode (--until-complete: will exit when PRD is 100% complete)...'));
    } else {
      console.log(chalk.cyan('Starting daemon mode...'));
    }
    if (debug) {
      console.log(chalk.magenta('[DEBUG MODE ENABLED]'));
    }
    if (!options.untilComplete) {
      console.log(chalk.gray('Press Ctrl+C to stop, or run: npx dev-loop stop\n'));
    } else {
      console.log(chalk.gray('Will exit when all tasks complete and tests pass. Press Ctrl+C to stop early.\n'));
    }

    // Write PID file for stop command
    await writePidFile();

    let iteration = 0;
    let shouldContinue = true;
    let consecutiveNoTasks = 0;

    const shutdown = async () => {
      shouldContinue = false;
      console.log(chalk.yellow('\nShutting down gracefully...'));

      // NEW: Stop chat auto-processor (before removePidFile)
      if (chatProcessor) {
        await chatProcessor.stopWatching();
      }

      await removePidFile();
      engine.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    while (shouldContinue) {
      iteration++;

      // Check max iterations
      if (options.untilComplete && iteration > maxIterations) {
        console.log(chalk.red(`\nMax iterations (${maxIterations}) reached. Exiting.`));
        await removePidFile();
        process.exit(1);
      }

      const statusSpinner = ora(`Iteration ${iteration}: Running workflow`).start();

      try {
        const result = await engine.runOnce();

        if (result.completed) {
          consecutiveNoTasks = 0;
          statusSpinner.succeed(`Iteration ${iteration}: Task completed`);
          console.log(chalk.green(`  ✓ Task: ${result.taskId || 'N/A'}`));
        } else if (result.noTasks) {
          consecutiveNoTasks++;
          statusSpinner.info(`Iteration ${iteration}: No pending tasks`);

          // When --until-complete is set, check if PRD is actually complete
          if (options.untilComplete && prdTracker) {
            const isComplete = await prdTracker.isComplete();
            if (isComplete) {
              statusSpinner.succeed('PRD is 100% complete!');
              console.log(chalk.green('\n╔════════════════════════════════════════════════════════════╗'));
              console.log(chalk.green('║         ✓ PRD COMPLETE - All tasks done, tests passing      ║'));
              console.log(chalk.green('╚════════════════════════════════════════════════════════════╝\n'));

              const status = await prdTracker.getCompletionStatus();

              // Complete parallel metrics tracking and generate report
              const parallelMetrics = getParallelMetricsTracker();
              const executionMetrics = parallelMetrics.completeExecution();

              // Generate execution report
              try {
                const reportGenerator = getReportGenerator();
                const reportPath = await reportGenerator.generateReport(
                  'prd-execution',
                  'PRD Execution',
                  {
                    total: status.totalTasks,
                    completed: status.completedTasks,
                    failed: 0,
                    blocked: status.blockedTasks,
                  },
                  undefined,
                  executionMetrics || undefined
                );

                // Display summary
                console.log(chalk.cyan('Final Status:'));
                console.log(`  Total Tasks: ${status.totalTasks}`);
                console.log(`  Completed: ${status.completedTasks} (${status.percentComplete}%)`);
                console.log(`  Tests Passing: ${status.testsPassing ? chalk.green('Yes') : chalk.red('No')}`);

                if (executionMetrics) {
                  console.log('');
                  console.log(chalk.cyan('Parallel Execution:'));
                  console.log(`  Max Concurrency: ${executionMetrics.concurrency.maxConcurrent} agents`);
                  console.log(`  Parallel Efficiency: ${(executionMetrics.coordination.parallelEfficiency * 100).toFixed(1)}%`);
                  console.log(`  Total Agents: ${executionMetrics.agents.length}`);
                  console.log('');
                  console.log(chalk.cyan('Token Usage:'));
                  const totalTokens = executionMetrics.tokens.totalInput + executionMetrics.tokens.totalOutput;
                  console.log(`  Total: ${totalTokens.toLocaleString()} tokens`);
                  console.log(`  Input: ${executionMetrics.tokens.totalInput.toLocaleString()}`);
                  console.log(`  Output: ${executionMetrics.tokens.totalOutput.toLocaleString()}`);
                }

                console.log('');
                console.log(chalk.green(`Report saved to: ${reportPath}`));
              } catch (reportError) {
                console.warn(chalk.yellow(`Failed to generate report: ${reportError}`));
                // Still show basic status
                console.log(chalk.cyan('Final Status:'));
                console.log(`  Total Tasks: ${status.totalTasks}`);
                console.log(`  Completed: ${status.completedTasks} (${status.percentComplete}%)`);
                console.log(`  Tests Passing: ${status.testsPassing ? chalk.green('Yes') : chalk.red('No')}\n`);
              }

              await removePidFile();
              process.exit(0);
            } else {
              const status = await prdTracker.getCompletionStatus();
              console.log(chalk.yellow(`  Tasks complete, but tests not passing or blocked tasks exist.`));
              console.log(chalk.yellow(`  Pending: ${status.pendingTasks}, Blocked: ${status.blockedTasks}, Tests: ${status.testsPassing ? 'Passing' : 'Failing'}`));

              // Wait a bit longer before checking again when tests are failing
              await new Promise((resolve) => setTimeout(resolve, 10000));
            }
          } else {
            console.log(chalk.yellow('  All tasks completed! Waiting for new tasks...'));
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before next check
          }
        } else {
          consecutiveNoTasks = 0;
          statusSpinner.warn(`Iteration ${iteration}: Issues encountered`);
          if (result.error) {
            console.error(chalk.red(`  Error: ${result.error}`));
          }
          await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
        }
      } catch (error) {
        consecutiveNoTasks = 0;
        statusSpinner.fail(`Iteration ${iteration}: Failed`);
        console.error(chalk.red(`  Error: ${error instanceof Error ? error.message : String(error)}`));
        if (error instanceof Error && error.stack) {
          console.error(chalk.gray(`  Stack: ${error.stack}`));
        }
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before retry
      }
    }
  } catch (error) {
    spinner.fail('Failed to start watch mode');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

