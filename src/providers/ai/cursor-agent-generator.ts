/**
 * Cursor Agent Config Generator
 *
 * Generates agent configuration files in .cursor/agents/ directory
 * that define agents for Cursor IDE.
 *
 * Enhanced with CLI-based opening support via cursor-chat-opener.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AgentConfig } from '../../types';
import { getAgentTemplate } from './cursor-agent-templates';
import { logger } from '../../core/logger';
import { CursorChatOpener } from './cursor-chat-opener';

export interface AgentInfo {
  name: string;
  filePath: string;
  createdAt?: string;
}

export interface GenerateAgentOptions {
  /** Open the agent file in Cursor after generation */
  openInCursor?: boolean;
  /** Reuse existing Cursor window */
  reuseWindow?: boolean;
}

/**
 * Generate an agent configuration file in .cursor/agents/
 *
 * @param agentConfig - Agent configuration object
 * @param options - Generation options (openInCursor, reuseWindow)
 * @returns Promise resolving to the file path of the generated agent config
 * @throws Error if agent config file cannot be written
 *
 * @example
 * ```typescript
 * const filePath = await generateAgentConfig({
 *   name: 'DevLoopCodeGen',
 *   question: 'Generate code for task X',
 *   model: 'Auto',
 *   mode: 'Ask',
 *   purpose: 'Code generation'
 * }, { openInCursor: true });
 * ```
 */
export async function generateAgentConfig(
  agentConfig: AgentConfig,
  options?: GenerateAgentOptions
): Promise<string> {
  const agentsPath = getAgentsPath();
  const fileName = `${agentConfig.name}.md`;
  const filePath = path.join(agentsPath, fileName);

  // Ensure agents directory exists
  await fs.promises.mkdir(agentsPath, { recursive: true });

  // Generate template content
  const template = getAgentTemplate(agentConfig);

  // Write agent config file
  await fs.promises.writeFile(filePath, template, 'utf-8');

  logger.info(`[AgentGenerator] Created agent config: ${filePath}`);

  // Optionally open in Cursor via CLI
  if (options?.openInCursor) {
    await openAgentInCursor(filePath, options.reuseWindow);
  }

  return filePath;
}

/**
 * Open an agent config file in Cursor via CLI
 *
 * @param filePath - Path to the agent config file
 * @param reuseWindow - Whether to reuse existing Cursor window
 * @returns Promise resolving to success status
 */
export async function openAgentInCursor(filePath: string, reuseWindow?: boolean): Promise<boolean> {
  try {
    const opener = new CursorChatOpener();
    if (!opener.isCursorAvailable()) {
      logger.warn('[AgentGenerator] Cursor CLI not available for opening agent');
      return false;
    }

    const success = await opener.openFile(filePath, { reuseWindow });
    if (success) {
      logger.info(`[AgentGenerator] Opened agent in Cursor: ${path.basename(filePath)}`);
    }
    return success;
  } catch (error) {
    logger.warn(`[AgentGenerator] Failed to open agent in Cursor: ${error}`);
    return false;
  }
}

/**
 * Generate agent and start a chat with the question
 *
 * @param agentConfig - Agent configuration object
 * @returns Promise resolving to the chat result
 */
export async function generateAgentAndStartChat(agentConfig: AgentConfig): Promise<{
  filePath: string;
  chatStarted: boolean;
  message: string;
}> {
  // Generate the agent config file first
  const filePath = await generateAgentConfig(agentConfig);

  // Try to start a chat with the question
  const opener = new CursorChatOpener();
  if (!opener.isCursorAvailable()) {
    return {
      filePath,
      chatStarted: false,
      message: 'Agent created but Cursor CLI not available',
    };
  }

  const result = await opener.startAgentWithPrompt(agentConfig.question, {
    workspace: process.cwd(),
    model: agentConfig.model,
  });

  return {
    filePath,
    chatStarted: result.success,
    message: result.message,
  };
}

/**
 * List all generated agent config files
 *
 * @returns Promise resolving to array of agent info
 */
export async function listGeneratedAgents(): Promise<AgentInfo[]> {
  const agentsPath = getAgentsPath();

  try {
    // Check if directory exists
    if (!fs.existsSync(agentsPath)) {
      return [];
    }

    const files = await fs.promises.readdir(agentsPath);
    const agentFiles = files.filter(file => file.endsWith('.md'));

    const agents: AgentInfo[] = [];
    for (const file of agentFiles) {
      const filePath = path.join(agentsPath, file);
      const stats = await fs.promises.stat(filePath);
      const name = path.basename(file, '.md');
      agents.push({
        name,
        filePath,
        createdAt: stats.birthtime.toISOString(),
      });
    }

    return agents;
  } catch (error) {
    logger.warn(`[AgentGenerator] Failed to list agents: ${error}`);
    return [];
  }
}

/**
 * Delete an agent config file
 *
 * @param agentName - Name of the agent to delete
 * @returns Promise resolving when deletion is complete
 */
export async function deleteAgentConfig(agentName: string): Promise<void> {
  const agentsPath = getAgentsPath();
  const filePath = path.join(agentsPath, `${agentName}.md`);

  try {
    await fs.promises.unlink(filePath);
    logger.info(`[AgentGenerator] Deleted agent config: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.warn(`[AgentGenerator] Agent config not found: ${filePath}`);
    } else {
      throw error;
    }
  }
}

/**
 * Get the agents directory path from config or use default
 */
function getAgentsPath(): string {
  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    if (fs.existsSync(configPath)) {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      if (config?.cursor?.agents?.agentsPath) {
        return path.join(process.cwd(), config.cursor.agents.agentsPath);
      }
    }
  } catch (error) {
    // Config loading failed, use default
  }

  // Default path
  return path.join(process.cwd(), '.cursor', 'agents');
}




