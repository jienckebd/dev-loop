import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { DebugMetrics } from '../../core/debug-metrics';

export async function metricsCommand(options: {
  config?: string;
  last?: number;
  task?: number;
  summary?: boolean;
  json?: boolean;
  clear?: boolean;
}): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const metricsPath = (config as any).metrics?.path || '.devloop/metrics.json';
    const metrics = new DebugMetrics(metricsPath);

    if (options.clear) {
      metrics.clear();
      console.log(chalk.green('✓ Metrics cleared'));
      return;
    }

    const metricsData = metrics.getMetrics();

    if (options.json) {
      console.log(JSON.stringify(metricsData, null, 2));
      return;
    }

    if (options.summary) {
      printSummary(metricsData);
      return;
    }

    if (options.task) {
      const taskRuns = metrics.getRunsForTask(options.task);
      if (taskRuns.length === 0) {
        console.log(chalk.yellow(`No metrics found for task ${options.task}`));
        return;
      }
      printTaskRuns(taskRuns, options.task);
      return;
    }

    if (options.last) {
      const lastRuns = metrics.getLastNRuns(options.last);
      printRecentRuns(lastRuns, metricsData.summary);
      return;
    }

    // Default: show summary + recent runs
    printSummary(metricsData);
    console.log('');
    const recentRuns = metrics.getLastNRuns(10);
    printRecentRuns(recentRuns, metricsData.summary);
  } catch (error) {
    console.error(chalk.red(`Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function printSummary(summary: any): void {
  console.log(chalk.cyan.bold('📊 Dev-Loop Metrics Summary'));
  console.log(chalk.gray('='.repeat(60)));
  console.log(`Total runs: ${chalk.white.bold(summary.summary.totalRuns)}`);
  console.log(`Success rate: ${chalk.white.bold((summary.summary.successRate * 100).toFixed(1))}%`);
  console.log('');
  console.log(chalk.cyan('Timing (avg):'));
  console.log(`  AI Call:     ${formatDuration(summary.summary.avgAiCallMs)}`);
  console.log(`  Test Run:    ${formatDuration(summary.summary.avgTestRunMs)}`);
  console.log('');
  console.log(chalk.cyan('Tokens (total):'));
  console.log(`  Input:  ${summary.summary.totalTokensInput.toLocaleString()}`);
  console.log(`  Output: ${summary.summary.totalTokensOutput.toLocaleString()}`);
}

function printRecentRuns(runs: any[], summary: any): void {
  if (runs.length === 0) {
    console.log(chalk.yellow('No runs recorded yet'));
    return;
  }

  console.log(chalk.cyan.bold('Recent Runs:'));

  // Calculate success rate from runs
  const completed = runs.filter(r => r.status === 'completed').length;
  const attempted = runs.filter(r => r.status !== 'pending').length;
  const successRate = attempted > 0 ? (completed / attempted * 100).toFixed(1) : '0.0';

  console.log(chalk.gray(`  Success rate: ${successRate}% (${completed}/${attempted} completed)`));
  console.log('');

  // Table header
  console.log(chalk.gray('┌────────┬──────────────────────────────────────┬──────────┬─────────┬────────┐'));
  console.log(chalk.gray('│ Task   │ Title                               │ Status   │ AI Time │ Tokens │'));
  console.log(chalk.gray('├────────┼──────────────────────────────────────┼──────────┼─────────┼────────┤'));

  for (const run of runs) {
    const taskId = run.taskId?.toString().padEnd(6) || 'N/A  ';
    const title = (run.taskTitle || 'N/A').substring(0, 36).padEnd(36);
    const status = run.status === 'completed'
      ? chalk.green('✓ done  ')
      : run.status === 'failed'
      ? chalk.red('✗ failed')
      : chalk.yellow('○ pending');
    const aiTime = run.timing?.aiCallMs ? formatDuration(run.timing.aiCallMs) : '-     ';
    const tokens = run.tokens?.input && run.tokens?.output
      ? `${((run.tokens.input + run.tokens.output) / 1000).toFixed(1)}k`.padEnd(7)
      : '-     ';

    console.log(chalk.gray('│ ') + taskId + chalk.gray(' │ ') + title + chalk.gray(' │ ') + status + chalk.gray(' │ ') + aiTime + chalk.gray(' │ ') + tokens + chalk.gray(' │'));
  }

  console.log(chalk.gray('└────────┴──────────────────────────────────────┴──────────┴─────────┴────────┘'));
}

function printTaskRuns(runs: any[], taskId: number): void {
  console.log(chalk.cyan.bold(`Metrics for Task ${taskId}:`));
  console.log(chalk.gray('='.repeat(60)));

  for (const run of runs) {
    console.log('');
    console.log(chalk.gray(`Run at ${run.timestamp}`));
    console.log(`  Status: ${run.status === 'completed' ? chalk.green('✓ completed') : run.status === 'failed' ? chalk.red('✗ failed') : chalk.yellow('○ pending')}`);

    if (run.timing) {
      console.log(chalk.cyan('  Timing:'));
      if (run.timing.aiCallMs) console.log(`    AI Call: ${formatDuration(run.timing.aiCallMs)}`);
      if (run.timing.testRunMs) console.log(`    Test Run: ${formatDuration(run.timing.testRunMs)}`);
      if (run.timing.logAnalysisMs) console.log(`    Log Analysis: ${formatDuration(run.timing.logAnalysisMs)}`);
      if (run.timing.totalMs) console.log(`    Total: ${formatDuration(run.timing.totalMs)}`);
    }

    if (run.tokens) {
      console.log(chalk.cyan('  Tokens:'));
      if (run.tokens.input) console.log(`    Input: ${run.tokens.input.toLocaleString()}`);
      if (run.tokens.output) console.log(`    Output: ${run.tokens.output.toLocaleString()}`);
    }

    if (run.patches) {
      console.log(chalk.cyan('  Patches:'));
      if (run.patches.attempted) console.log(`    Attempted: ${run.patches.attempted}`);
      if (run.patches.succeeded) console.log(`    Succeeded: ${run.patches.succeeded}`);
      if (run.patches.failed) console.log(`    Failed: ${run.patches.failed}`);
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
