import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdTracker } from '../../core/prd-tracker';
import { ConfigLoader } from './index';

const EVOLUTION_MODE_FILE = path.join(process.cwd(), '.devloop', 'evolution-mode.json');

interface EvolutionModeState {
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

export function registerEvolutionTools(mcp: FastMCP, getConfig: ConfigLoader): void {
  // devloop_evolution_start - Activate evolution mode with PRD
  mcp.addTool({
    name: 'devloop_evolution_start',
    description: 'Activate evolution mode',
    parameters: z.object({
      prd: z.string().describe('Path to PRD file'),
      config: z.string().optional().describe('Path to config file (optional)'),
    }),
    execute: async (args, context) => {
      try {
        const prdPath = path.resolve(process.cwd(), args.prd);
        if (!(await fs.pathExists(prdPath))) {
          return JSON.stringify({
            success: false,
            error: `PRD file not found: ${prdPath}`,
          });
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
        return JSON.stringify({
          success: true,
          message: 'Evolution mode activated',
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

  // devloop_evolution_status - Check evolution mode state
  mcp.addTool({
    name: 'devloop_evolution_status',
    description: 'Check evolution mode state',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
    }),
    execute: async (args: { config?: string }, context) => {
      try {
        const state = await loadEvolutionModeState();
        if (!state || !state.active) {
          return JSON.stringify({
            active: false,
            message: 'Evolution mode is not active',
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

  // devloop_evolution_stop - Deactivate evolution mode
  mcp.addTool({
    name: 'devloop_evolution_stop',
    description: 'Deactivate evolution mode',
    parameters: z.object({}),
    execute: async (args: {}, context) => {
      try {
        const state = await loadEvolutionModeState();
        if (!state || !state.active) {
          return JSON.stringify({
            success: false,
            message: 'Evolution mode is not active',
          });
        }

        const stoppedState: EvolutionModeState = {
          ...state,
          active: false,
        };

        await saveEvolutionModeState(stoppedState);
        return JSON.stringify({
          success: true,
          message: 'Evolution mode deactivated',
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
