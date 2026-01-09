import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdTracker } from "../../core/tracking/prd-tracker";
import { ConfigLoader, FastMCPType } from './index';

const CONTRIBUTION_MODE_FILE = path.join(process.cwd(), '.devloop', 'contribution-mode.json');
const OLD_EVOLUTION_MODE_FILE = path.join(process.cwd(), '.devloop', 'evolution-mode.json');

interface ContributionModeState {
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

async function loadContributionModeState(): Promise<ContributionModeState | null> {
  // Check for new file first
  if (await fs.pathExists(CONTRIBUTION_MODE_FILE)) {
    return await fs.readJson(CONTRIBUTION_MODE_FILE);
  }
  
  // Migration: Check for old evolution-mode.json and migrate
  if (await fs.pathExists(OLD_EVOLUTION_MODE_FILE)) {
    const oldState = await fs.readJson(OLD_EVOLUTION_MODE_FILE);
    const migratedState: ContributionModeState = {
      active: oldState.active,
      activatedAt: oldState.activatedAt,
      prdPath: oldState.prdPath,
      outerAgentBoundaries: oldState.outerAgentBoundaries || {
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
      innerAgentScope: oldState.innerAgentScope || {
        allowed: [
          'docroot/**',
          'tests/**',
          'config/**',
          'script/**',
        ],
      },
    };
    // Save to new location
    await fs.ensureDir(path.dirname(CONTRIBUTION_MODE_FILE));
    await fs.writeJson(CONTRIBUTION_MODE_FILE, migratedState, { spaces: 2 });
    // Remove old file
    await fs.remove(OLD_EVOLUTION_MODE_FILE);
    return migratedState;
  }
  
  return null;
}

async function saveContributionModeState(state: ContributionModeState): Promise<void> {
  await fs.ensureDir(path.dirname(CONTRIBUTION_MODE_FILE));
  await fs.writeJson(CONTRIBUTION_MODE_FILE, state, { spaces: 2 });
}

export function registerContributionTools(mcp: FastMCPType, getConfig: ConfigLoader): void {
  // devloop_contribution_start - Activate contribution mode with PRD
  mcp.addTool({
    name: 'devloop_contribution_start',
    description: 'Activate contribution mode',
    parameters: z.object({
      prd: z.string().describe('Path to PRD file'),
      config: z.string().optional().describe('Path to config file (optional)'),
    }),
    execute: async (args: { prd: string; config?: string }, context: any) => {
      try {
        const prdPath = path.resolve(process.cwd(), args.prd);
        if (!(await fs.pathExists(prdPath))) {
          return JSON.stringify({
            success: false,
            error: `PRD file not found: ${prdPath}`,
          });
        }

        const state: ContributionModeState = {
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

        await saveContributionModeState(state);
        return JSON.stringify({
          success: true,
          message: 'Contribution mode activated',
          prdPath: state.prdPath,
          boundaries: state.outerAgentBoundaries,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // devloop_contribution_status - Check contribution mode state
  mcp.addTool({
    name: 'devloop_contribution_status',
    description: 'Check contribution mode state',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
    }),
    execute: async (args: { config?: string }, context: any) => {
      try {
        const state = await loadContributionModeState();
        if (!state || !state.active) {
          return JSON.stringify({
            active: false,
            message: 'Contribution mode is not active',
          });
        }

        const result: any = {
          active: true,
          prdPath: state.prdPath,
          activatedAt: state.activatedAt,
          boundaries: state.outerAgentBoundaries,
        };

        // Load PRD completion status if config available
        try {
          const config = await getConfig(args.config);
          const tracker = new PrdTracker(config);
          const status = await tracker.getCompletionStatus();

          result.completion = {
            totalTasks: status.totalTasks,
            completedTasks: status.completedTasks,
            pendingTasks: status.pendingTasks,
            blockedTasks: status.blockedTasks,
            percentComplete: status.percentComplete,
            testsPassing: status.testsPassing,
            isComplete: await tracker.isComplete(),
          };
        } catch (error) {
          result.completionError = error instanceof Error ? error.message : String(error);
        }

        return JSON.stringify(result);
      } catch (error) {
        return JSON.stringify({
          active: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // devloop_contribution_stop - Deactivate contribution mode
  mcp.addTool({
    name: 'devloop_contribution_stop',
    description: 'Deactivate contribution mode',
    parameters: z.object({}),
    execute: async (args: {}, context: any) => {
      try {
        const state = await loadContributionModeState();
        if (!state || !state.active) {
          return JSON.stringify({
            success: false,
            message: 'Contribution mode is not active',
          });
        }

        const stoppedState: ContributionModeState = {
          ...state,
          active: false,
        };

        await saveContributionModeState(stoppedState);
        return JSON.stringify({
          success: true,
          message: 'Contribution mode deactivated',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}
