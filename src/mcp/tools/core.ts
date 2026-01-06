import { z } from 'zod';
import { WorkflowEngine } from '../../core/workflow-engine';
import { TaskMasterBridge } from '../../core/task-bridge';
import { StateManager } from '../../core/state-manager';
import { ConfigLoader, FastMCPType } from './index';

export function registerCoreTools(mcp: FastMCPType, getConfig: ConfigLoader): void {
  // devloop_run - Execute one workflow iteration
  mcp.addTool({
    name: 'devloop_run',
    description: 'Execute one workflow iteration',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
      debug: z.boolean().optional().describe('Enable debug mode'),
    }),
    execute: async (args: { config?: string; debug?: boolean }, context: any) => {
      const config = await getConfig(args.config);
      if (args.debug) {
        (config as any).debug = true;
      }

      const engine = new WorkflowEngine(config);
      const result = await engine.runOnce();

      return JSON.stringify({
        completed: result.completed,
        noTasks: result.noTasks,
        taskId: result.taskId,
        error: result.error,
      });
    },
  });

  // devloop_run_task - Run specific task by ID
  mcp.addTool({
    name: 'devloop_run_task',
    description: 'Run specific task by ID',
    parameters: z.object({
      taskId: z.string().describe('Task ID to run'),
      config: z.string().optional().describe('Path to config file (optional)'),
      debug: z.boolean().optional().describe('Enable debug mode'),
    }),
    execute: async (args: { taskId: string; config?: string; debug?: boolean }, context: any) => {
      const config = await getConfig(args.config);
      if (args.debug) {
        (config as any).debug = true;
      }

      const taskBridge = new TaskMasterBridge(config);
      const task = await taskBridge.getTask(args.taskId);

      if (!task) {
        return JSON.stringify({
          error: `Task not found: ${args.taskId}`,
        });
      }

      // Ensure task is pending
      if (task.status !== 'pending' && task.status !== 'in-progress') {
        await taskBridge.updateTaskStatus(task.id, 'pending');
      }

      const engine = new WorkflowEngine(config);
      const result = await engine.runOnce();

      return JSON.stringify({
        completed: result.completed,
        taskId: result.taskId,
        error: result.error,
      });
    },
  });

  // devloop_status - Get current progress and state
  mcp.addTool({
    name: 'devloop_status',
    description: 'Get current progress and state',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
    }),
    execute: async (args: { config?: string }, context: any) => {
      const config = await getConfig(args.config);
      const stateManager = new StateManager(config);
      const state = await stateManager.getWorkflowState();

      return JSON.stringify({
        status: state.status,
        currentTask: state.currentTask ? {
          id: state.currentTask.id,
          title: state.currentTask.title,
          status: state.currentTask.status,
          priority: state.currentTask.priority,
        } : null,
        completedTasks: state.completedTasks,
        totalTasks: state.totalTasks,
        progress: Math.round(state.progress * 100),
      });
    },
  });

  // devloop_list_tasks - List tasks with filtering
  mcp.addTool({
    name: 'devloop_list_tasks',
    description: 'List tasks with filtering',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
      status: z.string().optional().describe('Filter by status (pending, in-progress, done, failed, blocked)'),
      json: z.boolean().optional().describe('Output as JSON'),
    }),
    execute: async (args: { config?: string; status?: string; json?: boolean }, context: any) => {
      const config = await getConfig(args.config);
      const taskBridge = new TaskMasterBridge(config);

      let tasks;
      if (args.status === 'pending') {
        tasks = await taskBridge.getPendingTasks();
      } else {
        const allTasks = await taskBridge.getAllTasks();
        if (args.status) {
          tasks = allTasks.filter(t => t.status === args.status);
        } else {
          tasks = allTasks;
        }
      }

      return JSON.stringify({
        tasks: tasks.map((t: any) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          description: t.description,
        })),
        count: tasks.length,
      });
    },
  });

  // devloop_prd - Execute PRD autonomously
  mcp.addTool({
    name: 'devloop_prd',
    description: 'Execute PRD autonomously via test-driven development',
    parameters: z.object({
      prdPath: z.string().describe('Path to PRD file'),
      config: z.string().optional().describe('Path to config file (optional)'),
      debug: z.boolean().optional().describe('Enable debug mode'),
      resume: z.boolean().optional().describe('Resume from previous execution state'),
    }),
    execute: async (args: { prdPath: string; config?: string; debug?: boolean; resume?: boolean }, context: any) => {
      const config = await getConfig(args.config);
      if (args.debug) {
        (config as any).debug = true;
      }

      // Check for PRD config overlay
      const { PrdConfigParser } = await import('../../core/prd-config-parser.js');
      const configParser = new PrdConfigParser(args.debug || false);
      const prdConfigOverlay = await configParser.parsePrdConfig(args.prdPath);
      const prdConfigInfo = prdConfigOverlay
        ? {
            detected: true,
            sections: Object.keys(prdConfigOverlay),
          }
        : {
            detected: false,
          };

      // Import the PRD command handler
      const { prdCommand } = await import('../../cli/commands/prd.js');

      try {
        await prdCommand({
          prd: args.prdPath,
          config: args.config,
          debug: args.debug,
          resume: args.resume,
        });

        return JSON.stringify({
          success: true,
          message: 'PRD execution completed',
          prdConfig: prdConfigInfo,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          prdConfig: prdConfigInfo,
        });
      }
    },
  });

  // devloop_prd_set_execute - Execute PRD set
  mcp.addTool({
    name: 'devloop_prd_set_execute',
    description: 'Execute entire PRD set (discovers index.md.yml automatically)',
    parameters: z.object({
      path: z.string().describe('Path to PRD set directory or index.md.yml file'),
      config: z.string().optional().describe('Path to config file (optional)'),
      debug: z.boolean().optional().describe('Enable debug mode'),
      parallel: z.boolean().optional().describe('Enable parallel execution of independent PRDs'),
      maxConcurrent: z.number().optional().describe('Maximum concurrent PRD executions'),
    }),
    execute: async (args: { path: string; config?: string; debug?: boolean; parallel?: boolean; maxConcurrent?: number }, context: any) => {
      const { prdSetExecuteCommand } = await import('../../cli/commands/prd-set.js');

      try {
        await prdSetExecuteCommand({
          path: args.path,
          config: args.config,
          debug: args.debug,
          parallel: args.parallel,
          maxConcurrent: args.maxConcurrent,
        });

        return JSON.stringify({
          success: true,
          message: 'PRD set execution completed',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // devloop_prd_set_status - Get PRD set status
  mcp.addTool({
    name: 'devloop_prd_set_status',
    description: 'Get current PRD set execution status',
    parameters: z.object({
      path: z.string().describe('Path to PRD set directory or index.md.yml file'),
      debug: z.boolean().optional().describe('Enable debug mode'),
    }),
    execute: async (args: { path: string; debug?: boolean }, context: any) => {
      const { prdSetStatusCommand } = await import('../../cli/commands/prd-set.js');

      try {
        await prdSetStatusCommand({
          path: args.path,
          debug: args.debug,
        });

        return JSON.stringify({
          success: true,
          message: 'Status retrieved',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // devloop_prd_set_list - List all discovered PRD sets
  mcp.addTool({
    name: 'devloop_prd_set_list',
    description: 'List all discovered PRD sets',
    parameters: z.object({
      planningDir: z.string().optional().describe('Planning directory to scan'),
      debug: z.boolean().optional().describe('Enable debug mode'),
    }),
    execute: async (args: { planningDir?: string; debug?: boolean }, context: any) => {
      const { prdSetListCommand } = await import('../../cli/commands/prd-set.js');

      try {
        await prdSetListCommand({
          planningDir: args.planningDir,
          debug: args.debug,
        });

        return JSON.stringify({
          success: true,
          message: 'PRD sets listed',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // devloop_prd_set_validate - Validate PRD set without executing
  mcp.addTool({
    name: 'devloop_prd_set_validate',
    description: 'Validate PRD set without executing',
    parameters: z.object({
      path: z.string().describe('Path to PRD set directory or index.md.yml file'),
      debug: z.boolean().optional().describe('Enable debug mode'),
    }),
    execute: async (args: { path: string; debug?: boolean }, context: any) => {
      const { prdSetValidateCommand } = await import('../../cli/commands/prd-set.js');

      try {
        await prdSetValidateCommand({
          path: args.path,
          debug: args.debug,
        });

        return JSON.stringify({
          success: true,
          message: 'PRD set validation passed',
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
