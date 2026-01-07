/**
 * Chat Request System
 *
 * Manages file-based chat requests for creating visible chat sessions
 * in Cursor IDE.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ChatRequest } from '../../types';
import { logger } from '../../core/logger';

interface ChatRequestsFile {
  requests: ChatRequest[];
}

/**
 * Create a chat request and add it to chat-requests.json
 *
 * @param request - Chat request object (id and createdAt will be auto-generated if not provided)
 * @returns Promise resolving to the request ID
 */
export async function createChatRequest(request: Partial<ChatRequest>): Promise<string> {
  const requestsPath = getChatRequestsPath();
  const requestId = request.id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const createdAt = request.createdAt || new Date().toISOString();

  const chatRequest: ChatRequest = {
    id: requestId,
    agentName: request.agentName || '',
    question: request.question || '',
    model: request.model || 'Auto',
    mode: request.mode || 'Ask',
    status: 'pending',
    createdAt,
    context: request.context,
  };

  // Load existing requests
  const requests = await loadChatRequests();

  // Add new request
  requests.requests.push(chatRequest);

  // Save to file
  await saveChatRequests(requests);

  logger.info(`[ChatRequests] Created chat request: ${requestId} for agent ${chatRequest.agentName}`);
  return requestId;
}

/**
 * List all pending chat requests
 *
 * @returns Promise resolving to array of pending chat requests
 */
export async function listPendingChatRequests(): Promise<ChatRequest[]> {
  const requests = await loadChatRequests();
  return requests.requests.filter(req => req.status === 'pending');
}

/**
 * List all chat requests (pending, processed, failed)
 *
 * @returns Promise resolving to array of all chat requests
 */
export async function listAllChatRequests(): Promise<ChatRequest[]> {
  const requests = await loadChatRequests();
  return requests.requests;
}

/**
 * Mark a chat request as processed
 *
 * @param requestId - ID of the request to mark as processed
 * @returns Promise resolving when update is complete
 */
export async function markRequestProcessed(requestId: string): Promise<void> {
  const requests = await loadChatRequests();
  const request = requests.requests.find(req => req.id === requestId);

  if (request) {
    request.status = 'processed';
    await saveChatRequests(requests);
    logger.info(`[ChatRequests] Marked request as processed: ${requestId}`);
  } else {
    logger.warn(`[ChatRequests] Request not found: ${requestId}`);
  }
}

/**
 * Mark a chat request as failed
 *
 * @param requestId - ID of the request to mark as failed
 * @returns Promise resolving when update is complete
 */
export async function markRequestFailed(requestId: string): Promise<void> {
  const requests = await loadChatRequests();
  const request = requests.requests.find(req => req.id === requestId);

  if (request) {
    request.status = 'failed';
    await saveChatRequests(requests);
    logger.info(`[ChatRequests] Marked request as failed: ${requestId}`);
  } else {
    logger.warn(`[ChatRequests] Request not found: ${requestId}`);
  }
}

/**
 * Clear processed requests from the file
 *
 * @returns Promise resolving when cleanup is complete
 */
export async function clearProcessedRequests(): Promise<void> {
  const requests = await loadChatRequests();
  const beforeCount = requests.requests.length;
  requests.requests = requests.requests.filter(req => req.status === 'pending' || req.status === 'failed');
  const afterCount = requests.requests.length;

  if (beforeCount !== afterCount) {
    await saveChatRequests(requests);
    logger.info(`[ChatRequests] Cleared ${beforeCount - afterCount} processed requests`);
  }
}

/**
 * Load chat requests from file
 */
async function loadChatRequests(): Promise<ChatRequestsFile> {
  const requestsPath = getChatRequestsPath();

  try {
    // Ensure directory exists
    const dir = path.dirname(requestsPath);
    await fs.promises.mkdir(dir, { recursive: true });

    // Load file if it exists
    if (fs.existsSync(requestsPath)) {
      const content = await fs.promises.readFile(requestsPath, 'utf-8');
      return JSON.parse(content) as ChatRequestsFile;
    }
  } catch (error) {
    logger.warn(`[ChatRequests] Failed to load requests file: ${error}`);
  }

  // Return empty structure if file doesn't exist or parsing failed
  return { requests: [] };
}

/**
 * Save chat requests to file
 */
async function saveChatRequests(requests: ChatRequestsFile): Promise<void> {
  const requestsPath = getChatRequestsPath();

  try {
    // Ensure directory exists
    const dir = path.dirname(requestsPath);
    await fs.promises.mkdir(dir, { recursive: true });

    // Write file with pretty formatting
    await fs.promises.writeFile(requestsPath, JSON.stringify(requests, null, 2), 'utf-8');
  } catch (error) {
    logger.error(`[ChatRequests] Failed to save requests file: ${error}`);
    throw error;
  }
}

/**
 * Get the chat requests file path from config or use default
 */
function getChatRequestsPath(): string {
  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    if (fs.existsSync(configPath)) {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      if (config?.cursor?.agents?.chatRequestsPath) {
        return path.join(process.cwd(), config.cursor.agents.chatRequestsPath);
      }
    }
  } catch (error) {
    // Config loading failed, use default
  }

  // Default path
  return path.join(process.cwd(), 'files-private', 'cursor', 'chat-requests.json');
}




