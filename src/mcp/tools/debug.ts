import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import * as fs from 'fs-extra';
import { TaskMasterBridge } from '../../core/task-bridge';
import { LogAnalyzerFactory } from '../../providers/log-analyzers/factory';
import { ConfigLoader } from './index';

export function registerDebugTools(mcp: FastMCP, getConfig: ConfigLoader): void {
  // devloop_diagnose - Analyze failures and suggest fixes
  mcp.addTool({
    name: 'devloop_diagnose',
    description: 'Analyze task failures and suggest fixes',
    parameters: z.object({
      taskId: z.string().optional().describe('Task ID to diagnose (optional)'),
      config: z.string().optional().describe('Path to config file (optional)'),
      suggest: z.boolean().optional().describe('Suggest fixes for issues'),
    }),
    execute: async (args: { taskId?: string; config?: string; suggest?: boolean }, context) => {
      const config = await getConfig(args.config);
      const taskBridge = new TaskMasterBridge(config);

      if (args.taskId) {
        const task = await taskBridge.getTask(args.taskId);
        if (!task) {
          return JSON.stringify({
            error: `Task not found: ${args.taskId}`,
          });
        }

        const analysis: any = {
          taskId: task.id,
          title: task.title,
          status: task.status,
          issues: [],
          suggestions: [],
        };

        if (task.status === 'blocked') {
          // Extract error information
          if (task.description) {
            const errorMatches = task.description.match(/Error:?\s*(.+?)(?:\n\n|$)/is);
            if (errorMatches) {
              analysis.issues.push({
                type: 'error',
                message: errorMatches[1].substring(0, 500),
              });
            }
          }

          // Analyze logs if available
          if (config.logs.outputPath && await fs.pathExists(config.logs.outputPath)) {
            const logAnalyzer = LogAnalyzerFactory.create(config);
            const logAnalysis = await logAnalyzer.analyze([{
              type: 'file',
              path: config.logs.outputPath,
            }]);
            
            if (logAnalysis.errors.length > 0) {
              analysis.issues.push(...logAnalysis.errors.map((e: string) => ({
                type: 'log_error',
                message: e,
              })));
            }
          }
        }

        return JSON.stringify(analysis);
      }

      // Diagnose all failed/blocked tasks
      const allTasks = await taskBridge.getAllTasks();
      const failedTasks = allTasks.filter(t => t.status === 'blocked');
      const allIssues = failedTasks;

      return JSON.stringify({
        totalIssues: allIssues.length,
        tasks: allIssues.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
        })),
      });
    },
  });

  // devloop_trace - Get execution trace for task
  mcp.addTool({
    name: 'devloop_trace',
    description: 'Show complete execution trace for a task',
    parameters: z.object({
      taskId: z.string().describe('Task ID'),
      config: z.string().optional().describe('Path to config file (optional)'),
      tokens: z.boolean().optional().describe('Include token usage information'),
    }),
    execute: async (args: { taskId: string; config?: string; tokens?: boolean }, context) => {
      const config = await getConfig(args.config);
      const taskBridge = new TaskMasterBridge(config);
      const task = await taskBridge.getTask(args.taskId);

      if (!task) {
        return JSON.stringify({
          error: `Task not found: ${args.taskId}`,
        });
      }

      return JSON.stringify({
        taskId: task.id,
        title: task.title,
        status: task.status,
        description: task.description,
        note: 'Full trace available via CLI command: npx dev-loop trace ' + args.taskId,
      });
    },
  });

  // devloop_logs - View and analyze logs
  mcp.addTool({
    name: 'devloop_logs',
    description: 'View and analyze logs',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
      analyze: z.boolean().optional().describe('Analyze project logs'),
      tail: z.number().optional().describe('Number of lines to show (default: 50)'),
    }),
    execute: async (args: { config?: string; analyze?: boolean; tail?: number }, context) => {
      const config = await getConfig(args.config);
      const logPath = config.logs.outputPath;

      if (!logPath || !await fs.pathExists(logPath)) {
        return JSON.stringify({
          error: 'Log file not found or not configured',
        });
      }

      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content.split('\n');
      const tailLines = args.tail || 50;
      const displayLines = lines.slice(Math.max(0, lines.length - tailLines));

      if (args.analyze) {
        const logAnalyzer = LogAnalyzerFactory.create(config);
        const analysis = await logAnalyzer.analyze([{
          type: 'file',
          path: logPath,
        }]);
        
        return JSON.stringify({
          logs: displayLines,
          analysis: {
            errors: analysis.errors,
            warnings: analysis.warnings,
            summary: analysis.summary,
          },
        });
      }

      return JSON.stringify({
        logs: displayLines,
        totalLines: lines.length,
        showing: displayLines.length,
      });
    },
  });

  // devloop_evolve - Get improvement suggestions
  mcp.addTool({
    name: 'devloop_evolve',
    description: 'View evolution insights (observations and improvement suggestions)',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
      projectType: z.string().optional().describe('Filter observations by project type'),
    }),
    execute: async (args: { config?: string; projectType?: string }, context) => {
      return JSON.stringify({
        note: 'Evolution insights available via CLI: npx dev-loop evolve',
        message: 'Use the evolve command for detailed insights',
      });
    },
  });

  // devloop_metrics - View debug metrics and trends
  mcp.addTool({
    name: 'devloop_metrics',
    description: 'View debug metrics and trends over time',
    parameters: z.object({
      config: z.string().optional().describe('Path to config file (optional)'),
      last: z.number().optional().describe('Show last N runs'),
      task: z.string().optional().describe('Show metrics for specific task'),
      summary: z.boolean().optional().describe('Show summary only'),
    }),
    execute: async (args: { config?: string; last?: number; task?: string; summary?: boolean }, context) => {
      return JSON.stringify({
        note: 'Metrics available via CLI: npx dev-loop metrics',
        message: 'Use the metrics command for detailed metrics',
      });
    },
  });
}
