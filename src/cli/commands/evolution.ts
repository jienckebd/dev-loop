import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdTracker } from '../../core/prd-tracker';
import { loadConfig } from '../../config/loader';

const EVOLUTION_MODE_FILE = path.join(process.cwd(), '.devloop', 'evolution-mode.json');

export interface EvolutionModeState {
  active: boolean;
  activatedAt: string | null;
  prdPath: string | null;
  outerAgentBoundaries: {
    allowed: string[];
    forbidden: string[];
  };
  innerAgentScope: {
    allowed: string[];
  };
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
        outerAgentBoundaries: {
          allowed: [
            'packages/dev-loop/**',
            '.taskmaster/tasks/tasks.json',
            '.taskmaster/docs/**',
            '.devloop/**',
            'devloop.config.js',
          ],
          forbidden: [
            'docroot/**',
            'tests/**',
            'config/**',
            'script/**',
          ],
        },
        innerAgentScope: {
          allowed: [
            'docroot/**',
            'tests/**',
            'config/**',
            'script/**',
          ],
        },
      };

      await saveEvolutionModeState(state);
      spinner.succeed('Evolution mode activated');

      console.log(chalk.cyan('\n╔════════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan('║           EVOLUTION MODE - OUTER AGENT INSTRUCTIONS         ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════════════════════════╝\n'));

      console.log(chalk.yellow('You are now the OUTER AGENT (Cursor). The dev-loop inner agent will implement PRD code.\n'));

      console.log(chalk.bold('CRITICAL BOUNDARIES:\n'));
      console.log(chalk.green('✓ You may ONLY edit:'));
      console.log('  - packages/dev-loop/          (Dev-loop enhancements)');
      console.log('  - .taskmaster/tasks/tasks.json (Task definitions)');
      console.log('  - .taskmaster/docs/            (PRD updates)');
      console.log('  - .devloop/                    (Evolution mode state)');
      console.log('  - devloop.config.js            (Dev-loop configuration)\n');

      console.log(chalk.red('✗ You may NOT directly edit (dev-loop inner agent scope):'));
      console.log('  - docroot/                     (All Drupal code)');
      console.log('  - tests/playwright/            (Playwright tests)');
      console.log('  - config/                      (Drupal configuration)');
      console.log('  - script/                      (PHP scripts)\n');

      console.log(chalk.bold('WORKFLOW:\n'));
      console.log('1. Run: npx dev-loop watch --until-complete');
      console.log('2. Observe output and failures');
      console.log('3. If dev-loop needs enhancement: edit packages/dev-loop/src/, rebuild, push');
      console.log('4. If PRD needs more tasks: update .taskmaster/tasks/tasks.json');
      console.log('5. Let dev-loop run again - it implements the PRD code');
      console.log('6. When all tasks pass: validate in browser');
      console.log('7. Exit evolution mode when PRD is 100% validated\n');

      console.log(chalk.bold('WHEN YOU SEE TEST FAILURES:\n'));
      console.log(chalk.red('WRONG:') + ' Edit tests/playwright/*.spec.ts directly');
      console.log(chalk.green('RIGHT:') + ' Create task in tasks.json OR enhance dev-loop patterns/templates\n');

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
