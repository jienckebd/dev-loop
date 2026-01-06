import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { DebugMetrics } from '../../core/debug-metrics';
import { PrdSetMetrics } from '../../core/prd-set-metrics';
import { PrdMetrics } from '../../core/prd-metrics';
import { PhaseMetrics } from '../../core/phase-metrics';
import { FeatureTracker } from '../../core/feature-tracker';
import { SchemaTracker } from '../../core/schema-tracker';
import { CostCalculator } from '../../core/cost-calculator';

export async function metricsCommand(options: {
  config?: string;
  last?: number;
  task?: number;
  summary?: boolean;
  json?: boolean;
  clear?: boolean;
  prdSet?: string;
  prd?: string;
  phase?: string; // Format: "prdId:phaseId"
  compare?: string; // Format: "id1:id2"
  trends?: boolean;
  features?: boolean;
  schema?: boolean;
}): Promise<void> {
  try {
    const config = await loadConfig(options.config);

    // Handle hierarchical metrics
    if (options.prdSet) {
      await showPrdSetMetrics(options.prdSet, options.json);
      return;
    }

    if (options.prd) {
      await showPrdMetrics(options.prd, options.json);
      return;
    }

    if (options.phase) {
      const [prdId, phaseId] = options.phase.split(':');
      if (!prdId || !phaseId) {
        console.error(chalk.red('Phase format must be "prdId:phaseId"'));
        process.exit(1);
      }
      await showPhaseMetrics(prdId, parseInt(phaseId, 10), options.json);
      return;
    }

    if (options.compare) {
      const [id1, id2] = options.compare.split(':');
      if (!id1 || !id2) {
        console.error(chalk.red('Compare format must be "id1:id2"'));
        process.exit(1);
      }
      await compareMetrics(id1, id2, options.json);
      return;
    }

    if (options.trends) {
      await showTrends(options.json);
      return;
    }

    if (options.features) {
      await showFeatureMetrics(options.json);
      return;
    }

    if (options.schema) {
      await showSchemaMetrics(options.json);
      return;
    }

    // Original metrics command
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

// Hierarchical metrics display functions
async function showPrdSetMetrics(setId: string, json: boolean = false): Promise<void> {
  const prdSetMetrics = new PrdSetMetrics();
  const metrics = prdSetMetrics.getPrdSetMetrics(setId);

  if (!metrics) {
    console.error(chalk.red(`PRD Set metrics not found: ${setId}`));
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  console.log(chalk.cyan.bold(`📊 PRD Set Metrics: ${setId}`));
  console.log(chalk.gray('='.repeat(60)));
  console.log(`Status: ${metrics.status}`);
  console.log(`Duration: ${metrics.duration ? formatDuration(metrics.duration) : 'N/A'}`);
  console.log(`PRDs: ${metrics.prds.completed}/${metrics.prds.total} completed (${(metrics.prds.successRate * 100).toFixed(1)}% success)`);
  console.log(`Tests: ${metrics.tests.passing}/${metrics.tests.total} passing (${(metrics.tests.passRate * 100).toFixed(1)}% pass rate)`);
  if (metrics.tokens.totalCost) {
    console.log(`Cost: ${CostCalculator.formatCost(metrics.tokens.totalCost)}`);
  }
}

async function showPrdMetrics(prdId: string, json: boolean = false): Promise<void> {
  const prdMetrics = new PrdMetrics();
  const metrics = prdMetrics.getPrdMetrics(prdId);

  if (!metrics) {
    console.error(chalk.red(`PRD metrics not found: ${prdId}`));
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  console.log(chalk.cyan.bold(`📊 PRD Metrics: ${prdId}`));
  console.log(chalk.gray('='.repeat(60)));
  console.log(`Status: ${metrics.status}`);
  console.log(`Duration: ${metrics.duration ? formatDuration(metrics.duration) : 'N/A'}`);
  console.log(`Phases: ${metrics.phases.completed}/${metrics.phases.total} completed`);
  console.log(`Tasks: ${metrics.tasks.completed}/${metrics.tasks.total} completed`);
  console.log(`Tests: ${metrics.tests.passing}/${metrics.tests.total} passing`);
  if (metrics.tokens.totalCost) {
    console.log(`Cost: ${CostCalculator.formatCost(metrics.tokens.totalCost)}`);
  }
}

async function showPhaseMetrics(prdId: string, phaseId: number, json: boolean = false): Promise<void> {
  const phaseMetrics = new PhaseMetrics();
  const metrics = phaseMetrics.getPhaseMetrics(phaseId, prdId);

  if (!metrics) {
    console.error(chalk.red(`Phase metrics not found: ${prdId}-${phaseId}`));
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  console.log(chalk.cyan.bold(`📊 Phase Metrics: ${metrics.phaseName} (${prdId})`));
  console.log(chalk.gray('='.repeat(60)));
  console.log(`Status: ${metrics.status}`);
  console.log(`Duration: ${metrics.duration ? formatDuration(metrics.duration) : 'N/A'}`);
  console.log(`Tasks: ${metrics.tasks.completed}/${metrics.tasks.total} completed`);
  console.log(`Tests: ${metrics.tests.passing}/${metrics.tests.failing} passing/failing`);
}

async function compareMetrics(id1: string, id2: string, json: boolean = false): Promise<void> {
  // Try PRD set first, then PRD
  const prdSetMetrics = new PrdSetMetrics();
  const prdMetrics = new PrdMetrics();

  const set1 = prdSetMetrics.getPrdSetMetrics(id1);
  const set2 = prdSetMetrics.getPrdSetMetrics(id2);
  const prd1 = prdMetrics.getPrdMetrics(id1);
  const prd2 = prdMetrics.getPrdMetrics(id2);

  if (!set1 && !prd1) {
    console.error(chalk.red(`Metrics not found for: ${id1}`));
    process.exit(1);
  }
  if (!set2 && !prd2) {
    console.error(chalk.red(`Metrics not found for: ${id2}`));
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify({ id1: set1 || prd1, id2: set2 || prd2 }, null, 2));
    return;
  }

  console.log(chalk.cyan.bold('📊 Metrics Comparison'));
  console.log(chalk.gray('='.repeat(60)));
  // Simplified comparison - in production, add detailed comparison table
  console.log(`Comparing ${id1} vs ${id2}`);
}

async function showTrends(json: boolean = false): Promise<void> {
  const prdMetrics = new PrdMetrics();
  const allMetrics = prdMetrics.getAllPrdMetrics();

  if (json) {
    console.log(JSON.stringify(allMetrics, null, 2));
    return;
  }

  console.log(chalk.cyan.bold('📊 Trends Over Time'));
  console.log(chalk.gray('='.repeat(60)));
  console.log(`Total PRDs executed: ${allMetrics.length}`);
  // In production, add trend analysis
}

async function showFeatureMetrics(json: boolean = false): Promise<void> {
  const featureTracker = new FeatureTracker();
  const allMetrics = featureTracker.getAllFeatureMetrics();

  if (json) {
    console.log(JSON.stringify(allMetrics, null, 2));
    return;
  }

  console.log(chalk.cyan.bold('📊 Feature Usage Metrics'));
  console.log(chalk.gray('='.repeat(60)));
  const mostUsed = featureTracker.getMostUsedFeatures(10);
  for (const feature of mostUsed) {
    const successRate = feature.usageCount > 0 ? (feature.successCount / feature.usageCount * 100).toFixed(1) : '0';
    console.log(`${feature.featureName}: ${feature.usageCount} uses, ${successRate}% success`);
  }
}

async function showSchemaMetrics(json: boolean = false): Promise<void> {
  const schemaTracker = new SchemaTracker();
  const metrics = schemaTracker.getMetrics();

  if (json) {
    console.log(JSON.stringify(metrics, null, 2));
    return;
  }

  console.log(chalk.cyan.bold('📊 Schema Operation Metrics'));
  console.log(chalk.gray('='.repeat(60)));
  console.log(`Total Operations: ${metrics.totalOperations}`);
  console.log(`Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  console.log(`Average Duration: ${formatDuration(metrics.avgDuration)}`);
}
