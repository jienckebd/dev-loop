#!/usr/bin/env node

/**
 * Dev-Loop MCP Server (ESM Module)
 * 
 * This is a separate ESM entry point for the MCP server since fastmcp requires ESM.
 * It dynamically imports the CommonJS modules from dev-loop.
 */

import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

// Load .env file from current working directory
dotenvConfig({ path: path.join(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// MCP Request/Response Logger
const MCP_LOG_PATH = process.env.MCP_LOG_PATH || '/tmp/dev-loop-mcp.log';

function logMcp(type: 'REQUEST' | 'RESPONSE' | 'ERROR', toolName: string, data: any): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${type} ${toolName}: ${JSON.stringify(data)}\n`;
  
  try {
    fs.appendFileSync(MCP_LOG_PATH, logLine);
  } catch (e) {
    // Silently fail if we can't write to log
  }
  
  // Also output to stderr for debug visibility (MCP uses stdout for protocol)
  if (process.env.MCP_DEBUG === 'true') {
    console.error(`[MCP ${type}] ${toolName}:`, JSON.stringify(data, null, 2));
  }
}

// Create MCP server
const mcp = new FastMCP({
  name: 'dev-loop',
  version: '1.0.0',
});

// Initialize MCP log file
try {
  fs.writeFileSync(MCP_LOG_PATH, `# Dev-Loop MCP Log - Started ${new Date().toISOString()}\n`);
} catch (e) {
  // Silently fail
}

// Helper to wrap tool execution with logging
function addLoggedTool(tool: { name: string; description: string; parameters: any; execute: any }) {
  const originalExecute = tool.execute;
  tool.execute = async (args: any, context: any) => {
    logMcp('REQUEST', tool.name, { args });
    try {
      const result = await originalExecute(args, context);
      logMcp('RESPONSE', tool.name, { result });
      return result;
    } catch (error) {
      logMcp('ERROR', tool.name, { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  };
  mcp.addTool(tool);
}

// ============================================
// Core Workflow Tools (5)
// ============================================

addLoggedTool({
  name: 'devloop_run',
  description: 'Execute one workflow iteration',
  parameters: z.object({
    config: z.string().optional().describe('Path to config file (optional)'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  execute: async (args: { config?: string; debug?: boolean }) => {
    // Dynamic import of CommonJS modules
    const { loadConfig } = await import('../config/loader.js');
    const { WorkflowEngine } = await import('../core/workflow-engine.js');
    
    const config = await loadConfig(args.config);
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

addLoggedTool({
  name: 'devloop_status',
  description: 'Get current progress and state',
  parameters: z.object({
    config: z.string().optional().describe('Path to config file (optional)'),
  }),
  execute: async (args: { config?: string }) => {
    const { loadConfig } = await import('../config/loader.js');
    const { StateManager } = await import('../core/state-manager.js');
    
    const config = await loadConfig(args.config);
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

addLoggedTool({
  name: 'devloop_list_tasks',
  description: 'List tasks with filtering',
  parameters: z.object({
    config: z.string().optional().describe('Path to config file (optional)'),
    status: z.string().optional().describe('Filter by status (pending, in-progress, done, failed, blocked)'),
  }),
  execute: async (args: { config?: string; status?: string }) => {
    const { loadConfig } = await import('../config/loader.js');
    const { TaskMasterBridge } = await import('../core/task-bridge.js');
    
    const config = await loadConfig(args.config);
    const taskBridge = new TaskMasterBridge(config);

    let tasks;
    if (args.status === 'pending') {
      tasks = await taskBridge.getPendingTasks();
    } else {
      const allTasks = await taskBridge.getAllTasks();
      if (args.status) {
        tasks = allTasks.filter((t: any) => t.status === args.status);
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

addLoggedTool({
  name: 'devloop_prd',
  description: 'Execute PRD autonomously via test-driven development',
  parameters: z.object({
    prdPath: z.string().describe('Path to PRD file'),
    config: z.string().optional().describe('Path to config file (optional)'),
    debug: z.boolean().optional().describe('Enable debug mode'),
    resume: z.boolean().optional().describe('Resume from previous execution state'),
  }),
  execute: async (args: { prdPath: string; config?: string; debug?: boolean; resume?: boolean }) => {
    const { loadConfig } = await import('../config/loader.js');
    const { prdCommand } = await import('../cli/commands/prd.js');
    
    const config = await loadConfig(args.config);
    if (args.debug) {
      (config as any).debug = true;
    }

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
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// ============================================
// Evolution Mode Tools (3)
// ============================================

addLoggedTool({
  name: 'devloop_evolution_start',
  description: 'Start evolution mode with a PRD',
  parameters: z.object({
    prd: z.string().describe('Path to PRD file'),
    config: z.string().optional().describe('Path to config file'),
  }),
  execute: async (args: { prd: string; config?: string }) => {
    const { loadConfig } = await import('../config/loader.js');
    const { PrdTracker } = await import('../core/prd-tracker.js');
    
    const config = await loadConfig(args.config);
    const prdTracker = new PrdTracker(config);
    
    // Initialize evolution mode state
    const evolutionState = {
      active: true,
      prdPath: args.prd,
      startedAt: new Date().toISOString(),
      iterations: 0,
    };
    
    const statePath = path.join(process.cwd(), '.devloop', 'evolution-state.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(evolutionState, null, 2));
    
    return JSON.stringify({
      success: true,
      message: 'Evolution mode started',
      state: evolutionState,
    });
  },
});

addLoggedTool({
  name: 'devloop_evolution_status',
  description: 'Get evolution mode status',
  parameters: z.object({}),
  execute: async () => {
    const statePath = path.join(process.cwd(), '.devloop', 'evolution-state.json');
    
    try {
      const content = fs.readFileSync(statePath, 'utf-8');
      const state = JSON.parse(content);
      return JSON.stringify({
        active: state.active,
        ...state,
      });
    } catch {
      return JSON.stringify({
        active: false,
        message: 'Evolution mode not active',
      });
    }
  },
});

addLoggedTool({
  name: 'devloop_evolution_stop',
  description: 'Stop evolution mode',
  parameters: z.object({}),
  execute: async () => {
    const statePath = path.join(process.cwd(), '.devloop', 'evolution-state.json');
    
    try {
      const content = fs.readFileSync(statePath, 'utf-8');
      const state = JSON.parse(content);
      state.active = false;
      state.stoppedAt = new Date().toISOString();
      fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      
      return JSON.stringify({
        success: true,
        message: 'Evolution mode stopped',
        state,
      });
    } catch {
      return JSON.stringify({
        success: false,
        message: 'Evolution mode was not active',
      });
    }
  },
});

// ============================================
// Debugging Tools (3 essential ones)
// ============================================

addLoggedTool({
  name: 'devloop_logs',
  description: 'View and analyze logs',
  parameters: z.object({
    lines: z.number().optional().describe('Number of lines to show'),
    source: z.string().optional().describe('Log source (web, mcp, devloop)'),
  }),
  execute: async (args: { lines?: number; source?: string }) => {
    const lines = args.lines || 50;
    const source = args.source || 'mcp';
    
    let logPath: string;
    switch (source) {
      case 'mcp':
        logPath = MCP_LOG_PATH;
        break;
      case 'devloop':
        logPath = '/tmp/dev-loop.log';
        break;
      default:
        logPath = MCP_LOG_PATH;
    }
    
    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      const allLines = content.split('\n');
      const lastLines = allLines.slice(-lines).join('\n');
      
      return JSON.stringify({
        source,
        lines: lastLines,
        totalLines: allLines.length,
      });
    } catch {
      return JSON.stringify({
        error: `Could not read log file: ${logPath}`,
      });
    }
  },
});

addLoggedTool({
  name: 'devloop_diagnose',
  description: 'Analyze failures and suggest fixes',
  parameters: z.object({
    taskId: z.string().optional().describe('Task ID to diagnose'),
  }),
  execute: async (args: { taskId?: string }) => {
    const { loadConfig } = await import('../config/loader.js');
    const { TaskMasterBridge } = await import('../core/task-bridge.js');
    
    const config = await loadConfig();
    const taskBridge = new TaskMasterBridge(config);
    
    const allTasks = await taskBridge.getAllTasks();
    const failedTasks = allTasks.filter((t: any) => t.status === 'failed' || t.status === 'blocked');
    
    return JSON.stringify({
      failedTasks: failedTasks.map((t: any) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        error: t.error,
      })),
      count: failedTasks.length,
    });
  },
});

// ============================================
// Control Tools (2 essential ones)
// ============================================

addLoggedTool({
  name: 'devloop_reset',
  description: 'Reset task(s) to pending',
  parameters: z.object({
    taskId: z.string().optional().describe('Task ID to reset (or "all" for all tasks)'),
  }),
  execute: async (args: { taskId?: string }) => {
    const { loadConfig } = await import('../config/loader.js');
    const { TaskMasterBridge } = await import('../core/task-bridge.js');
    
    const config = await loadConfig();
    const taskBridge = new TaskMasterBridge(config);
    
    if (args.taskId === 'all') {
      const allTasks = await taskBridge.getAllTasks();
      for (const task of allTasks) {
        await taskBridge.updateTaskStatus(task.id, 'pending');
      }
      return JSON.stringify({
        success: true,
        message: `Reset ${allTasks.length} tasks to pending`,
      });
    } else if (args.taskId) {
      await taskBridge.updateTaskStatus(args.taskId, 'pending');
      return JSON.stringify({
        success: true,
        message: `Reset task ${args.taskId} to pending`,
      });
    }
    
    return JSON.stringify({
      success: false,
      error: 'No task ID provided',
    });
  },
});

addLoggedTool({
  name: 'devloop_validate',
  description: 'Validate config and environment',
  parameters: z.object({
    config: z.string().optional().describe('Path to config file'),
  }),
  execute: async (args: { config?: string }) => {
    const { loadConfig } = await import('../config/loader.js');
    
    try {
      const config = await loadConfig(args.config);
      
      // Check essential config
      const checks = {
        configLoaded: true,
        tasksPathSet: !!config.taskMaster?.tasksPath,
        testingConfigured: !!config.testing?.runner,
        logsConfigured: !!config.logs?.sources,
      };
      
      const allPassed = Object.values(checks).every(Boolean);
      
      return JSON.stringify({
        valid: allPassed,
        checks,
      });
    } catch (error) {
      return JSON.stringify({
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});

// Start the MCP server
mcp.start({ transportType: 'stdio' }).catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
