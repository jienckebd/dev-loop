/**
 * Chat Request Auto-Processor
 *
 * Background service that automatically processes chat requests
 * by creating instruction files and opening chats in Cursor IDE.
 *
 * Enhanced with:
 * - IDE-focused flow with composer-ready prompt files
 * - Direct CLI-based chat opening via CursorChatOpener
 * - Optional keyboard automation for macOS
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ChatRequest, ChatInstruction, Config } from '../../types';
import { listPendingChatRequests, markRequestProcessed, markRequestFailed } from './cursor-chat-requests';
import { logger } from "../../core/utils/logger";
import { CursorChatOpener, ChatOpenResult, OpenStrategy, PromptFileFormat } from './cursor-chat-opener';

export interface ProcessResult {
  requestId: string;
  status: 'success' | 'failed';
  instructionPath?: string;
  promptFilePath?: string;
  chatOpenResult?: ChatOpenResult;
  error?: string;
  instructions?: string;
}

export class ChatRequestAutoProcessor {
  private config: Config;
  private watchInterval: NodeJS.Timeout | null = null;
  private isWatching = false;
  private processInterval: number;
  private autoOpen: boolean;
  private autoOpenChats: boolean;
  private openStrategy: OpenStrategy;
  private openAsAgent: boolean;
  private openAsTab: boolean;
  private fallbackToManual: boolean;
  private preferIdeChat: boolean;
  private keyboardAutomation: boolean;
  private promptFileFormat: PromptFileFormat;
  private chatOpener: CursorChatOpener;

  constructor(config: Config) {
    this.config = config;
    const agentsConfig = (config as any).cursor?.agents;
    this.processInterval = agentsConfig?.processInterval || 2000;
    this.autoOpen = agentsConfig?.autoOpen !== false; // Default to true

    // Chat opening configuration
    this.autoOpenChats = agentsConfig?.autoOpenChats !== false; // Default to true
    this.openStrategy = agentsConfig?.openStrategy || 'auto';
    this.openAsAgent = agentsConfig?.openAsAgent !== false; // Default to true
    this.openAsTab = agentsConfig?.openAsTab || false;
    this.fallbackToManual = agentsConfig?.fallbackToManual !== false; // Default to true

    // Background agent configuration
    this.preferIdeChat = agentsConfig?.preferIdeChat || false; // Default to false (use background agents)
    this.keyboardAutomation = agentsConfig?.keyboardAutomation || false;
    this.promptFileFormat = agentsConfig?.promptFileFormat || 'markdown';
    const useBackgroundAgent = agentsConfig?.useBackgroundAgent !== false; // Default to true
    const agentOutputFormat = agentsConfig?.agentOutputFormat || 'json';

    // Initialize chat opener with configuration
    this.chatOpener = new CursorChatOpener({
      autoOpenChats: this.autoOpenChats,
      openAsAgent: this.openAsAgent,
      openAsTab: this.openAsTab,
      openStrategy: this.openStrategy,
      fallbackToManual: this.fallbackToManual,
      preferIdeChat: this.preferIdeChat,
      keyboardAutomation: this.keyboardAutomation,
      promptFileFormat: this.promptFileFormat,
      useBackgroundAgent: useBackgroundAgent,
      agentOutputFormat: agentOutputFormat,
    });
  }

  /**
   * Start watching for new chat requests and auto-process them
   */
  async startWatching(): Promise<void> {
    if (this.isWatching) {
      logger.warn('[ChatAutoProcessor] Already watching for chat requests');
      return;
    }

    this.isWatching = true;
    logger.info('[ChatAutoProcessor] Started watching for chat requests');

    // Process immediately on start
    await this.processAllPending();

    // Set up polling interval
    this.watchInterval = setInterval(async () => {
      if (this.isWatching) {
        await this.processAllPending();
      }
    }, this.processInterval);
  }

  /**
   * Stop watching for new chat requests
   */
  async stopWatching(): Promise<void> {
    if (!this.isWatching) {
      return;
    }

    this.isWatching = false;

    if (this.watchInterval) {
      clearInterval(this.watchInterval);
      this.watchInterval = null;
    }

    logger.info('[ChatAutoProcessor] Stopped watching for chat requests');
  }

  /**
   * Process all pending chat requests immediately
   * Supports parallel processing using Promise.all()
   *
   * @returns Promise resolving to array of processing results
   */
  async processAllPending(): Promise<ProcessResult[]> {
    const pendingRequests = await listPendingChatRequests();

    if (pendingRequests.length === 0) {
      return [];
    }

    logger.info(`[ChatAutoProcessor] Processing ${pendingRequests.length} pending chat request(s)`);

    // Process all requests concurrently using Promise.all()
    const results = await Promise.all(
      pendingRequests.map(request => this.processRequest(request))
    );

    const successCount = results.filter(r => r.status === 'success').length;
    const failedCount = results.filter(r => r.status === 'failed').length;

    logger.info(`[ChatAutoProcessor] Processed ${pendingRequests.length} requests: ${successCount} succeeded, ${failedCount} failed`);

    return results;
  }

  /**
   * Process a single chat request
   *
   * @param request - Chat request to process
   * @returns Promise resolving to processing result
   */
  async processRequest(request: ChatRequest): Promise<ProcessResult> {
    try {
      const agentsConfig = (this.config as any).cursor?.agents;
      const fullAutomation = agentsConfig?.fullAutomation || false;

      // Create JSON instruction file (legacy compatibility)
      const instructionPath = await this.createInstructionFile(request);

      // Try to open chat/prompt via configured method
      let chatOpenResult: ChatOpenResult | undefined;
      let promptFilePath: string | undefined;
      let instructions: string | undefined;

      if (this.autoOpenChats) {
        // Use background agent mode (--print) for headless operation
        logger.info(`[ChatAutoProcessor] Opening chat with background agent mode for request ${request.id}`);
        chatOpenResult = await this.openChatWithRetry(request, 2);

        if (chatOpenResult?.success) {
          promptFilePath = chatOpenResult.promptFilePath;
          instructions = chatOpenResult.instructions;

          logger.info(`[ChatAutoProcessor] Opened chat via ${chatOpenResult.method}: ${chatOpenResult.message}`);

          // Log user instructions if available
          if (instructions) {
            logger.info(`[ChatAutoProcessor] User instructions:\n${instructions}`);
          }
        } else if (chatOpenResult) {
          logger.warn(`[ChatAutoProcessor] Chat opening failed: ${chatOpenResult.message}`);
        }
      }

      await markRequestProcessed(request.id);

      return {
        requestId: request.id,
        status: 'success',
        instructionPath,
        promptFilePath,
        chatOpenResult,
        instructions,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[ChatAutoProcessor] Failed to process request ${request.id}: ${errorMessage}`);

      await markRequestFailed(request.id);

      return {
        requestId: request.id,
        status: 'failed',
        error: errorMessage,
      };
    }
  }

  /**
   * Open chat with retry logic
   *
   * @param request - Chat request to open
   * @param maxRetries - Maximum number of retries
   * @returns Promise resolving to chat open result
   */
  private async openChatWithRetry(request: ChatRequest, maxRetries: number): Promise<ChatOpenResult> {
    let lastResult: ChatOpenResult | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.chatOpener.openChat(request);
        if (result.success) {
          return result;
        }
        lastResult = result;

        // Wait before retry
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          logger.debug(`[ChatAutoProcessor] Retrying chat open (attempt ${attempt + 2}/${maxRetries + 1})`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        lastResult = {
          success: false,
          method: 'manual',
          message: errorMessage,
        };
      }
    }

    return lastResult || {
      success: false,
      method: 'manual',
      message: 'Failed to open chat after retries',
    };
  }

  /**
   * Process multiple chat requests concurrently
   *
   * @param requests - Array of chat requests to process
   * @returns Promise resolving to array of processing results
   */
  async processRequestsConcurrently(requests: ChatRequest[]): Promise<ProcessResult[]> {
    logger.info(`[ChatAutoProcessor] Processing ${requests.length} requests concurrently`);

    // Use Promise.all() for true parallel execution
    const results = await Promise.all(
      requests.map(request => this.processRequest(request))
    );

    return results;
  }

  /**
   * Create an instruction file for a chat request
   *
   * @param request - Chat request to create instruction for
   * @returns Promise resolving to the instruction file path
   */
  private async createInstructionFile(request: ChatRequest): Promise<string> {
    const instructionsPath = this.getInstructionsPath();
    const fileName = `${request.id}.json`;
    const filePath = path.join(instructionsPath, fileName);

    // Ensure directory exists
    await fs.promises.mkdir(instructionsPath, { recursive: true });

    // Build CLI command for manual execution
    const cliCommand = `cursor agent "${request.question || 'Start working on the task'}"`;

    // Create instruction object with CLI command
    const instruction: ChatInstruction = {
      action: 'create_chat',
      agentName: request.agentName,
      question: request.question,
      model: request.model,
      mode: request.mode,
      requestId: request.id,
      createdAt: request.createdAt,
      instructions: `Create a new chat session in Cursor IDE with agent "${request.agentName}" and question: ${request.question}`,
      context: request.context,
      cliCommand, // Include CLI command for manual fallback
    };

    // Write instruction file
    await fs.promises.writeFile(filePath, JSON.stringify(instruction, null, 2), 'utf-8');

    logger.info(`[ChatAutoProcessor] Created instruction file: ${filePath}`);

    // Note: File opening is now handled by openChatWithRetry via the chatOpener
    // The autoOpen config now controls whether we try to open the chat via CLI

    return filePath;
  }

  /**
   * Open file in Cursor IDE (non-blocking)
   */
  private async openFileInCursor(filePath: string): Promise<void> {
    const cursorCmd = this.findCursorExecutable();
    if (!cursorCmd) {
      return; // Silently fail if Cursor CLI not found
    }

    try {
      // Use spawn instead of execAsync to avoid blocking
      const child = spawn(cursorCmd, [filePath], {
        detached: true,
        stdio: 'ignore',
      });

      // Don't wait for the process - let it run in background
      child.unref();

      logger.info(`[ChatAutoProcessor] Opened instruction file in Cursor: ${path.basename(filePath)}`);
    } catch (error) {
      // Silently fail - don't throw
      logger.debug(`[ChatAutoProcessor] Could not open file in Cursor: ${error}`);
    }
  }

  /**
   * Find Cursor executable (synchronous check)
   */
  private findCursorExecutable(): string | null {
    const possiblePaths = [
      'cursor',
      'code', // VS Code CLI (Cursor is based on VS Code)
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor', // macOS
      '/usr/local/bin/cursor',
      process.env.CURSOR_PATH,
    ];

    for (const cmd of possiblePaths) {
      if (!cmd) continue;

      try {
        const { execSync } = require('child_process');
        execSync(`which ${cmd}`, { stdio: 'ignore' });
        return cmd;
      } catch (error) {
        // Try next path
      }
    }

    // Try to find Cursor in common locations
    if (process.platform === 'darwin') {
      const macPath = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';
      if (fs.existsSync(macPath)) {
        return macPath;
      }
    }

    return null;
  }

  /**
   * Get the chat instructions directory path from config or use default
   */
  private getInstructionsPath(): string {
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

    // Default path - use .cursor/chat-instructions/ so Cursor can detect them
    return path.join(process.cwd(), '.cursor', 'chat-instructions');
  }
}



