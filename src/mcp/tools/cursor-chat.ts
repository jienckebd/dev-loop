/**
 * Cursor Chat MCP Tools
 *
 * MCP tools that allow Cursor agents to manage chat requests and create chats
 */

import { z } from 'zod';
import { FastMCPType } from './index';
import { listPendingChatRequests, listAllChatRequests, markRequestProcessed } from '../../providers/ai/cursor-chat-requests';
import { listGeneratedAgents } from '../../providers/ai/cursor-agent-generator';
import { ChatRequestAutoProcessor } from '../../providers/ai/cursor-chat-auto-processor';
import { loadConfig } from '../../config/loader';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Register Cursor Chat MCP tools
 */
export function registerCursorChatTools(mcp: FastMCPType): void {

  // Tool: List pending chat requests
  mcp.addTool({
    name: 'cursor_chat_list_requests',
    description: 'List all pending chat requests that need to be processed',
    parameters: z.object({}),
    execute: async () => {
      const requests = await listPendingChatRequests();
      return JSON.stringify({
        success: true,
        requests: requests.map(req => ({
          id: req.id,
          agentName: req.agentName,
          question: req.question,
          model: req.model,
          mode: req.mode,
          createdAt: req.createdAt,
          context: req.context,
        })),
        count: requests.length,
      });
    },
  });

  // Tool: List all chat requests
  mcp.addTool({
    name: 'cursor_chat_list_all',
    description: 'List all chat requests including pending, processed, and failed',
    parameters: z.object({}),
    execute: async () => {
      const requests = await listAllChatRequests();
      return JSON.stringify({
        success: true,
        requests: requests.map(req => ({
          id: req.id,
          agentName: req.agentName,
          question: req.question,
          model: req.model,
          mode: req.mode,
          status: req.status,
          createdAt: req.createdAt,
          context: req.context,
        })),
        count: requests.length,
      });
    },
  });

  // Tool: Auto-process all pending chat requests
  mcp.addTool({
    name: 'cursor_chat_auto_process_all',
    description: 'Automatically process all pending chat requests by creating instruction files',
    parameters: z.object({}),
    execute: async () => {
      const config = await loadConfig();
      const processor = new ChatRequestAutoProcessor(config as any);
      const results = await processor.processAllPending();

      return JSON.stringify({
        success: true,
        processed: results.length,
        successful: results.filter(r => r.status === 'success').length,
        failed: results.filter(r => r.status === 'failed').length,
        results: results.map(r => ({
          requestId: r.requestId,
          status: r.status,
          instructionPath: r.instructionPath,
          error: r.error,
        })),
      });
    },
  });

  // Tool: List available agents
  mcp.addTool({
    name: 'cursor_agent_list',
    description: 'List all available agent config files in .cursor/agents/',
    parameters: z.object({}),
    execute: async () => {
      const agents = await listGeneratedAgents();
      return JSON.stringify({
        success: true,
        agents: agents.map(agent => ({
          name: agent.name,
          filePath: agent.filePath,
          createdAt: agent.createdAt,
        })),
        count: agents.length,
      });
    },
  });

  // Tool: List chat instruction files
  mcp.addTool({
    name: 'cursor_chat_list_instructions',
    description: 'List all chat instruction files that have been created',
    parameters: z.object({}),
    execute: async () => {
      const instructionsPath = getInstructionsPath();

      try {
        if (!fs.existsSync(instructionsPath)) {
          return JSON.stringify({ success: true, instructions: [], count: 0 });
        }

        const files = await fs.promises.readdir(instructionsPath);
        const instructionFiles = files.filter(file => file.endsWith('.json'));

        const instructions = [];
        for (const file of instructionFiles) {
          const filePath = path.join(instructionsPath, file);
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const instruction = JSON.parse(content);
          instructions.push({
            requestId: instruction.requestId,
            agentName: instruction.agentName,
            question: instruction.question,
            model: instruction.model,
            mode: instruction.mode,
            filePath,
          });
        }

        return JSON.stringify({
          success: true,
          instructions,
          count: instructions.length,
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          instructions: [],
          count: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });
}

/**
 * Get the chat instructions directory path from config or use default
 */
function getInstructionsPath(): string {
  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    if (fs.existsSync(configPath)) {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      if (config?.cursor?.agents?.chatInstructionsPath) {
        return path.join(process.cwd(), config.cursor.agents.chatInstructionsPath);
      }
    }
  } catch (error) {
    // Config loading failed, use default
  }

  // Default path
  return path.join(process.cwd(), 'files-private', 'cursor', 'chat-instructions');
}

