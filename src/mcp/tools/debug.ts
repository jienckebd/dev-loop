import { z } from 'zod';
import * as fs from 'fs-extra';
import { TaskMasterBridge } from '../../core/task-bridge';
import { LogAnalyzerFactory } from '../../providers/log-analyzers/factory';
import { ConfigLoader, FastMCPType } from './index';

export function registerDebugTools(mcp: FastMCPType, getConfig: ConfigLoader): void {
  // devloop_diagnose - Analyze failures and suggest fixes
  mcp.addTool({
    name: 'devloop_diagnose',
    description: 'Analyze task failures and suggest fixes',
    parameters: z.object({
      taskId: z.string().optional().describe('Task ID to diagnose (optional)'),
      config: z.string().optional().describe('Path to config file (optional)'),
      suggest: z.boolean().optional().describe('Suggest fixes for issues'),
    }),
    execute: async (args: { taskId?: string; config?: string; suggest?: boolean }, context: any) => {
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
    execute: async (args: { taskId: string; config?: string; tokens?: boolean }, context: any) => {
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
      clear: z.boolean().optional().describe('Clear the log file'),
    }),
    execute: async (args: { config?: string; analyze?: boolean; tail?: number; clear?: boolean }, context: any) => {
      const config = await getConfig(args.config);
      const logPath = config.logs.outputPath;

      if (!logPath) {
        return JSON.stringify({
          error: 'Log file path not configured',
        });
      }

      // Handle clear
      if (args.clear) {
        if (await fs.pathExists(logPath)) {
          await fs.writeFile(logPath, '');
          return JSON.stringify({
            success: true,
            message: 'Log file cleared',
          });
        } else {
          return JSON.stringify({
            success: false,
            error: 'Log file not found',
          });
        }
      }

      if (!await fs.pathExists(logPath)) {
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

        // Categorize errors for background agent specific issues
        const backgroundAgentErrors: string[] = [];
        const jsonParsingErrors: string[] = [];
        const sessionErrors: string[] = [];
        const otherErrors: string[] = [];

        for (const error of analysis.errors) {
          const errorLower = error.toLowerCase();
          if (errorLower.includes('cursorchatopener') || errorLower.includes('cursorprovider') || errorLower.includes('background agent')) {
            backgroundAgentErrors.push(error);
          } else if (errorLower.includes('control character') || errorLower.includes('json') || errorLower.includes('parse')) {
            jsonParsingErrors.push(error);
          } else if (errorLower.includes('session')) {
            sessionErrors.push(error);
          } else {
            otherErrors.push(error);
          }
        }

        return JSON.stringify({
          logs: displayLines,
          totalLines: lines.length,
          showing: displayLines.length,
          analysis: {
            errors: analysis.errors,
            warnings: analysis.warnings,
            summary: analysis.summary,
            categorized: {
              backgroundAgentErrors,
              jsonParsingErrors,
              sessionErrors,
              otherErrors,
            },
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
    execute: async (args: { config?: string; projectType?: string }, context: any) => {
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
      prdSet: z.string().optional().describe('Show metrics for PRD set'),
      prd: z.string().optional().describe('Show metrics for PRD'),
      phase: z.string().optional().describe('Show metrics for phase (format: "prdId:phaseId")'),
      compare: z.string().optional().describe('Compare two PRDs or PRD sets (format: "id1:id2")'),
      trends: z.boolean().optional().describe('Show trends over time'),
      features: z.boolean().optional().describe('Show feature usage metrics'),
      schema: z.boolean().optional().describe('Show schema operation metrics'),
      json: z.boolean().optional().describe('Output as JSON'),
      clear: z.boolean().optional().describe('Clear all metrics'),
    }),
    execute: async (args: {
      config?: string;
      last?: number;
      task?: string;
      summary?: boolean;
      prdSet?: string;
      prd?: string;
      phase?: string;
      compare?: string;
      trends?: boolean;
      features?: boolean;
      schema?: boolean;
      json?: boolean;
      clear?: boolean;
    }, context: any) => {
      try {
        const config = await getConfig(args.config);

        // Handle clear first
        if (args.clear) {
          const metricsPath = (config as any).metrics?.path || '.devloop/metrics.json';
          const { DebugMetrics } = await import('../../core/debug-metrics.js');
          const metrics = new DebugMetrics(metricsPath);
          metrics.clear();
          return JSON.stringify({
            success: true,
            message: 'Metrics cleared',
          });
        }

        // Handle hierarchical metrics
        if (args.prdSet) {
          const { PrdSetMetrics } = await import('../../core/prd-set-metrics.js');
          const prdSetMetrics = new PrdSetMetrics();
          const metrics = prdSetMetrics.getPrdSetMetrics(args.prdSet);
          if (!metrics) {
            return JSON.stringify({
              error: `PRD Set metrics not found: ${args.prdSet}`,
            });
          }
          return JSON.stringify(metrics, null, 2);
        }

        if (args.prd) {
          const { PrdMetrics } = await import('../../core/prd-metrics.js');
          const prdMetrics = new PrdMetrics();
          const metrics = prdMetrics.getPrdMetrics(args.prd);
          if (!metrics) {
            return JSON.stringify({
              error: `PRD metrics not found: ${args.prd}`,
            });
          }
          return JSON.stringify(metrics, null, 2);
        }

        if (args.phase) {
          const [prdId, phaseIdStr] = args.phase.split(':');
          if (!prdId || !phaseIdStr) {
            return JSON.stringify({
              error: 'Phase format must be "prdId:phaseId"',
            });
          }
          const phaseId = parseInt(phaseIdStr, 10);
          if (isNaN(phaseId)) {
            return JSON.stringify({
              error: `Invalid phase ID: ${phaseIdStr} (must be numeric)`,
            });
          }
          const { PhaseMetrics } = await import('../../core/phase-metrics.js');
          const phaseMetrics = new PhaseMetrics();
          const metrics = phaseMetrics.getPhaseMetrics(phaseId, prdId);
          if (!metrics) {
            return JSON.stringify({
              error: `Phase metrics not found: ${prdId}-${phaseId}`,
            });
          }
          return JSON.stringify(metrics, null, 2);
        }

        if (args.compare) {
          const [id1, id2] = args.compare.split(':');
          if (!id1 || !id2) {
            return JSON.stringify({
              error: 'Compare format must be "id1:id2"',
            });
          }
          const { PrdSetMetrics } = await import('../../core/prd-set-metrics.js');
          const { PrdMetrics } = await import('../../core/prd-metrics.js');
          const prdSetMetrics = new PrdSetMetrics();
          const prdMetrics = new PrdMetrics();

          const set1 = prdSetMetrics.getPrdSetMetrics(id1);
          const set2 = prdSetMetrics.getPrdSetMetrics(id2);
          const prd1 = prdMetrics.getPrdMetrics(id1);
          const prd2 = prdMetrics.getPrdMetrics(id2);

          if (!set1 && !prd1) {
            return JSON.stringify({
              error: `Metrics not found for: ${id1}`,
            });
          }
          if (!set2 && !prd2) {
            return JSON.stringify({
              error: `Metrics not found for: ${id2}`,
            });
          }

          return JSON.stringify({
            id1: set1 || prd1,
            id2: set2 || prd2,
          }, null, 2);
        }

        if (args.trends) {
          const { PrdMetrics } = await import('../../core/prd-metrics.js');
          const prdMetrics = new PrdMetrics();
          const allMetrics = prdMetrics.getAllPrdMetrics();
          return JSON.stringify({
            totalPrds: allMetrics.length,
            metrics: allMetrics,
          }, null, 2);
        }

        if (args.features) {
          const { FeatureTracker } = await import('../../core/feature-tracker.js');
          const featureTracker = new FeatureTracker();
          const allMetrics = featureTracker.getAllFeatureMetrics();
          const mostUsed = featureTracker.getMostUsedFeatures(10);
          return JSON.stringify({
            allMetrics: Object.values(allMetrics),
            mostUsed: mostUsed.map(f => ({
              featureName: f.featureName,
              usageCount: f.usageCount,
              successCount: f.successCount,
              failureCount: f.failureCount,
              successRate: f.usageCount > 0 ? (f.successCount / f.usageCount * 100).toFixed(1) + '%' : '0%',
              avgDuration: f.avgDuration,
              totalTokens: f.totalTokens,
            })),
          }, null, 2);
        }

        if (args.schema) {
          const { SchemaTracker } = await import('../../core/schema-tracker.js');
          const schemaTracker = new SchemaTracker();
          const metrics = schemaTracker.getMetrics();
          return JSON.stringify(metrics, null, 2);
        }

        // Task-level metrics (original implementation)
        const metricsPath = (config as any).metrics?.path || '.devloop/metrics.json';
        const { DebugMetrics } = await import('../../core/debug-metrics.js');
        const metrics = new DebugMetrics(metricsPath);
        const metricsData = metrics.getMetrics();

        // Build response based on parameters
        const response: any = {
          summary: metricsData.summary,
        };

        if (args.task) {
          // Convert task string to number if it's numeric, otherwise skip
          const taskId = parseInt(args.task, 10);
          if (!isNaN(taskId)) {
            const taskRuns = metrics.getRunsForTask(taskId);
            response.task = args.task;
            response.runs = taskRuns;
            response.totalRuns = taskRuns.length;
          } else {
            response.error = `Invalid task ID: ${args.task} (must be numeric)`;
          }
        } else if (args.last) {
          const lastRuns = metrics.getLastNRuns(args.last);
          response.recentRuns = lastRuns;
          response.showing = lastRuns.length;
        } else if (!args.summary) {
          // Include recent runs if not summary-only
          const recentRuns = metrics.getLastNRuns(10);
          response.recentRuns = recentRuns;
        }

        return JSON.stringify(response, null, 2);
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          message: 'Failed to load metrics',
        });
      }
    },
  });
}
