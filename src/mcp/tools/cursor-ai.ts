/**
 * Cursor AI Tools for MCP
 *
 * Tools that allow dev-loop to use Cursor's AI capabilities via direct MCP invocation
 */

import { z } from 'zod';
import { FastMCPType } from './index';
import { CodeChanges } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

// In-memory request/response queue for direct invocation
interface DirectRequest {
  id: string;
  prompt: string;
  task: {
    id: string;
    title: string;
    description: string;
  };
  model: string;
  codebaseContext?: string;
  resolve: (result: CodeChanges) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

// Map of request ID to pending request
const pendingRequests = new Map<string, DirectRequest>();

// Maximum wait time for direct requests (10 minutes for contribution mode)
const MAX_WAIT_TIME = 600000;

// Configurable path for Cursor AI files (can be set via setCursorAIPath or config)
let cursorAIPath: string | null = null;

/**
 * Get the Cursor AI directory path (lazy-loaded from config or default)
 */
function getCursorAIDir(): string {
  if (cursorAIPath) {
    return path.join(process.cwd(), cursorAIPath);
  }

  // Try to load from config file
  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    if (fs.existsSync(configPath)) {
      // Use require for CommonJS config
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      if (config?.cursor?.requestsPath) {
        const configuredPath = config.cursor.requestsPath as string;
        cursorAIPath = configuredPath;
        return path.join(process.cwd(), configuredPath);
      }
    }
  } catch (error) {
    // Config loading failed, use default
  }

  // Default path
  return path.join(process.cwd(), 'files-private', 'cursor');
}

/**
 * Set the Cursor AI path programmatically
 */
export function setCursorAIPath(relativePath: string): void {
  cursorAIPath = relativePath;
}

/**
 * Get the Cursor agent name from config
 */
function getCursorAgentName(): string {
  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    if (fs.existsSync(configPath)) {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      if (config?.cursor?.agentName) {
        return config.cursor.agentName as string;
      }
    }
  } catch (error) {
    // Config loading failed, use default
  }
  return 'DevLoopCodeGen';
}

/**
 * Get the default model from config
 */
function getCursorModel(): string {
  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    if (fs.existsSync(configPath)) {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      if (config?.cursor?.model) {
        return config.cursor.model as string;
      }
    }
  } catch (error) {
    // Config loading failed, use default
  }
  return 'auto';
}

/**
 * Get the pending requests file path
 */
function getPendingRequestsFile(): string {
  return path.join(getCursorAIDir(), 'pending-requests.json');
}

/**
 * Get the completed requests directory path
 */
function getCompletedRequestsDir(): string {
  return path.join(getCursorAIDir(), 'completed');
}

/**
 * Ensure the cursor AI directory exists
 */
function ensureCursorAIDir(): void {
  try {
    const cursorDir = getCursorAIDir();
    const completedDir = getCompletedRequestsDir();
    if (!fs.existsSync(cursorDir)) {
      fs.mkdirSync(cursorDir, { recursive: true });
    }
    if (!fs.existsSync(completedDir)) {
      fs.mkdirSync(completedDir, { recursive: true });
    }
  } catch (error) {
    // Ignore directory creation errors
  }
}

/**
 * Write pending requests to file for external access
 */
function writePendingRequestsToFile(): void {
  try {
    ensureCursorAIDir();
    const agentName = getCursorAgentName();
    const requests = Array.from(pendingRequests.values()).map(req => ({
      id: req.id,
      prompt: req.prompt,
      task: req.task,
      model: req.model || getCursorModel(),
      codebaseContext: req.codebaseContext,
      agent: agentName,
      timestamp: req.timestamp,
      // Don't include resolve/reject functions
    }));
    fs.writeFileSync(getPendingRequestsFile(), JSON.stringify(requests, null, 2));
  } catch (error) {
    // Ignore file write errors
  }
}

/**
 * Remove request from file when completed
 */
function removeRequestFromFile(requestId: string): void {
  try {
    const pendingFile = getPendingRequestsFile();
    if (fs.existsSync(pendingFile)) {
      const content = fs.readFileSync(pendingFile, 'utf-8');
      const requests = JSON.parse(content);
      const filtered = requests.filter((r: any) => r.id !== requestId);
      if (filtered.length === 0) {
        fs.unlinkSync(pendingFile);
      } else {
        fs.writeFileSync(pendingFile, JSON.stringify(filtered, null, 2));
      }
    }
  } catch (error) {
    // Ignore file errors
  }
}

/**
 * Direct execution function for code generation
 * Can be called directly by CursorProvider without going through MCP protocol
 */
export async function executeCursorGenerateCode(
  prompt: string,
  task: { id: string; title: string; description: string },
  model: string = 'auto',
  codebaseContext?: string
): Promise<CodeChanges> {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;

  return new Promise<CodeChanges>((resolve, reject) => {
    // Store the request in memory
    const request: DirectRequest = {
      id: requestId,
      prompt,
      task,
      model,
      codebaseContext,
      resolve,
      reject,
      timestamp: Date.now(),
    };

    pendingRequests.set(requestId, request);
    writePendingRequestsToFile(); // Write to file for external access

    // Poll for file-based completion (fallback mechanism)
    const pollInterval = setInterval(async () => {
      try {
        const completedDir = getCompletedRequestsDir();
        if (!fs.existsSync(completedDir)) {
          fs.mkdirSync(completedDir, { recursive: true });
          return; // Directory didn't exist, wait for next poll
        }
        const completionFile = path.join(completedDir, `${requestId}.json`);
        if (fs.existsSync(completionFile)) {
          try {
            // Read file with retry for race conditions
            let fileContent: string;
            let completion: any;
            let retries = 3;
            while (retries > 0) {
              try {
                fileContent = fs.readFileSync(completionFile, 'utf-8');
                if (!fileContent || fileContent.trim().length === 0) {
                  retries--;
                  if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    continue;
                  }
                  throw new Error('Completion file is empty');
                }
                completion = JSON.parse(fileContent);
                break; // Successfully parsed
              } catch (parseError) {
                retries--;
                if (retries === 0) {
                  throw parseError;
                }
                // Wait a bit and retry (file might be partially written)
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            }

            clearInterval(pollInterval);
            fs.unlinkSync(completionFile);
            if (completion.error) {
              pendingRequests.delete(requestId);
              removeRequestFromFile(requestId);
              reject(new Error(completion.error));
            } else if (completion.codeChanges) {
              pendingRequests.delete(requestId);
              removeRequestFromFile(requestId);
              request.resolve(completion.codeChanges);
            } else {
              // Invalid completion format
              pendingRequests.delete(requestId);
              removeRequestFromFile(requestId);
              reject(new Error(`Invalid completion format: missing codeChanges in ${requestId}`));
            }
          } catch (readError) {
            // If reading/parsing fails, log but don't stop polling
            const errorMessage = readError instanceof Error ? readError.message : String(readError);
            console.error(`[CursorProvider] Error reading completion file ${requestId}: ${errorMessage}`);
          }
        }
      } catch (error) {
        // Log polling errors for debugging
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[CursorProvider] Polling error for ${requestId}: ${errorMessage}`);
      }
    }, 1000); // Poll every second

    // Set timeout to clean up stale requests
    setTimeout(() => {
      clearInterval(pollInterval);
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        removeRequestFromFile(requestId);
        const pendingFile = getPendingRequestsFile();
        const completedDir = getCompletedRequestsDir();
        reject(new Error(
          `Timeout waiting for Cursor AI to process request ${requestId}. ` +
          `The request was written to ${pendingFile} for manual processing. ` +
          `To complete this request, write a response to ${completedDir}/${requestId}.json ` +
          `with format: {"codeChanges": {"files": [...], "summary": "..."}}. ` +
          `If using file-based communication, check ${pendingFile} for pending requests.`
        ));
      }
    }, MAX_WAIT_TIME);
  });
}

/**
 * Complete a pending request with code changes
 * Called by the MCP tool when Cursor agent processes the request
 */
export function completeCursorRequest(requestId: string, codeChanges: CodeChanges): void {
  const request = pendingRequests.get(requestId);
  if (request) {
    // In-memory request - resolve directly
    pendingRequests.delete(requestId);
    removeRequestFromFile(requestId);
    request.resolve(codeChanges);
  } else {
    // File-based request - write completion file
    try {
      const completedDir = getCompletedRequestsDir();
      if (!fs.existsSync(completedDir)) {
        fs.mkdirSync(completedDir, { recursive: true });
      }
      const completionFile = path.join(completedDir, `${requestId}.json`);
      fs.writeFileSync(completionFile, JSON.stringify({ codeChanges }, null, 2));
      removeRequestFromFile(requestId);
    } catch (error) {
      console.error(`[CursorProvider] Error writing completion file for ${requestId}:`, error);
    }
  }
}

/**
 * Fail a pending request
 * Called when there's an error processing the request
 */
export function failCursorRequest(requestId: string, error: string): void {
  const request = pendingRequests.get(requestId);
  if (request) {
    // In-memory request - reject directly
    pendingRequests.delete(requestId);
    removeRequestFromFile(requestId);
    request.reject(new Error(error));
  } else {
    // File-based request - write error completion file
    try {
      const completedDir = getCompletedRequestsDir();
      if (!fs.existsSync(completedDir)) {
        fs.mkdirSync(completedDir, { recursive: true });
      }
      const completionFile = path.join(completedDir, `${requestId}.json`);
      fs.writeFileSync(completionFile, JSON.stringify({ error }, null, 2));
      removeRequestFromFile(requestId);
    } catch (writeError) {
      console.error(`[CursorProvider] Error writing error completion file for ${requestId}:`, writeError);
    }
  }
}

/**
 * Read pending requests from file (for cross-process access)
 */
function readPendingRequestsFromFile(): Array<DirectRequest> {
  try {
    const pendingFile = getPendingRequestsFile();
    if (!fs.existsSync(pendingFile)) {
      return [];
    }

    const fileContent = fs.readFileSync(pendingFile, 'utf-8');
    if (!fileContent || fileContent.trim().length === 0) {
      return [];
    }

    const data = JSON.parse(fileContent);

    // File format is an array of requests (from writePendingRequestsToFile)
    if (Array.isArray(data)) {
      return data.map((req: any) => ({
        id: req.id,
        prompt: req.prompt || '', // May not be in file, will need to get from request
        task: req.task,
        model: req.model || req.agent || getCursorModel(),
        codebaseContext: req.codebaseContext,
        resolve: () => {}, // No-op for file-based requests
        reject: () => {}, // No-op for file-based requests
        timestamp: req.timestamp || Date.now(),
      }));
    }
  } catch (error) {
    // Ignore file read errors
  }
  return [];
}

/**
 * Get list of pending requests
 * Used by Cursor agent to discover requests that need processing
 * Checks both in-memory Map and file system for cross-process compatibility
 */
export function getPendingRequests(): Array<{ id: string; task: { title: string }; timestamp: number }> {
  // Get from in-memory Map first
  const inMemoryRequests = Array.from(pendingRequests.values()).map(req => ({
    id: req.id,
    task: { title: req.task.title },
    timestamp: req.timestamp,
  }));

  // Also check file system for requests from other processes
  const fileRequests = readPendingRequestsFromFile()
    .filter(req => !pendingRequests.has(req.id)) // Don't duplicate in-memory requests
    .map(req => ({
      id: req.id,
      task: { title: req.task.title },
      timestamp: req.timestamp,
    }));

  return [...inMemoryRequests, ...fileRequests];
}

export function registerCursorAITools(mcp: FastMCPType): void {
  // Tool: List pending requests
  // Called by Cursor agent to discover requests that need processing
  mcp.addTool({
    name: 'cursor_list_pending_requests',
    description: 'List all pending code generation requests that need to be processed by Cursor AI.',
    parameters: z.object({}),
    execute: async () => {
      const requests = getPendingRequests();
      return JSON.stringify({
        success: true,
        count: requests.length,
        requests,
        message: requests.length > 0
          ? `Found ${requests.length} pending request(s). Call cursor_process_ai_request with a requestId to process one.`
          : 'No pending requests.',
      });
    },
  });

  // Tool: Process AI generation request (direct invocation)
  // This tool is called by Cursor agent, which has access to Cursor AI
  mcp.addTool({
    name: 'cursor_process_ai_request',
    description: 'Process an AI code generation request. The Cursor agent calling this tool should use Cursor AI to generate code based on the request and return the result directly.',
    parameters: z.object({
      requestId: z.string().describe('Request ID from the pending request (use cursor_list_pending_requests to find pending requests)'),
    }),
    execute: async (args: { requestId: string }, context: any) => {
      // Check in-memory Map first
      let request = pendingRequests.get(args.requestId);

      // If not in memory, try reading from file (cross-process access)
      if (!request) {
        const fileRequests = readPendingRequestsFromFile();
        request = fileRequests.find(req => req.id === args.requestId);
      }

      if (!request) {
        return JSON.stringify({
          success: false,
          error: `Request not found: ${args.requestId}. Request may have timed out. Use cursor_list_pending_requests to see available requests.`,
        });
      }

      // Build prompt for Cursor agent
      const fullPrompt = `Task: ${request.task.title}
Description: ${request.task.description}

${request.codebaseContext ? `Codebase Context:\n${request.codebaseContext}\n` : ''}

${request.prompt}

Please generate code changes in JSON format:
{
  "files": [
    {
      "path": "relative/path/to/file",
      "content": "complete file content",
      "operation": "create" | "update" | "delete"
    }
  ],
  "summary": "brief summary of changes"
}`;

      return JSON.stringify({
        success: true,
        message: 'Request loaded. Use Cursor AI to generate code and call cursor_complete_request with the result.',
        requestId: args.requestId,
        prompt: fullPrompt,
        model: request.model,
        note: 'After generating code with Cursor AI, call cursor_complete_request with the CodeChanges JSON.',
      });
    },
  });

  // Tool: Generate code directly (standalone tool for Cursor agent)
  // This tool creates a pending request that the Cursor agent can complete
  // Note: This is for standalone use by Cursor agent. CursorProvider uses executeCursorGenerateCode instead.
  mcp.addTool({
    name: 'cursor_generate_code',
    description: 'Generate code using Cursor AI. Creates a pending request that you should complete by calling cursor_complete_request with the generated code.',
    parameters: z.object({
      prompt: z.string().describe('Code generation prompt'),
      task: z.object({
        id: z.string(),
        title: z.string(),
        description: z.string(),
      }),
      model: z.string().optional().describe('Model to use (default: auto)'),
      codebaseContext: z.string().optional().describe('Codebase context'),
    }),
    execute: async (args: { prompt: string; task: any; model?: string; codebaseContext?: string }, context: any) => {
      // Create a request ID
      const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Create a pending request with a no-op resolver (since this is called directly by Cursor agent)
      // The Cursor agent will call cursor_complete_request which will handle the completion
      const request: DirectRequest = {
        id: requestId,
        prompt: args.prompt,
        task: args.task,
        model: args.model || 'auto',
        codebaseContext: args.codebaseContext,
        resolve: () => {}, // No-op - completion handled by cursor_complete_request
        reject: () => {}, // No-op - failure handled by cursor_fail_request
        timestamp: Date.now(),
      };

      pendingRequests.set(requestId, request);

      // Set timeout to clean up stale requests
      setTimeout(() => {
        if (pendingRequests.has(requestId)) {
          pendingRequests.delete(requestId);
        }
      }, MAX_WAIT_TIME);

      const systemPrompt = `You are an expert software developer. Generate code changes based on the task description.
Model: ${args.model || 'auto'}

Task: ${args.task.title}
Description: ${args.task.description}

${args.codebaseContext ? `Codebase Context:\n${args.codebaseContext}\n` : ''}

Return your response as a JSON object with this structure:
{
  "files": [
    {
      "path": "relative/path/to/file",
      "content": "complete file content",
      "operation": "create" | "update" | "delete"
    }
  ],
  "summary": "brief summary of changes"
}`;

      return JSON.stringify({
        success: true,
        message: 'Use Cursor AI to generate code. After generating code, call cursor_complete_request with the requestId and CodeChanges JSON.',
        requestId,
        systemPrompt,
        userPrompt: args.prompt,
        model: args.model || 'auto',
        note: 'The calling Cursor agent should: 1) Use Cursor AI with the prompts above to generate code, 2) Call cursor_complete_request with requestId and the CodeChanges JSON.',
      });
    },
  });

  // Tool: Complete a request with code changes
  // Called by Cursor agent after generating code
  mcp.addTool({
    name: 'cursor_complete_request',
    description: 'Complete a code generation request with the generated code changes. Call this after using Cursor AI to generate code.',
    parameters: z.object({
      requestId: z.string().describe('Request ID from cursor_generate_code or cursor_process_ai_request'),
      codeChanges: z.object({
        files: z.array(z.object({
          path: z.string(),
          content: z.string().optional(),
          patches: z.array(z.object({
            search: z.string(),
            replace: z.string(),
          })).optional(),
          operation: z.enum(['create', 'update', 'delete', 'patch']),
        })),
        summary: z.string(),
      }).describe('The generated code changes'),
    }),
    execute: async (args: { requestId: string; codeChanges: CodeChanges }, context: any) => {
      completeCursorRequest(args.requestId, args.codeChanges);
      return JSON.stringify({
        success: true,
        message: `Request ${args.requestId} completed successfully with ${args.codeChanges.files.length} file(s).`,
      });
    },
  });

  // Tool: Fail a request
  // Called by Cursor agent if code generation fails
  mcp.addTool({
    name: 'cursor_fail_request',
    description: 'Mark a code generation request as failed. Call this if code generation encounters an error.',
    parameters: z.object({
      requestId: z.string().describe('Request ID from cursor_generate_code or cursor_process_ai_request'),
      error: z.string().describe('Error message describing what went wrong'),
    }),
    execute: async (args: { requestId: string; error: string }, context: any) => {
      failCursorRequest(args.requestId, args.error);
      return JSON.stringify({
        success: true,
        message: `Request ${args.requestId} marked as failed.`,
      });
    },
  });
}

