import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { TaskMasterBridge } from "../../core/execution/task-bridge";
import { ConfigLoader, FastMCPType } from './index';
import { validateConfigOverlay, ConfigOverlay, frameworkConfigSchema, validateConfig } from '../../config/schema';
import { PrdConfigParser } from "../../core/prd/parser/config-parser";

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
      clearRetryCount: z.boolean().optional().describe('Clear retry count when resetting task(s)'),
    }),
    execute: async (args: { taskId?: string; config?: string; allFailed?: boolean; all?: boolean; clearRetryCount?: boolean }, context: any) => {
      const config = await getConfig(args.config);
      const taskBridge = new TaskMasterBridge(config);

      try {
        if (args.all) {
          const tasks = await taskBridge.getAllTasks();
          for (const task of tasks) {
            await taskBridge.updateTaskStatus(task.id, 'pending');
            if (args.clearRetryCount) {
              taskBridge.resetRetryCount(task.id);
            }
          }
          return JSON.stringify({
            success: true,
            message: `Reset ${tasks.length} tasks to pending${args.clearRetryCount ? ' and cleared retry counts' : ''}`,
            count: tasks.length,
          });
        } else if (args.allFailed) {
          const allTasks = await taskBridge.getAllTasks();
          const failed = allTasks.filter(t => t.status === 'blocked');
          for (const task of failed) {
            await taskBridge.updateTaskStatus(task.id, 'pending');
            if (args.clearRetryCount) {
              taskBridge.resetRetryCount(task.id);
            }
          }
          return JSON.stringify({
            success: true,
            message: `Reset ${failed.length} failed/blocked tasks to pending${args.clearRetryCount ? ' and cleared retry counts' : ''}`,
            count: failed.length,
          });
        } else if (args.taskId) {
          await taskBridge.updateTaskStatus(args.taskId, 'pending');
          if (args.clearRetryCount) {
            taskBridge.resetRetryCount(args.taskId);
          }
          return JSON.stringify({
            success: true,
            message: `Reset task ${args.taskId} to pending${args.clearRetryCount ? ' and cleared retry count' : ''}`,
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

  // devloop_validate_config - Validate config at a specific level
  mcp.addTool({
    name: 'devloop_validate_config',
    description: 'Validate configuration schema at specified level (project, framework, prd-set, prd, phase)',
    parameters: z.object({
      level: z.enum(['project', 'framework', 'prd-set', 'prd', 'phase']).describe('Config level to validate'),
      path: z.string().optional().describe('Path to config file or PRD'),
      prdSetId: z.string().optional().describe('PRD set ID for prd-set level'),
      phaseId: z.number().optional().describe('Phase ID for phase level'),
    }),
    execute: async (args: { level: string; path?: string; prdSetId?: string; phaseId?: number }, context: any) => {
      try {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (args.level === 'project') {
          const config = await getConfig(args.path);
          try {
            validateConfig(config);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        } else if (args.level === 'framework') {
          const config = await getConfig(args.path);
          if (config.framework) {
            const result = frameworkConfigSchema.safeParse(config.framework);
            if (!result.success) {
              for (const issue of result.error.issues) {
                errors.push(`framework.${issue.path.join('.')}: ${issue.message}`);
              }
            }
          } else {
            warnings.push('No framework config defined');
          }
        } else if (args.level === 'prd-set') {
          if (!args.prdSetId && !args.path) {
            errors.push('prdSetId or path required for prd-set level');
          } else {
            const setDir = args.path || path.resolve(process.cwd(), '.taskmaster/planning', args.prdSetId || '');
            const jsonPath = path.join(setDir, 'prd-set-config.json');
            const yamlPath = path.join(setDir, 'prd-set-config.yml');

            let configOverlay: ConfigOverlay | undefined;
            if (await fs.pathExists(jsonPath)) {
              const content = await fs.readFile(jsonPath, 'utf-8');
              configOverlay = JSON.parse(content);
            } else if (await fs.pathExists(yamlPath)) {
              const content = await fs.readFile(yamlPath, 'utf-8');
              configOverlay = parseYaml(content);
            }

            if (configOverlay) {
              const validation = validateConfigOverlay(configOverlay, 'prd-set');
              errors.push(...validation.errors);
              warnings.push(...validation.warnings);
            } else {
              warnings.push('No PRD set config file found');
            }
          }
        } else if (args.level === 'prd') {
          if (!args.path) {
            errors.push('path required for prd level');
          } else {
            const parser = new PrdConfigParser();
            const config = await parser.parsePrdConfig(path.resolve(process.cwd(), args.path));
            if (config) {
              const validation = validateConfigOverlay(config as ConfigOverlay, 'prd');
              errors.push(...validation.errors);
              warnings.push(...validation.warnings);
            } else {
              warnings.push('No config section found in PRD');
            }
          }
        } else if (args.level === 'phase') {
          if (!args.path || args.phaseId === undefined) {
            errors.push('path and phaseId required for phase level');
          } else {
            const parser = new PrdConfigParser();
            const metadata = await parser.parsePrdMetadata(path.resolve(process.cwd(), args.path));
            const phase = metadata?.requirements?.phases?.find(p => p.id === args.phaseId);
            if (phase?.config) {
              const validation = validateConfigOverlay(phase.config as ConfigOverlay, 'phase');
              errors.push(...validation.errors);
              warnings.push(...validation.warnings);
            } else {
              warnings.push(`Phase ${args.phaseId} has no config overlay`);
            }
          }
        }

        return JSON.stringify({
          level: args.level,
          valid: errors.length === 0,
          errors,
          warnings,
        });
      } catch (error) {
        return JSON.stringify({
          level: args.level,
          valid: false,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        });
      }
    },
  });

  // devloop_validate_prd_config - Validate PRD config overlay and phase config overlays
  mcp.addTool({
    name: 'devloop_validate_prd_config',
    description: 'Validate PRD config overlay and all phase config overlays',
    parameters: z.object({
      prdPath: z.string().describe('Path to PRD file'),
      validatePhases: z.boolean().optional().default(true).describe('Also validate phase config overlays'),
    }),
    execute: async (args: { prdPath: string; validatePhases?: boolean }, context: any) => {
      try {
        const resolvedPath = path.resolve(process.cwd(), args.prdPath);
        const parser = new PrdConfigParser();

        const errors: string[] = [];
        const warnings: string[] = [];
        const phaseResults: Array<{ phaseId: number; errors: string[]; warnings: string[] }> = [];

        // Validate PRD config
        const config = await parser.parsePrdConfig(resolvedPath);
        if (config) {
          const validation = validateConfigOverlay(config as ConfigOverlay, 'prd');
          errors.push(...validation.errors);
          warnings.push(...validation.warnings);
        }

        // Validate phase configs
        if (args.validatePhases !== false) {
          const metadata = await parser.parsePrdMetadata(resolvedPath);
          if (metadata?.requirements?.phases) {
            for (const phase of metadata.requirements.phases) {
              if (phase.config) {
                const validation = validateConfigOverlay(phase.config as ConfigOverlay, 'phase');
                phaseResults.push({
                  phaseId: phase.id,
                  errors: validation.errors,
                  warnings: validation.warnings,
                });
                if (!validation.valid) {
                  for (const err of validation.errors) {
                    errors.push(`Phase ${phase.id}: ${err}`);
                  }
                }
              }
            }
          }
        }

        return JSON.stringify({
          valid: errors.length === 0,
          prdErrors: errors,
          prdWarnings: warnings,
          phaseResults,
        });
      } catch (error) {
        return JSON.stringify({
          valid: false,
          prdErrors: [error instanceof Error ? error.message : String(error)],
          prdWarnings: [],
          phaseResults: [],
        });
      }
    },
  });

  // devloop_validate_prd_set_config - Validate PRD set config overlay
  mcp.addTool({
    name: 'devloop_validate_prd_set_config',
    description: 'Validate PRD set config overlay',
    parameters: z.object({
      prdSetId: z.string().describe('PRD set ID'),
      prdSetPath: z.string().optional().describe('Path to PRD set directory (optional, overrides prdSetId)'),
    }),
    execute: async (args: { prdSetId: string; prdSetPath?: string }, context: any) => {
      try {
        const setDir = args.prdSetPath
          ? path.resolve(process.cwd(), args.prdSetPath)
          : path.resolve(process.cwd(), '.taskmaster/planning', args.prdSetId);

        if (!await fs.pathExists(setDir)) {
          return JSON.stringify({
            valid: false,
            errors: [`PRD set directory not found: ${setDir}`],
            warnings: [],
          });
        }

        const jsonPath = path.join(setDir, 'prd-set-config.json');
        const yamlPath = path.join(setDir, 'prd-set-config.yml');

        let configOverlay: ConfigOverlay | undefined;
        let configFile: string | undefined;

        if (await fs.pathExists(jsonPath)) {
          const content = await fs.readFile(jsonPath, 'utf-8');
          configOverlay = JSON.parse(content);
          configFile = jsonPath;
        } else if (await fs.pathExists(yamlPath)) {
          const content = await fs.readFile(yamlPath, 'utf-8');
          configOverlay = parseYaml(content);
          configFile = yamlPath;
        }

        if (!configOverlay) {
          return JSON.stringify({
            valid: true,
            configFile: null,
            errors: [],
            warnings: ['No PRD set config file found (prd-set-config.json or prd-set-config.yml)'],
          });
        }

        const validation = validateConfigOverlay(configOverlay, 'prd-set');
        return JSON.stringify({
          valid: validation.valid,
          configFile,
          errors: validation.errors,
          warnings: validation.warnings,
        });
      } catch (error) {
        return JSON.stringify({
          valid: false,
          configFile: null,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        });
      }
    },
  });
}
