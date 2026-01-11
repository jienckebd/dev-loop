import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdTracker } from "../../core/tracking/prd-tracker";
import { loadConfig } from '../../config/loader';

const CONTRIBUTION_MODE_FILE = path.join(process.cwd(), '.devloop', 'contribution-mode.json');
const OLD_EVOLUTION_MODE_FILE = path.join(process.cwd(), '.devloop', 'evolution-state.json');

/**
 * Contribution Mode State (Simplified)
 *
 * Boundaries are now defined in .cursorrules or project-specific rules files.
 * This state only tracks whether contribution mode is active and the PRD path.
 */
export interface ContributionModeState {
  active: boolean;
  activatedAt: string | null;
  prdPath: string | null;
}

async function loadContributionModeState(): Promise<ContributionModeState | null> {
  // Check for new file first
  if (await fs.pathExists(CONTRIBUTION_MODE_FILE)) {
    return await fs.readJson(CONTRIBUTION_MODE_FILE);
  }
  
  // Migration: Check for old evolution-state.json and migrate
  if (await fs.pathExists(OLD_EVOLUTION_MODE_FILE)) {
    const oldState = await fs.readJson(OLD_EVOLUTION_MODE_FILE);
    const migratedState: ContributionModeState = {
      active: oldState.active,
      activatedAt: oldState.activatedAt,
      prdPath: oldState.prdPath,
    };
    // Save to new location
    await fs.ensureDir(path.dirname(CONTRIBUTION_MODE_FILE));
    await fs.writeJson(CONTRIBUTION_MODE_FILE, migratedState, { spaces: 2 });
    // Remove old file
    await fs.remove(OLD_EVOLUTION_MODE_FILE);
    console.log(chalk.yellow('Migrated evolution-state.json to contribution-mode.json'));
    return migratedState;
  }
  
  return null;
}

async function saveContributionModeState(state: ContributionModeState): Promise<void> {
  await fs.ensureDir(path.dirname(CONTRIBUTION_MODE_FILE));
  await fs.writeJson(CONTRIBUTION_MODE_FILE, state, { spaces: 2 });
}

export async function contributionCommand(options: {
  action: 'start' | 'status' | 'stop';
  prd?: string;
  config?: string;
}): Promise<void> {
  const spinner = ora().start();

  try {
    if (options.action === 'start') {
      if (!options.prd) {
        spinner.fail('PRD path required for start action');
        console.error(chalk.red('Usage: npx dev-loop contribution start --prd <path>'));
        process.exit(1);
      }

      const prdPath = path.resolve(process.cwd(), options.prd);
      if (!(await fs.pathExists(prdPath))) {
        spinner.fail(`PRD file not found: ${prdPath}`);
        process.exit(1);
      }

      const state: ContributionModeState = {
        active: true,
        activatedAt: new Date().toISOString(),
        prdPath: path.relative(process.cwd(), prdPath),
      };

      await saveContributionModeState(state);
      
      // Start event monitoring service if enabled in config
      const config = await loadConfig(options.config);
      const eventMonitoringEnabled = (config.mcp as any)?.eventMonitoring?.enabled;
      
      if (eventMonitoringEnabled) {
        const { initializeEventMonitor, setMonitorService } = await import('../../core/monitoring/event-monitor');
        const monitor = initializeEventMonitor(config);
        setMonitorService(monitor);
        monitor.start();
        console.log(chalk.green('✓ Proactive event monitoring service started'));
      }
      
      spinner.succeed('Contribution mode activated');

      console.log(chalk.cyan('\n╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('║                  CONTRIBUTION MODE ACTIVE                  ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝\n'));

      console.log(chalk.yellow('Two-agent architecture is now active:\n'));

      console.log(chalk.bold('OUTER AGENT (you):'));
      console.log('  - Enhances dev-loop (node_modules/dev-loop/)');
      console.log('  - Updates tasks (.taskmaster/tasks/tasks.json)');
      console.log('  - Modifies PRD (.taskmaster/docs/)');
      console.log('  - Configures dev-loop (devloop.config.js)\n');

      console.log(chalk.bold('INNER AGENT (dev-loop):'));
      console.log('  - Implements code changes');
      console.log('  - Creates tests');
      console.log('  - Fixes errors\n');

      console.log(chalk.yellow('Boundaries are defined in your project\'s .cursorrules file.'));
      console.log(chalk.yellow('See the "Contribution Mode" section for specific file restrictions.\n'));

      console.log(chalk.bold('WORKFLOW:\n'));
      console.log('1. Run: npx dev-loop watch --until-complete');
      console.log('2. Observe output and failures');
      console.log('3. If dev-loop needs enhancement: edit node_modules/dev-loop/src/, rebuild, push');
      console.log('4. If PRD needs more tasks: update .taskmaster/tasks/tasks.json');
      console.log('5. Let dev-loop run again - it implements the PRD code');
      console.log('6. When all tasks pass: validate in browser');
      console.log('7. Exit contribution mode when PRD is 100% validated\n');

      console.log(chalk.cyan(`PRD: ${state.prdPath}\n`));
    } else if (options.action === 'status') {
      const state = await loadContributionModeState();
      if (!state || !state.active) {
        spinner.info('Contribution mode is not active');
        console.log(chalk.yellow('Run "npx dev-loop contribution start --prd <path>" to activate'));
        return;
      }

      spinner.succeed('Contribution mode is active');

      console.log(chalk.cyan('\nContribution Mode Status:'));
      console.log(`  PRD: ${state.prdPath || 'N/A'}`);
      console.log(`  Activated: ${state.activatedAt || 'N/A'}`);

      // Load config and check completion status
      try {
        const config = await loadConfig(options.config);
        const tracker = new PrdTracker(config);
        const status = await tracker.getCompletionStatus();

        console.log(chalk.cyan('\nPRD Completion Status:'));
        console.log(`  Total Tasks: ${status.totalTasks}`);
        console.log(`  Completed: ${status.completedTasks} (${status.percentComplete}%)`);
        console.log(`  Pending: ${status.pendingTasks}`);
        console.log(`  Blocked: ${status.blockedTasks}`);
        console.log(`  Tests Passing: ${status.testsPassing ? chalk.green('Yes') : chalk.red('No')}`);

        // Check event monitoring status
        const eventMonitoringEnabled = (config.mcp as any)?.eventMonitoring?.enabled;
        if (eventMonitoringEnabled) {
          try {
            const { getInterventionMetricsTracker } = await import('../../core/metrics/intervention-metrics');
            const tracker = getInterventionMetricsTracker();
            const metrics = tracker.getMetrics();
            
            console.log(chalk.cyan('\nEvent Monitoring Status:'));
            console.log(`  Enabled: ${chalk.green('Yes')}`);
            console.log(`  Total Interventions: ${metrics.totalInterventions}`);
            console.log(`  Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
            console.log(`  Successful: ${chalk.green(metrics.successfulInterventions)}`);
            console.log(`  Failed: ${chalk.red(metrics.failedInterventions)}`);
            console.log(`  Rolled Back: ${chalk.yellow(metrics.rolledBackInterventions)}`);
          } catch (error) {
            console.log(chalk.yellow('\nCould not load event monitoring status'));
          }
        } else {
          console.log(chalk.cyan('\nEvent Monitoring:') + chalk.gray(' Disabled'));
        }

        if (await tracker.isComplete()) {
          console.log(chalk.green('\n✓ PRD is 100% complete!'));
        } else {
          console.log(chalk.yellow('\n⚠ PRD is not yet complete'));
        }
      } catch (error) {
        console.log(chalk.yellow('\nCould not load completion status:'), error instanceof Error ? error.message : String(error));
      }
    } else if (options.action === 'stop') {
      const state = await loadContributionModeState();
      if (!state || !state.active) {
        spinner.info('Contribution mode is not active');
        return;
      }

      const stoppedState: ContributionModeState = {
        ...state,
        active: false,
      };

      // Stop event monitoring service if running
      try {
        const config = await loadConfig(options.config);
        const eventMonitoringEnabled = (config.mcp as any)?.eventMonitoring?.enabled;
        
        if (eventMonitoringEnabled) {
          const { getMonitorService } = await import('../../core/monitoring/event-monitor');
          const monitor = getMonitorService();
          if (monitor) {
            monitor.stop();
            console.log(chalk.yellow('Event monitoring service stopped'));
          }
        }
      } catch (error) {
        // Ignore errors when stopping monitoring
      }
      
      await saveContributionModeState(stoppedState);
      spinner.succeed('Contribution mode deactivated');
      console.log(chalk.green('Contribution mode is now inactive'));
    }
  } catch (error) {
    spinner.fail('Contribution command failed');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
