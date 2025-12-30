#!/usr/bin/env node

import { FastMCP } from 'fastmcp';
import { loadConfig } from '../config/loader';
import { registerCoreTools } from './tools/core';
import { registerDebugTools } from './tools/debug';
import { registerControlTools } from './tools/control';
import { registerEvolutionTools } from './tools/evolution';

const mcp = new FastMCP({
  name: 'dev-loop',
  version: '1.0.0',
});

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
registerEvolutionTools(mcp, getConfig);

// Start the MCP server with stdio transport
mcp.start({ transportType: 'stdio' }).catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
