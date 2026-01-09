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
// IMPORTANT: Handle case where mcp.json sets env vars as literal placeholder strings (e.g., "${ANTHROPIC_API_KEY}")
// We need to load from .env file directly and override any placeholder literals
const envPath = path.join(process.cwd(), '.env');

// Store existing env vars to detect placeholders
const existingEnv = { ...process.env };

// Load .env file - use override: true to ensure .env values take precedence over process.env
// This is necessary because mcp.json might set placeholders that we need to override
let dotenvResult: { error?: Error; parsed?: Record<string, string> };
if (fs.existsSync(envPath)) {
  dotenvResult = dotenvConfig({ path: envPath, override: true });

  // Parse .env file manually to extract values (in case dotenv doesn't override properly)
  const envFileContent = fs.readFileSync(envPath, 'utf-8');
  const envLines = envFileContent.split('\n');

  for (const line of envLines) {
    // Skip comments and empty lines
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse KEY="value" or KEY=value format
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (match) {
      const [, key, rawValue] = match;

      // Check if existing value is a placeholder literal (e.g., "${VAR_NAME}")
      const existingValue = existingEnv[key];
      const isPlaceholder = existingValue && existingValue.startsWith('${') && existingValue.endsWith('}');

      // Always override placeholders, or if key is one we care about
      if (isPlaceholder || ['ANTHROPIC_API_KEY', 'PERPLEXITY_API_KEY', 'OPENAI_API_KEY'].includes(key)) {
        let value = rawValue.trim();
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
  }
} else {
  dotenvResult = { error: new Error('.env file not found') };
}

// Strip quotes from values if present (dotenv sometimes preserves quotes from .env file)
if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.startsWith('"') && process.env.ANTHROPIC_API_KEY.endsWith('"')) {
  process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY.slice(1, -1);
}

// Debug: Write dotenv loading result to a debug file
const apiKey = process.env.ANTHROPIC_API_KEY;
const debugInfo = {
  timestamp: new Date().toISOString(),
  cwd: process.cwd(),
  envPath,
  dotenvLoaded: !dotenvResult.error,
  dotenvError: dotenvResult.error?.message,
  anthropicKeySet: !!apiKey,
  anthropicKeyLength: apiKey?.length || 0,
  anthropicKeyPrefix: apiKey?.substring(0, 20) || 'NOT_SET',
  anthropicKeySuffix: apiKey?.length > 20 ? apiKey?.substring(apiKey.length - 10) : 'NOT_SET',
  envFileExists: fs.existsSync(envPath),
  envFileContent: fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf-8').substring(0, 200) : 'NOT_FOUND',
};
try {
  fs.writeFileSync('/tmp/dev-loop-mcp-debug.json', JSON.stringify(debugInfo, null, 2));
} catch (e) {
  // Silently fail
}

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

  // In MCP mode, don't write to stderr (Cursor MCP client prefixes all stderr with [error])
  // Only write actual errors to stderr, and only if MCP_DEBUG is enabled
  // All informational logs go to the log file only
  if (process.env.MCP_DEBUG === 'true' && type === 'ERROR') {
    // Only actual errors go to stderr in debug mode
    process.stderr.write(`[ERROR] [MCP ${type}] ${toolName}: ${JSON.stringify(data, null, 2)}\n`);
  }
  // REQUEST/RESPONSE logs are written to file only (via MCP_LOG_PATH above)
}

// Create MCP server
const mcp = new FastMCP({
  name: 'dev-loop',
  version: '1.0.0',
});

// Set global MCP mode environment variable (for code that uses console.log directly)
process.env.DEV_LOOP_MCP_MODE = 'true';

// Configure logger for MCP mode FIRST (before redirecting console.log)
// This ensures all console.log calls go to the log file instead of stderr
let mcpLogger: any = null;
const logPath = '/tmp/dev-loop.log';
(async () => {
  try {
    const { logger } = await import('../core/utils/logger.js');
    logger.configure({
      logPath,
      debug: process.env.MCP_DEBUG === 'true',
      mcpMode: true,  // Suppress console output in MCP mode (writes to file only)
    });
    mcpLogger = logger;
  } catch (e) {
    // Logger not available, continue without it
  }
})();

// CRITICAL: Redirect console.log to log file instead of stderr in MCP mode
// MCP uses stdout for JSON-RPC, so any console.log breaks the protocol
// Cursor MCP client prefixes ALL stderr with [error], so we write to log file instead
const originalConsoleLog = console.log;
console.log = (...args: any[]) => {
  const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');

  // Write to log file via logger (if available) instead of stderr
  // This prevents Cursor MCP client from prefixing with [error]
  if (mcpLogger) {
    mcpLogger.info(message);
  } else {
    // Fallback: write to log file directly if logger not yet initialized
    try {
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] [INFO] ${message}\n`);
    } catch (e) {
      // If log file write fails, try MCP log file
      try {
        fs.appendFileSync(MCP_LOG_PATH, `[INFO] ${new Date().toISOString()} ${message}\n`);
      } catch (e2) {
        // Silently fail - don't break execution
      }
    }
  }
};

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
    const { WorkflowEngine } = await import('../core/execution/workflow.js');

    const config = await loadConfig(args.config);
    if (args.debug) {
      (config as any).debug = true;
    }
    // Mark as MCP mode to suppress console.log output (which breaks JSON-RPC)
    (config as any).mcpMode = true;

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
    const { StateManager } = await import('../core/utils/state-manager.js');

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
    const { TaskMasterBridge } = await import('../core/execution/task-bridge.js');

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
// Task Management Tools
// ============================================

addLoggedTool({
  name: 'devloop_diagnostics',
  description: 'Get diagnostics including retry counts, blocked tasks, and recent failures',
  parameters: z.object({
    config: z.string().optional().describe('Path to config file (optional)'),
  }),
  execute: async (args: { config?: string }) => {
    const { loadConfig } = await import('../config/loader.js');
    const { TaskMasterBridge } = await import('../core/execution/task-bridge.js');

    const config = await loadConfig(args.config);
    const taskBridge = new TaskMasterBridge(config);

    try {
      const allTasks = await taskBridge.getAllTasks();
      const blockedTasks = allTasks.filter((t: any) => t.status === 'blocked');
      const investigationTasks = allTasks.filter((t: any) => String(t.id).startsWith('investigation-'));
      const retryCounts = taskBridge.getAllRetryCounts();
      const skipInvestigation = (config as any).autonomous?.skipInvestigation;

      // Read retry counts from disk for accuracy
      const retryCountPath = path.join(process.cwd(), '.devloop/retry-counts.json');
      let persistedRetryCounts: Record<string, number> = {};
      try {
        if (fs.existsSync(retryCountPath)) {
          persistedRetryCounts = JSON.parse(fs.readFileSync(retryCountPath, 'utf-8'));
        }
      } catch {
        // Ignore
      }

      return JSON.stringify({
        blockedTasks: blockedTasks.map((t: any) => ({ id: t.id, title: t.title })),
        blockedCount: blockedTasks.length,
        investigationTasks: investigationTasks.map((t: any) => ({ id: t.id, status: t.status })),
        investigationCount: investigationTasks.length,
        skipInvestigationConfig: skipInvestigation ?? false,
        retryCounts: persistedRetryCounts,
        maxRetries: (config as any).autonomous?.maxTaskRetries || 3,
        pendingCount: allTasks.filter((t: any) => t.status === 'pending').length,
        totalTasks: allTasks.length,
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
    const { TaskMasterBridge } = await import('../core/execution/task-bridge.js');

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
    const { TaskMasterBridge } = await import('../core/execution/task-bridge.js');

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

// ============================================
// Cursor AI Tools (2)
// ============================================

// Import and register Cursor AI tools
try {
  const { registerCursorAITools } = await import('./tools/cursor-ai.js');
  registerCursorAITools(mcp);
} catch (error) {
  console.error('Failed to register Cursor AI tools:', error);
  // Continue without Cursor AI tools if import fails
}

// Import and register Cursor Chat tools
try {
  const { registerCursorChatTools } = await import('./tools/cursor-chat.js');
  registerCursorChatTools(mcp);
} catch (error) {
  console.error('Failed to register Cursor Chat tools:', error);
  // Continue without Cursor Chat tools if import fails
}

// Start the MCP server
mcp.start({ transportType: 'stdio' }).catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
