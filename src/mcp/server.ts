#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { config } from 'dotenv';
import { loadConfig } from '../config/loader';
import { registerCoreTools } from './tools/core';
import { registerDebugTools } from './tools/debug';
import { registerControlTools } from './tools/control';
import { registerContributionTools } from './tools/contribution';
import { registerBackgroundAgentTools } from './tools/background-agent';
import { registerCodebaseQueryTools } from './tools/codebase-query';
import { registerPlaywrightTDDTools } from './tools/playwright-tdd';
import { registerEventTools } from './tools/events';

// Load .env file from project root before anything else
// This ensures API keys are available when config loads
const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

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

// Main async function to handle ESM dynamic import
async function main() {
  // Dynamic import for ESM-only fastmcp module
  const fastmcp = await (Function('return import("fastmcp")')() as Promise<any>);
  const { FastMCP } = fastmcp;

  // Create a wrapped FastMCP that logs all tool calls
  class LoggingFastMCP extends FastMCP {
    addTool(tool: any): void {
      const originalExecute = tool.execute;
      const toolName = tool.name;

      tool.execute = async (args: any, context: any) => {
        logMcp('REQUEST', toolName, { args });

        try {
          const result = await originalExecute(args, context);
          logMcp('RESPONSE', toolName, { result });
          return result;
        } catch (error) {
          logMcp('ERROR', toolName, { error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      };

      super.addTool(tool);
    }
  }

  const mcp = new LoggingFastMCP({
    name: 'dev-loop',
    version: '1.0.0',
  });

  // Initialize MCP log file
  try {
    fs.writeFileSync(MCP_LOG_PATH, `# Dev-Loop MCP Log - Started ${new Date().toISOString()}\n`);
  } catch (e) {
    // Silently fail
  }

  // Load config once at startup
  let config: any = null;

  async function getConfig(configPath?: string) {
    if (!config) {
      config = await loadConfig(configPath);
    }
    return config;
  }

  // Register all tool categories
  registerCoreTools(mcp, getConfig);
  registerDebugTools(mcp, getConfig);
  registerControlTools(mcp, getConfig);
  registerContributionTools(mcp, getConfig);
  registerBackgroundAgentTools(mcp, getConfig);

  // Register new enhancement tools (AST, codebase intelligence, Playwright TDD)
  registerCodebaseQueryTools(mcp, getConfig);
  registerPlaywrightTDDTools(mcp, getConfig);
  registerEventTools(mcp);

  // Start the MCP server with stdio transport
  await mcp.start({ transportType: 'stdio' });
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
