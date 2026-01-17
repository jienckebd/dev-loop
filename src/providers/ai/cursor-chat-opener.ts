/**
 * Cursor Chat Opener
 *
 * Direct CLI-based integration for opening chats and agent sessions in Cursor IDE.
 * Uses the `cursor` CLI command and `cursor agent` subcommands for direct control.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, execSync, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { logger } from "../../core/utils/logger";
import { ChatRequest, Config, CodeChanges } from '../../types';
import { GenericSessionManager } from './generic-session-manager';
import { SessionContext } from './session-manager';
import { extractCodeChanges, parseCodeChangesFromText, JsonParsingContext } from './json-parser';
import { ObservationTracker } from "../../core/tracking/observation-tracker";
import { getParallelMetricsTracker } from "../../core/metrics/parallel";
import { AgentIPCServer, IPCMessage } from '../../core/utils/agent-ipc';
import { getEventStream } from '../../core/utils/event-stream';

const execAsync = promisify(exec);

// Module-level Set to track all active child processes
const activeChildProcesses = new Set<ChildProcess>();

// Export cleanup function to kill all tracked child processes
export function killAllChildProcesses(signal: NodeJS.Signals = 'SIGTERM'): void {
  for (const child of activeChildProcesses) {
    try {
      if (!child.killed && child.pid) {
        // Use SIGKILL for immediate termination (no cleanup, but ensures exit)
        // SIGTERM allows graceful shutdown but child might not exit in time
        child.kill('SIGKILL');
      }
    } catch (error) {
      // Ignore errors when killing (process may already be dead)
    }
  }
  activeChildProcesses.clear();
}

export type OpenStrategy = 'auto' | 'cli' | 'agent' | 'file' | 'ide' | 'manual';
export type PromptFileFormat = 'markdown' | 'plain';

export interface ChatOpenResult {
  success: boolean;
  chatId?: string;
  promptFilePath?: string;
  method: 'agent' | 'file' | 'ide' | 'manual';
  message: string;
  command?: string;
  instructions?: string;
  /** Response from background agent (when using --print mode) */
  response?: any;
  /** Raw stdout from agent command */
  stdout?: string;
  /** Whether the result is due to a timeout */
  timeout?: boolean;
  /** Estimated token usage (input tokens based on prompt length, output on response) */
  tokens?: {
    input?: number;
    output?: number;
  };
}

export interface CursorChatOpenerConfig {
  autoOpenChats?: boolean;
  openAsAgent?: boolean;
  openAsTab?: boolean;
  openStrategy?: OpenStrategy;
  fallbackToManual?: boolean;
  workspacePath?: string;
  /** Prefer IDE chat integration (prompt files) over terminal agent */
  preferIdeChat?: boolean;
  /** Enable keyboard automation for macOS (AppleScript) */
  keyboardAutomation?: boolean;
  /** Format for prompt files */
  promptFileFormat?: PromptFileFormat;
  /** Use background agent mode (--print) for headless operation */
  useBackgroundAgent?: boolean;
  /** Output format for background agent (json, text, stream-json) */
  agentOutputFormat?: 'json' | 'text' | 'stream-json';
  /** Session management configuration */
  sessionManagement?: {
    enabled?: boolean;
    maxSessionAge?: number;
    maxHistoryItems?: number;
    sessionsPath?: string;
  };
}

/**
 * CursorChatOpener - Direct CLI integration for opening Cursor chats
 *
 * Supports multiple strategies:
 * - 'ide': Open prompt file in editor for easy copy-paste to composer (Cmd+L)
 * - 'agent': Start terminal-based cursor agent
 * - 'file': Open instruction file in editor
 * - 'manual': Provide CLI commands for user to run
 * - 'auto': Try IDE first, then agent, then file, then manual
 */
export class CursorChatOpener {
  private config: CursorChatOpenerConfig;
  private cursorPath: string | null = null;
  private sessionManager: GenericSessionManager | null = null;
  private observationTracker: ObservationTracker;
  private ipcServer: AgentIPCServer | null = null;
  /** Chat ID for session resumption - reuses existing Cursor agent session */
  private currentChatId: string | null = null;

  constructor(config?: CursorChatOpenerConfig) {
    this.observationTracker = new ObservationTracker();
    // Merge config with defaults, handling sessionManagement specially
    const defaultSessionManagement = {
      enabled: true,
      maxSessionAge: 3600000, // 1 hour
      maxHistoryItems: 50,
    };

    this.config = {
      autoOpenChats: true,
      openAsAgent: true,
      openAsTab: false,
      openStrategy: 'auto',
      fallbackToManual: true,
      preferIdeChat: true,
      keyboardAutomation: false,
      promptFileFormat: 'markdown',
      sessionManagement: {
        ...defaultSessionManagement,
        ...config?.sessionManagement,
      },
      ...config,
    };

    // Ensure sessionManagement is properly merged
    if (config?.sessionManagement) {
      this.config.sessionManagement = {
        ...defaultSessionManagement,
        ...config.sessionManagement,
      };
    }

    this.cursorPath = this.findCursorExecutable();

    // Initialize session manager if enabled (defaults to true)
    const sessionEnabled = this.config.sessionManagement?.enabled !== false;
    if (sessionEnabled) {
      this.sessionManager = new GenericSessionManager({
        providerName: 'cursor',
        enabled: this.config.sessionManagement?.enabled !== false,
        maxSessionAge: this.config.sessionManagement?.maxSessionAge,
        maxHistoryItems: this.config.sessionManagement?.maxHistoryItems,
        sessionsPath: this.config.sessionManagement?.sessionsPath || '.devloop/execution-state.json',
      });
    }
  }

  /**
   * Open a chat in Cursor using the most appropriate method
   *
   * Strategy order for 'auto':
   * 1. Agent: Start cursor agent (background mode if useBackgroundAgent=true)
   * 2. File: Open instruction file in editor
   * 3. Manual: Provide CLI commands
   */
  async openChat(request: ChatRequest): Promise<ChatOpenResult> {
    const strategy = this.config.openStrategy || 'agent';

    logger.info(`[CursorChatOpener] Opening chat for request ${request.id} with strategy: ${strategy}`);

    // Try agent strategy
    if (strategy === 'auto' || strategy === 'agent') {
      const agentResult = await this.openWithAgent(request);
      if (agentResult.success) {
        return agentResult;
      }
      logger.debug(`[CursorChatOpener] Agent method failed, trying alternatives...`);
    }

    // Try file strategy
    if (strategy === 'auto' || strategy === 'file') {
      const fileResult = await this.openAsFile(request);
      if (fileResult.success) {
        return fileResult;
      }
      logger.debug(`[CursorChatOpener] File method failed, trying alternatives...`);
    }

    // Fallback to manual instructions
    if (this.config.fallbackToManual) {
      return this.getManualInstructions(request);
    }

    return {
      success: false,
      method: 'manual',
      message: 'Failed to open chat automatically. No fallback enabled.',
    };
  }


  /**
   * Check if we should add @codebase tag to the prompt
   */
  private shouldAddCodebaseTag(prompt: string): boolean {
    // Add @codebase for code-related prompts that don't already have it
    if (prompt.startsWith('@')) {
      return false;
    }

    const codeKeywords = [
      'generate', 'create', 'implement', 'build', 'add',
      'fix', 'debug', 'refactor', 'update', 'modify',
      'test', 'write', 'code', 'function', 'class',
      'module', 'component', 'api', 'endpoint', 'service'
    ];

    const lowerPrompt = prompt.toLowerCase();
    return codeKeywords.some(keyword => lowerPrompt.includes(keyword));
  }


  /**
   * Create a new chat using `cursor agent create-chat`
   */
  async createChat(): Promise<{ success: boolean; chatId?: string; error?: string }> {
    if (!this.cursorPath) {
      return { success: false, error: 'Cursor CLI not found' };
    }

    try {
      const { stdout, stderr } = await execAsync(`"${this.cursorPath}" agent create-chat`);
      const chatId = stdout.trim();

      if (chatId && chatId.match(/^[a-f0-9-]{36}$/)) {
        logger.info(`[CursorChatOpener] Created chat with ID: ${chatId}`);
        return { success: true, chatId };
      }

      return { success: false, error: stderr || 'Invalid chat ID returned' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CursorChatOpener] Failed to create chat: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Open a chat using the Cursor agent CLI
   *
   * Supports two modes:
   * 1. Interactive mode: Opens terminal-based agent (default)
   * 2. Background mode (--print): Headless operation with structured output
   */
  private async openWithAgent(request: ChatRequest): Promise<ChatOpenResult> {
    if (!this.cursorPath) {
      return {
        success: false,
        method: 'agent',
        message: 'Cursor CLI not found',
      };
    }

    try {
      const workspacePath = this.config.workspacePath || process.cwd();
      const prompt = this.buildPromptFromRequest(request);
      const useBackground = this.config.useBackgroundAgent ?? false;
      const outputFormat = this.config.agentOutputFormat || 'json';

      // Background agent mode (--print): Headless operation
      if (useBackground) {
        // Extract session ID from request context if available
        const sessionId = (request.context as any)?.sessionId;
        return await this.openWithBackgroundAgent(request, workspacePath, prompt, outputFormat, sessionId);
      }

      // Interactive agent mode: Opens terminal (only used if useBackgroundAgent is false)
      // NOTE: This path is rarely used since useBackgroundAgent defaults to true.
      // Primary execution uses background agents (--print mode) above.
      // First create a new chat
      const createResult = await this.createChat();
      if (!createResult.success || !createResult.chatId) {
        return {
          success: false,
          method: 'agent',
          message: createResult.error || 'Failed to create chat',
        };
      }

      // Use spawn for non-blocking execution
      const args = ['agent', '--workspace', workspacePath];

      // Add prompt if available
      if (prompt) {
        args.push(prompt);
      }

      // Spawn the agent process (non-blocking, opens in terminal)
      const child = spawn(this.cursorPath, args, {
        detached: true,
        stdio: 'ignore',
        cwd: workspacePath,
      });

      // Register child process for cleanup
      activeChildProcesses.add(child);
      child.unref();

      logger.info(`[CursorChatOpener] Started Cursor agent for chat ${createResult.chatId}`);
      
      // Store chatId for potential future use
      if (createResult.chatId) {
        this.currentChatId = createResult.chatId;
      }

      return {
        success: true,
        chatId: createResult.chatId,
        method: 'agent',
        message: `Started Cursor agent with chat ID: ${createResult.chatId}`,
        command: `cursor agent --workspace "${workspacePath}" "${prompt}"`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CursorChatOpener] Agent method failed: ${errorMessage}`);
      return {
        success: false,
        method: 'agent',
        message: errorMessage,
      };
    }
  }

  /**
   * Open a chat using Cursor agent in background mode (--print)
   *
   * This runs headlessly and captures the response for processing.
   * Supports session management for context persistence.
   */
  private async openWithBackgroundAgent(
    request: ChatRequest,
    workspacePath: string,
    prompt: string,
    outputFormat: 'json' | 'text' | 'stream-json',
    sessionId?: string
  ): Promise<ChatOpenResult> {
    try {
      // Extract model from request and normalize "auto" to "Auto" for Cursor CLI
      const model = request.model || 'Auto';
      const normalizedModel = model.toLowerCase() === 'auto' ? 'Auto' : model;

      // Get or create session for context persistence
      let session = null;
      let enhancedPrompt = prompt;

      if (this.sessionManager && request.context) {
        const sessionContext: SessionContext = {
          prdId: request.context.prdId || undefined,
          phaseId: request.context.phaseId !== undefined && request.context.phaseId !== null ? request.context.phaseId : undefined,
          prdSetId: request.context.prdSetId || undefined,
          taskIds: request.context.taskId ? [request.context.taskId] : [],
          // ENHANCEMENT: Include targetModule for session isolation
          targetModule: (request.context as any).targetModule || undefined,
        };

        if (sessionId) {
          session = this.sessionManager.resumeSession(sessionId);
        } else {
          session = this.sessionManager.getOrCreateSession(sessionContext);
        }

        if (session && this.sessionManager) {
          // Build prompt with conversation history
          enhancedPrompt = this.sessionManager.buildPromptWithHistory(session, prompt);
          logger.debug(`[CursorChatOpener] Using session ${session.sessionId} with ${session.history.length} history entries`);
        }
      }

      // Build command with --print mode (don't include prompt in args - pass via stdin)
      const args = [
        'agent',
        '--print',
        '--output-format',
        outputFormat,
        '--workspace',
        workspacePath,
        '--model',
        normalizedModel,
      ];

      // Add --resume flag if we have a chatId from a previous call (session reuse for performance)
      // First try to get from session if not already set
      if (!this.currentChatId && session && this.sessionManager) {
        this.currentChatId = this.sessionManager.getResumeId(session.sessionId) || null;
      }
      if (this.currentChatId) {
        args.push('--resume', this.currentChatId);
        logger.info(`[CursorChatOpener] Resuming session with chatId: ${this.currentChatId}`);
      }

      logger.info(`[CursorChatOpener] Starting background agent with --print mode${session ? ` (session: ${session.sessionId})` : ''}${this.currentChatId ? ` (resuming: ${this.currentChatId})` : ''}`);
      logger.debug(`[CursorChatOpener] Command: cursor agent --print --output-format ${outputFormat} --workspace ${workspacePath} --model ${normalizedModel}`);
      if (enhancedPrompt) {
        logger.debug(`[CursorChatOpener] Prompt length: ${enhancedPrompt.length} chars (will be passed via stdin)${session ? `, ${session.history.length} history entries` : ''}`);
      }

      // Track agent in parallel metrics
      const parallelMetrics = getParallelMetricsTracker();
      const agentId = `agent-${request.id || Date.now()}`;
      const taskId = request.context?.taskId || request.id || 'unknown';
      const prdId = request.context?.prdId || 'unknown';
      const phaseId = request.context?.phaseId ?? undefined;
      parallelMetrics.startAgent(agentId, taskId, prdId, phaseId, enhancedPrompt?.length || 0);

      // Start IPC server for structured communication with background agent
      const ipcSessionId = session?.sessionId || `ipc-${Date.now()}`;
      const ipcServer = new AgentIPCServer(ipcSessionId, (this.config as any).debug);
      await ipcServer.start();
      const socketPath = ipcServer.getSocketPath();
      logger.debug(`[CursorChatOpener] IPC server started at ${socketPath}`);

      // Use spawn with stdin for long prompts (more reliable than command-line args)
      // Add timeout to prevent hanging (default 5 minutes for background agents)
      // Code generation should complete in < 5 minutes; test generation may take longer
      // Can be overridden via config.cursor.agents.backgroundAgentTimeout
      const configTimeout = (this.config as any).backgroundAgentTimeout;
      const timeoutMs = configTimeout ? configTimeout * 60 * 1000 : 5 * 60 * 1000; // Default: 5 minutes
      const timeoutPromise = new Promise<ChatOpenResult>((resolve) => {
        setTimeout(async () => {
          // Track agent timeout in parallel metrics
          parallelMetrics.completeAgent(agentId, 'timeout', 0);

          // Clean up IPC server on timeout
          await ipcServer.stop();

          resolve({
            success: false,
            method: 'agent',
            message: `Background agent timed out after ${timeoutMs / 1000 / 60} minutes`,
          });
        }, timeoutMs);
      });

      return Promise.race([
        timeoutPromise,
        new Promise<ChatOpenResult>(async (resolve) => {
          // Pass IPC socket path to child via environment variables
          const childEnv = {
            ...process.env,
            DEVLOOP_IPC_SOCKET: socketPath,
            DEVLOOP_SESSION_ID: ipcSessionId,
            DEVLOOP_REQUEST_ID: request.id,
            DEVLOOP_DEBUG: (this.config as any).debug ? 'true' : 'false',
          };

          const child = spawn(this.cursorPath!, args, {
            cwd: workspacePath,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: childEnv,
          });

          // Register child process for cleanup
          activeChildProcesses.add(child);

          let stdout = '';
          let stderr = '';
          let streamedTokens = 0;

          child.stdout?.on('data', (data) => {
            const chunk = data.toString();
            stdout += chunk;

            // Emit streaming progress event for real-time monitoring
            // This provides better UX by showing progress during long AI calls
            if (outputFormat === 'stream-json') {
              // Try to parse streaming JSON chunks
              try {
                for (const line of chunk.split('\n')) {
                  if (line.trim()) {
                    const parsed = JSON.parse(line);
                    if (parsed.type === 'partial' || parsed.type === 'chunk') {
                      streamedTokens += (parsed.tokens || 10);
                      getEventStream().emit('build:ai_progress', {
                        taskId: request.context?.taskId || request.id,
                        tokens: streamedTokens,
                        partial: true,
                      }, { severity: 'info' });
                    }
                  }
                }
              } catch {
                // Not valid JSON - just accumulate text
                streamedTokens += Math.floor(chunk.length / 4); // Rough token estimate
              }
            } else {
              // For non-streaming, emit periodic progress based on output size
              const currentTokens = Math.floor(stdout.length / 4);
              if (currentTokens > streamedTokens + 100) { // Emit every ~100 tokens
                streamedTokens = currentTokens;
                getEventStream().emit('build:ai_progress', {
                  taskId: request.context?.taskId || request.id,
                  tokens: streamedTokens,
                  partial: true,
                }, { severity: 'info' });
              }
            }
          });

          child.stderr?.on('data', (data) => {
            stderr += data.toString();
          });

          // Write enhanced prompt (with history) to stdin if provided
          if (enhancedPrompt) {
            child.stdin?.write(enhancedPrompt);
            child.stdin?.end();
          }

          // Track if process was killed due to timeout
          let killedByTimeout = false;

          // Handle timeout - kill the child process
          const timeoutHandle = setTimeout(() => {
            killedByTimeout = true;  // Mark as timeout kill
            logger.warn(`[CursorChatOpener] Background agent timeout after ${timeoutMs / 1000 / 60} minutes, killing process`);
            try {
              child.kill('SIGTERM');
              // Force kill after a short grace period
              setTimeout(() => {
                if (!child.killed) {
                  child.kill('SIGKILL');
                }
              }, 5000);
            } catch (error) {
              logger.error(`[CursorChatOpener] Failed to kill background agent process: ${error}`);
            }
          }, timeoutMs);

          child.on('close', async (code) => {
            // Unregister child process
            activeChildProcesses.delete(child);
            clearTimeout(timeoutHandle);
          if (code !== 0 && stderr) {
            logger.warn(`[CursorChatOpener] Background agent exited with code ${code}: ${stderr.substring(0, 200)}`);
            // Reset chatId if session resume failed (will create new session on next call)
            if (this.currentChatId && stderr.includes('session') || stderr.includes('resume')) {
              logger.warn(`[CursorChatOpener] Session resume may have failed, resetting chatId`);
              this.currentChatId = null;
            }
          }

          // Parse response based on output format
          // CLI with --output-format json always returns: {type:"result", result:"<text>", ...}
          // Per Cursor CLI docs: https://cursor.com/docs/cli/reference/output-format
          let parsedResponse: string = '';
          if (outputFormat === 'json') {
            try {
              const trimmed = stdout.trim();

              // Strategy 1: Try to find and parse all complete JSON objects
              // This handles cases where multiple JSON objects are returned
              const jsonObjects = this.extractAllJsonObjects(trimmed);

              if (jsonObjects.length > 0) {
                // Use the last complete JSON object (most recent response)
                const lastJson = jsonObjects[jsonObjects.length - 1];
                try {
                  const parsed = JSON.parse(lastJson);

                  // Handle Cursor agent --print response format
                  // Per Cursor CLI docs: Format is {type:"result", result:"<text>", ...}
                  // The result field contains the complete assistant response text
                  if (parsed.type === 'result' && parsed.result) {
                    // Extract result field - this is the assistant's response text
                    // Parser will handle extracting JSON from markdown code blocks
                    parsedResponse = typeof parsed.result === 'string' 
                      ? parsed.result 
                      : JSON.stringify(parsed.result);
                    logger.debug(`[CursorChatOpener] Extracted result field from CLI response`);
                    
                    // Extract chatId for session resumption (performance optimization)
                    if (parsed.chatId && typeof parsed.chatId === 'string') {
                      this.currentChatId = parsed.chatId;
                      // Store chatId in session as providerSessionId
                      if (session && this.sessionManager) {
                        this.sessionManager.setProviderSessionId(session.sessionId, parsed.chatId);
                      }
                      logger.debug(`[CursorChatOpener] Captured chatId for session reuse: ${parsed.chatId}`);
                    }
                  } else {
                    // Fallback: use entire parsed object as string
                    parsedResponse = JSON.stringify(parsed);
                    logger.debug(`[CursorChatOpener] No result field found, using entire response`);
                  }

                  logger.debug(`[CursorChatOpener] Successfully parsed JSON object (${jsonObjects.length} found, using last)`);
                } catch (parseError) {
                  logger.warn(`[CursorChatOpener] Failed to parse extracted JSON: ${parseError}`);
                  // Fall through to text extraction
                }
              }

              // If no JSON found in stdout, use stdout as text (parser will handle extraction)
              if (!parsedResponse) {
                parsedResponse = trimmed;
                logger.debug(`[CursorChatOpener] No JSON objects found, using stdout as text`);
              }
            } catch (parseError) {
              logger.warn(`[CursorChatOpener] Failed to process JSON response: ${parseError}`);
              // Fall back to text response - parser will handle extraction
              parsedResponse = stdout.trim();
            }
          } else {
            // Text or stream-json format
            parsedResponse = stdout.trim();
          }

          // Track session history
          // Only attempt CodeChanges extraction for JSON format, not text generation
          let codeChanges: CodeChanges | null = null;
          if (outputFormat !== 'text') {
            const parsingContext: JsonParsingContext = {
              providerName: 'cursor',
              taskId: request.context?.taskId || request.id,
              prdId: request.context?.prdId,
              phaseId: request.context?.phaseId ?? undefined,
            };
            codeChanges = this.extractCodeChangesFromResponse(parsedResponse, this.observationTracker, parsingContext);
          }
          const success = code === 0 || stdout.trim().length > 0;
          const error = success ? undefined : (stderr || `Background agent exited with code ${code}`);

          if (session && this.sessionManager) {
            // For text format, success is based on response length, not CodeChanges extraction
            const historySuccess = outputFormat === 'text' 
              ? success 
              : success && codeChanges !== null;
            this.sessionManager.addToHistory(
              session.sessionId,
              request.id,
              prompt,
              parsedResponse,
              historySuccess,
              error
            );
          }

          // Clean up IPC server
          await ipcServer.stop();

          // Handle timeout kills (code 143 = 128 + SIGTERM)
          if (code === 143 && killedByTimeout) {
            logger.warn(`[CursorChatOpener] Background agent timed out and was terminated (code 143)`);
            // Track agent timeout in parallel metrics
            parallelMetrics.completeAgent(agentId, 'timeout', stdout.length);

            resolve({
              success: false,
              method: 'agent',
              message: `Background agent timed out after ${timeoutMs / 1000 / 60} minutes`,
              timeout: true,
            });
            return;
          }

          if (success) {
            logger.info(`[CursorChatOpener] Background agent completed successfully${session ? ` (session: ${session.sessionId})` : ''}`);

            // Track agent completion in parallel metrics
            parallelMetrics.completeAgent(agentId, 'completed', stdout.length);

            // Calculate token estimates based on character counts
            // Rough estimate: ~4 characters per token for English text
            const inputTokenEstimate = Math.ceil(prompt.length / 4);
            const outputTokenEstimate = Math.ceil(parsedResponse.length / 4);

            resolve({
              success: true,
              method: 'agent',
              message: 'Background agent completed successfully',
              command: `cursor agent --print --output-format ${outputFormat} --workspace ${workspacePath}`,
              response: parsedResponse,
              stdout: stdout.trim(),
              tokens: {
                input: inputTokenEstimate,
                output: outputTokenEstimate,
              },
            });
          } else {
            logger.error(`[CursorChatOpener] Background agent failed with code ${code}${session ? ` (session: ${session.sessionId})` : ''}`);

            // Track agent failure in parallel metrics
            parallelMetrics.completeAgent(agentId, 'failed', stdout.length);

            resolve({
              success: false,
              method: 'agent',
              message: error || `Background agent exited with code ${code}`,
            });
          }
        });

          child.on('error', async (spawnError) => {
            clearTimeout(timeoutHandle);
            logger.error(`[CursorChatOpener] Background agent spawn error: ${spawnError.message}`);

            // Clean up IPC server
            await ipcServer.stop();

            // Track agent failure in parallel metrics
            parallelMetrics.completeAgent(agentId, 'failed', 0);

            resolve({
              success: false,
              method: 'agent',
              message: spawnError.message,
            });
          });
        }),
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CursorChatOpener] Background agent failed: ${errorMessage}`);

      // Track agent failure in parallel metrics (create fallback agentId)
      const parallelMetrics = getParallelMetricsTracker();
      const fallbackAgentId = `agent-${request.id || Date.now()}`;
      parallelMetrics.completeAgent(fallbackAgentId, 'failed', 0);

      return {
        success: false,
        method: 'agent',
        message: errorMessage,
      };
    }
  }

  /**
   * Extract all complete JSON objects from text
   * Handles multiple JSON objects, nested structures, and escaped strings
   * Properly handles control characters in JSON strings (newlines, tabs, etc.)
   */
  private extractAllJsonObjects(text: string): string[] {
    const jsonObjects: string[] = [];
    let i = 0;

    while (i < text.length) {
      // Find the start of a JSON object
      const startBrace = text.indexOf('{', i);
      if (startBrace === -1) break;

      // Try to find the matching closing brace
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let endBrace = -1;

      for (let j = startBrace; j < text.length; j++) {
        const char = text[j];

        if (escapeNext) {
          escapeNext = false;
          // After escape, the next character is part of the string, not a control character
          // This handles \n, \t, \", etc. in JSON strings
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        // Control characters (newlines, tabs, etc.) are valid inside JSON strings
        // We only track braces when not inside a string
        if (!inString) {
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            if (braceCount === 0) {
              endBrace = j;
              break;
            }
          }
        }
      }

      if (endBrace > startBrace) {
        // Found a complete JSON object
        const jsonStr = text.substring(startBrace, endBrace + 1);
        // Validate it's actually JSON by trying to parse it
        // Don't modify the string - JSON should already be valid
        try {
          const parsed = JSON.parse(jsonStr);
          // Additional validation: ensure it's a meaningful object
          if (typeof parsed === 'object' && parsed !== null) {
            jsonObjects.push(jsonStr);
          }
        } catch (parseError) {
          // Not valid JSON, skip it
          // Log debug info for troubleshooting
          const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
          if (errorMsg.includes('control character')) {
            logger.debug(`[CursorChatOpener] Skipping JSON object with control character issue: ${errorMsg.substring(0, 100)}`);
          }
        }
        i = endBrace + 1;
      } else {
        // Incomplete JSON, move past this brace
        i = startBrace + 1;
      }
    }

    return jsonObjects;
  }

  /**
   * Extract JSON from markdown code blocks
   * Looks for ```json ... ``` or ``` ... ``` blocks containing JSON
   * Handles control characters properly without breaking JSON structure
   */
  private extractJsonFromCodeBlocks(text: string): string | null {
    // Match ```json ... ``` or ``` ... ``` with JSON content
    // Use non-greedy match to get the first complete JSON object
    const codeBlockRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/g;
    const matches = Array.from(text.matchAll(codeBlockRegex));

    for (const match of matches) {
      if (match[1]) {
        const jsonStr = match[1];
        // Try parsing raw JSON first (should already be valid)
        try {
          const parsed = JSON.parse(jsonStr);
          // Validate it's a meaningful object
          if (typeof parsed === 'object' && parsed !== null) {
            return jsonStr;
          }
        } catch (parseError) {
          // If parsing fails, check if it's double-escaped
          try {
            if (jsonStr.includes('\\\\n') || jsonStr.includes('\\\\"')) {
              // Only unescape double-escaped sequences
              const unescaped = jsonStr.replace(/\\\\n/g, '\\n').replace(/\\\\"/g, '\\"').replace(/\\\\\\\\/g, '\\\\');
              const parsed = JSON.parse(unescaped);
              if (typeof parsed === 'object' && parsed !== null) {
                return unescaped;
              }
            }
          } catch {
            // Not valid JSON, try next match
            continue;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract code changes from agent response
   *
   * The agent response may contain code changes in various formats:
   * - Direct CodeChanges object
   * - Text with code blocks
   * - JSON embedded in text
   * - Cursor agent result format: {type: "result", result: "..."}
   */
  private extractCodeChangesFromResponse(
    response: any,
    observationTracker?: ObservationTracker,
    context?: JsonParsingContext
  ): CodeChanges | null {
    return extractCodeChanges(response, observationTracker, context);
  }

  /**
   * Parse code changes from text response with robust error handling
   * Uses shared parser utility for consistent parsing logic
   */
  private parseCodeChangesFromTextResponse(text: string): CodeChanges | null {
    return parseCodeChangesFromText(text);
  }

  /**
   * Open a file in Cursor IDE as an editor tab
   */
  private async openAsFile(request: ChatRequest): Promise<ChatOpenResult> {
    if (!this.cursorPath) {
      return {
        success: false,
        method: 'file',
        message: 'Cursor CLI not found',
      };
    }

    try {
      // Create a temporary instruction file
      const filePath = await this.createInstructionFile(request);

      // Open the file in Cursor using the CLI
      const args = this.config.openAsTab ? ['-r', filePath] : [filePath];

      const child = spawn(this.cursorPath, args, {
        detached: true,
        stdio: 'ignore',
      });

      // Register child process for cleanup
      activeChildProcesses.add(child);
      child.unref();

      logger.info(`[CursorChatOpener] Opened instruction file in Cursor: ${path.basename(filePath)}`);

      return {
        success: true,
        method: 'file',
        message: `Opened instruction file: ${filePath}`,
        command: `cursor ${this.config.openAsTab ? '-r ' : ''}"${filePath}"`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CursorChatOpener] File method failed: ${errorMessage}`);
      return {
        success: false,
        method: 'file',
        message: errorMessage,
      };
    }
  }

  /**
   * Get manual instructions for opening the chat
   */
  private getManualInstructions(request: ChatRequest): ChatOpenResult {
    const workspacePath = this.config.workspacePath || process.cwd();
    const prompt = this.buildPromptFromRequest(request);

    const commands = [
      `# Create a new chat:`,
      `cursor agent create-chat`,
      ``,
      `# Or start agent with prompt:`,
      `cursor agent --workspace "${workspacePath}" "${prompt}"`,
    ];

    return {
      success: true,
      method: 'manual',
      message: `Manual commands to open chat:\n${commands.join('\n')}`,
      command: commands.join('\n'),
    };
  }

  /**
   * Build a prompt string from a chat request
   *
   * IMPORTANT: Adds @codebase tag for code-related prompts to leverage
   * Cursor's pre-indexed codebase context. This dramatically improves
   * response quality and reduces the need to include codebase context
   * in prompts manually.
   */
  private buildPromptFromRequest(request: ChatRequest): string {
    const parts: string[] = [];

    if (request.agentName) {
      parts.push(`[Agent: ${request.agentName}]`);
    }

    if (request.question) {
      // Add @codebase tag if this is a code-related prompt
      // This leverages Cursor's indexed codebase for better context
      const prompt = request.question;
      if (this.shouldAddCodebaseTag(prompt)) {
        parts.push(`@codebase ${prompt}`);
      } else {
        parts.push(prompt);
      }
    }

    if (request.context) {
      if (request.context.prdId) {
        parts.push(`PRD: ${request.context.prdId}`);
      }
      if (request.context.taskId) {
        parts.push(`Task: ${request.context.taskId}`);
      }
    }

    return parts.join(' | ');
  }

  /**
   * Create an instruction file for manual chat opening
   */
  private async createInstructionFile(request: ChatRequest): Promise<string> {
    const instructionsDir = path.join(process.cwd(), '.cursor', 'chat-instructions');
    await fs.promises.mkdir(instructionsDir, { recursive: true });

    const fileName = `${request.id}.md`;
    const filePath = path.join(instructionsDir, fileName);

    const content = this.generateInstructionContent(request);
    await fs.promises.writeFile(filePath, content, 'utf-8');

    return filePath;
  }

  /**
   * Generate markdown content for instruction file
   */
  private generateInstructionContent(request: ChatRequest): string {
    const lines: string[] = [
      `# Chat Request: ${request.id}`,
      ``,
      `## Agent: ${request.agentName || 'DevLoopCodeGen'}`,
      ``,
      `## Question`,
      ``,
      request.question || 'No question provided',
      ``,
      `## Model: ${request.model || 'Auto'}`,
      `## Mode: ${request.mode || 'Ask'}`,
      ``,
    ];

    if (request.context) {
      lines.push(`## Context`);
      lines.push(``);
      if (request.context.prdId) {
        lines.push(`- PRD: ${request.context.prdId}`);
      }
      if (request.context.phaseId) {
        lines.push(`- Phase: ${request.context.phaseId}`);
      }
      if (request.context.taskId) {
        lines.push(`- Task: ${request.context.taskId}`);
      }
      lines.push(``);
    }

    lines.push(`---`);
    lines.push(``);
    lines.push(`## Instructions`);
    lines.push(``);
    lines.push(`Open a new Cursor chat and paste the question above, or run:`);
    lines.push(``);
    lines.push('```bash');
    lines.push(`cursor agent "${request.question || 'Start working on the task'}"`);
    lines.push('```');
    lines.push(``);
    lines.push(`Created: ${request.createdAt || new Date().toISOString()}`);

    return lines.join('\n');
  }

  /**
   * Open a file directly in Cursor
   */
  async openFile(filePath: string, options?: { reuseWindow?: boolean; goto?: string }): Promise<boolean> {
    if (!this.cursorPath) {
      logger.warn('[CursorChatOpener] Cursor CLI not found');
      return false;
    }

    try {
      const args: string[] = [];

      if (options?.reuseWindow) {
        args.push('-r');
      }

      if (options?.goto) {
        args.push('-g', `${filePath}:${options.goto}`);
      } else {
        args.push(filePath);
      }

      const child = spawn(this.cursorPath, args, {
        detached: true,
        stdio: 'ignore',
      });

      // Register child process for cleanup
      activeChildProcesses.add(child);
      child.unref();

      logger.info(`[CursorChatOpener] Opened file: ${filePath}`);
      return true;
    } catch (error) {
      logger.error(`[CursorChatOpener] Failed to open file: ${error}`);
      return false;
    }
  }

  /**
   * Start an agent with a specific prompt
   */
  async startAgentWithPrompt(prompt: string, options?: {
    workspace?: string;
    model?: string;
    browser?: boolean;
  }): Promise<{ success: boolean; message: string }> {
    if (!this.cursorPath) {
      return { success: false, message: 'Cursor CLI not found' };
    }

    try {
      const args = ['agent'];

      if (options?.workspace) {
        args.push('--workspace', options.workspace);
      } else {
        args.push('--workspace', process.cwd());
      }

      if (options?.model) {
        args.push('--model', options.model);
      }

      if (options?.browser) {
        args.push('--browser');
      }

      args.push(prompt);

      const child = spawn(this.cursorPath, args, {
        detached: true,
        stdio: 'ignore',
      });

      // Register child process for cleanup
      activeChildProcesses.add(child);
      child.unref();

      logger.info(`[CursorChatOpener] Started agent with prompt: ${prompt.substring(0, 50)}...`);
      return { success: true, message: 'Agent started successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Resume the latest chat session
   */
  async resumeLatestChat(): Promise<{ success: boolean; message: string }> {
    if (!this.cursorPath) {
      return { success: false, message: 'Cursor CLI not found' };
    }

    try {
      const child = spawn(this.cursorPath, ['agent', 'resume'], {
        detached: true,
        stdio: 'ignore',
      });

      // Register child process for cleanup
      activeChildProcesses.add(child);
      child.unref();

      logger.info('[CursorChatOpener] Resumed latest chat session');
      return { success: true, message: 'Resumed latest chat' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Find the Cursor CLI executable
   */
  private findCursorExecutable(): string | null {
    // Check environment variable first
    if (process.env.CURSOR_PATH && fs.existsSync(process.env.CURSOR_PATH)) {
      return process.env.CURSOR_PATH;
    }

    // Try common paths based on platform
    const possiblePaths: string[] = [];

    if (process.platform === 'darwin') {
      possiblePaths.push(
        '/opt/homebrew/bin/cursor',
        '/usr/local/bin/cursor',
        '/Applications/Cursor.app/Contents/Resources/app/bin/cursor',
      );
    } else if (process.platform === 'linux') {
      possiblePaths.push(
        '/usr/bin/cursor',
        '/usr/local/bin/cursor',
        `${process.env.HOME}/.local/bin/cursor`,
      );
    } else if (process.platform === 'win32') {
      possiblePaths.push(
        `${process.env.LOCALAPPDATA}\\Programs\\Cursor\\resources\\app\\bin\\cursor.cmd`,
        `${process.env.LOCALAPPDATA}\\Programs\\Cursor\\cursor.exe`,
        'C:\\Program Files\\Cursor\\cursor.exe',
      );
    }

    // Check each path
    for (const cursorPath of possiblePaths) {
      if (fs.existsSync(cursorPath)) {
        logger.debug(`[CursorChatOpener] Found Cursor at: ${cursorPath}`);
        return cursorPath;
      }
    }

    // Try to find via `which` command
    try {
      const result = execSync('which cursor 2>/dev/null', { encoding: 'utf-8' });
      const cursorPath = result.trim();
      if (cursorPath && fs.existsSync(cursorPath)) {
        logger.debug(`[CursorChatOpener] Found Cursor via which: ${cursorPath}`);
        return cursorPath;
      }
    } catch (error) {
      // which command failed, continue
    }

    logger.warn('[CursorChatOpener] Cursor CLI not found');
    return null;
  }

  /**
   * Check if Cursor CLI is available
   */
  isCursorAvailable(): boolean {
    return this.cursorPath !== null;
  }

  /**
   * Get the path to Cursor CLI
   */
  getCursorPath(): string | null {
    return this.cursorPath;
  }

  /**
   * Get Cursor agent version
   */
  async getAgentVersion(): Promise<string | null> {
    if (!this.cursorPath) {
      return null;
    }

    try {
      const { stdout } = await execAsync(`"${this.cursorPath}" agent --version`);
      return stdout.trim();
    } catch (error) {
      return null;
    }
  }
}

/**
 * Quick function to open a chat with minimal configuration
 */
export async function quickOpenChat(request: ChatRequest): Promise<ChatOpenResult> {
  const opener = new CursorChatOpener();
  return opener.openChat(request);
}

/**
 * Quick function to create a new empty chat
 */
export async function quickCreateChat(): Promise<{ success: boolean; chatId?: string; error?: string }> {
  const opener = new CursorChatOpener();
  return opener.createChat();
}

/**
 * Quick function to start agent with prompt
 */
export async function quickStartAgent(prompt: string, workspace?: string): Promise<{ success: boolean; message: string }> {
  const opener = new CursorChatOpener({ workspacePath: workspace });
  return opener.startAgentWithPrompt(prompt, { workspace });
}


