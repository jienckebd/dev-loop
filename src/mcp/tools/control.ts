import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { TaskMasterBridge } from '../../core/task-bridge';
import { ConfigLoader, FastMCPType } from './index';

export function registerControlTools(mcp: FastMCPType, getConfig: ConfigLoader): void {
  // devloop_pause - Pause after current task
  mcp.addTool({
    name: 'devloop_pause',
    description: 'Pause workflow execution after current task',
    parameters: z.object({}),
    execute: async (args: {}, context: any) => {
      try {
        const pauseFile = path.join(process.cwd(), '.devloop', 'pause');
        await fs.ensureDir(path.dirname(pauseFile));
        await fs.writeFile(pauseFile, Date.now().toString());
        return JSON.stringify({
          success: true,
          message: 'Workflow paused',
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // devloop_resume - Resume execution
  mcp.addTool({
    name: 'devloop_resume',
    description: 'Resume paused workflow execution',
    parameters: z.object({}),
    execute: async (args: {}, context: any) => {
      try {
        const pauseFile = path.join(process.cwd(), '.devloop', 'pause');
        if (await fs.pathExists(pauseFile)) {
          await fs.remove(pauseFile);
          return JSON.stringify({
            success: true,
            message: 'Workflow resumed',
          });
        } else {
          return JSON.stringify({
            success: false,
            error: 'Workflow is not paused',
          });
        }
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // devloop_reset - Reset task(s) to pending
  mcp.addTool({
    name: 'devloop_reset',
    description: 'Reset task(s) to pending status',
    parameters: z.object({
      taskId: z.string().optional().describe('Task ID to reset (optional, resets all if not provided)'),
      config: z.string().optional().describe('Path to config file (optional)'),
      allFailed: z.boolean().optional().describe('Reset all blocked/failed tasks'),
      all: z.boolean().optional().describe('Reset all tasks to pending'),
    }),
    execute: async (args: { taskId?: string; config?: string; allFailed?: boolean; all?: boolean }, context: any) => {
      const config = await getConfig(args.config);
      const taskBridge = new TaskMasterBridge(config);

      try {
        if (args.all) {
          const tasks = await taskBridge.getAllTasks();
          for (const task of tasks) {
            await taskBridge.updateTaskStatus(task.id, 'pending');
          }
          return JSON.stringify({
            success: true,
            message: `Reset ${tasks.length} tasks to pending`,
            count: tasks.length,
          });
        } else if (args.allFailed) {
          const allTasks = await taskBridge.getAllTasks();
          const failed = allTasks.filter(t => t.status === 'blocked');
          for (const task of failed) {
            await taskBridge.updateTaskStatus(task.id, 'pending');
          }
          return JSON.stringify({
            success: true,
            message: `Reset ${failed.length} failed/blocked tasks to pending`,
            count: failed.length,
          });
        } else if (args.taskId) {
          await taskBridge.updateTaskStatus(args.taskId, 'pending');
          return JSON.stringify({
            success: true,
            message: `Reset task ${args.taskId} to pending`,
            taskId: args.taskId,
          });
        } else {
          return JSON.stringify({
            success: false,
            error: 'Must provide taskId, allFailed, or all option',
          });
        }
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  // devloop_validate - Validate config and environment
  mcp.addTool({
    name: 'devloop_validate',
    description: 'Validate configuration and environment',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
      configOnly: z.boolean().optional().describe('Validate configuration file only'),
      tasks: z.boolean().optional().describe('Validate tasks structure'),
      environment: z.boolean().optional().describe('Check dependencies and environment'),
      fix: z.boolean().optional().describe('Attempt to fix issues'),
    }),
    execute: async (args: { config?: string; configOnly?: boolean; tasks?: boolean; environment?: boolean; fix?: boolean }, context: any) => {
      try {
        const config = await getConfig(args.config);
        const issues: string[] = [];
        const warnings: string[] = [];

        // Validate configuration
        if (args.configOnly || (!args.tasks && !args.environment)) {
          if (!(config as any).ai?.provider) {
            warnings.push('AI provider not configured');
          }
          if (!(config as any).ai?.model) {
            warnings.push('AI model not configured');
          }
          if (!config.taskMaster?.tasksPath) {
            warnings.push('Task master path not configured');
          }
        }

        // Validate tasks
        if (args.tasks || (!args.configOnly && !args.environment)) {
          const taskBridge = new TaskMasterBridge(config);
          const tasks = await taskBridge.getAllTasks();

          if (tasks.length === 0) {
            warnings.push('No tasks found in tasks.json');
          }

          // Check for invalid task statuses
          const invalidTasks = tasks.filter(t =>
            !['pending', 'in-progress', 'done', 'blocked'].includes(t.status || '')
          );
          if (invalidTasks.length > 0) {
            issues.push(`${invalidTasks.length} tasks have invalid status values`);
          }
        }

        return JSON.stringify({
          valid: issues.length === 0,
          issues,
          warnings,
        });
      } catch (error) {
        return JSON.stringify({
          valid: false,
          issues: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        });
      }
    },
  });
}
