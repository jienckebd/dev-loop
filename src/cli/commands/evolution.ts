import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdTracker } from '../../core/prd-tracker';
import { loadConfig } from '../../config/loader';

const EVOLUTION_MODE_FILE = path.join(process.cwd(), '.devloop', 'evolution-mode.json');

/**
 * Evolution Mode State (Simplified)
 *
 * Boundaries are now defined in .cursorrules or project-specific rules files.
 * This state only tracks whether evolution mode is active and the PRD path.
 */
export interface EvolutionModeState {
  active: boolean;
  activatedAt: string | null;
  prdPath: string | null;
}

async function loadEvolutionModeState(): Promise<EvolutionModeState | null> {
  if (await fs.pathExists(EVOLUTION_MODE_FILE)) {
    return await fs.readJson(EVOLUTION_MODE_FILE);
  }
  return null;
}

async function saveEvolutionModeState(state: EvolutionModeState): Promise<void> {
  await fs.ensureDir(path.dirname(EVOLUTION_MODE_FILE));
  await fs.writeJson(EVOLUTION_MODE_FILE, state, { spaces: 2 });
}

export async function evolutionCommand(options: {
  action: 'start' | 'status' | 'stop';
  prd?: string;
  config?: string;
}): Promise<void> {
  const spinner = ora().start();

  try {
    if (options.action === 'start') {
      if (!options.prd) {
        spinner.fail('PRD path required for start action');
        console.error(chalk.red('Usage: npx dev-loop evolution start --prd <path>'));
        process.exit(1);
      }

      const prdPath = path.resolve(process.cwd(), options.prd);
      if (!(await fs.pathExists(prdPath))) {
        spinner.fail(`PRD file not found: ${prdPath}`);
        process.exit(1);
      }

      const state: EvolutionModeState = {
        active: true,
        activatedAt: new Date().toISOString(),
        prdPath: path.relative(process.cwd(), prdPath),
      };

      await saveEvolutionModeState(state);
      spinner.succeed('Evolution mode activated');

      console.log(chalk.cyan('\n╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('║                    EVOLUTION MODE ACTIVE                    ║'));
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
      console.log(chalk.yellow('See the "Evolution Mode" section for specific file restrictions.\n'));

      console.log(chalk.bold('WORKFLOW:\n'));
      console.log('1. Run: npx dev-loop watch --until-complete');
      console.log('2. Observe output and failures');
      console.log('3. If dev-loop needs enhancement: edit node_modules/dev-loop/src/, rebuild, push');
      console.log('4. If PRD needs more tasks: update .taskmaster/tasks/tasks.json');
      console.log('5. Let dev-loop run again - it implements the PRD code');
      console.log('6. When all tasks pass: validate in browser');
      console.log('7. Exit evolution mode when PRD is 100% validated\n');

      console.log(chalk.cyan(`PRD: ${state.prdPath}\n`));
    } else if (options.action === 'status') {
      const state = await loadEvolutionModeState();
      if (!state || !state.active) {
        spinner.info('Evolution mode is not active');
        console.log(chalk.yellow('Run "npx dev-loop evolution start --prd <path>" to activate'));
        return;
      }

      spinner.succeed('Evolution mode is active');

      console.log(chalk.cyan('\nEvolution Mode Status:'));
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

        if (await tracker.isComplete()) {
          console.log(chalk.green('\n✓ PRD is 100% complete!'));
        } else {
          console.log(chalk.yellow('\n⚠ PRD is not yet complete'));
        }
      } catch (error) {
        console.log(chalk.yellow('\nCould not load completion status:'), error instanceof Error ? error.message : String(error));
      }
    } else if (options.action === 'stop') {
      const state = await loadEvolutionModeState();
      if (!state || !state.active) {
        spinner.info('Evolution mode is not active');
        return;
      }

      const stoppedState: EvolutionModeState = {
        ...state,
        active: false,
      };

      await saveEvolutionModeState(stoppedState);
      spinner.succeed('Evolution mode deactivated');
      console.log(chalk.green('Evolution mode is now inactive'));
    }
  } catch (error) {
    spinner.fail('Evolution command failed');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
