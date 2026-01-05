/**
 * Cursor AI Provider
 *
 * Uses file-based communication with MCP tools to access Cursor's AI capabilities.
 * The MCP tool is called by Cursor agents, which have access to Cursor AI.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AIProvider, AIProviderConfig } from './interface';
import { CodeChanges, TaskContext, LogAnalysis } from '../../types';
import { logger } from '../../core/logger';

const REQUESTS_DIR = path.join(process.cwd(), '.cursor-ai-requests');
const RESPONSES_DIR = path.join(process.cwd(), '.cursor-ai-responses');

interface FileRequest {
  id: string;
  prompt: string;
  task: {
    id: string;
    title: string;
    description: string;
  };
  model: string;
  codebaseContext?: string;
  timestamp: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

interface FileResponse {
  requestId: string;
  success: boolean;
  codeChanges?: CodeChanges;
  error?: string;
  timestamp: string;
}

export class CursorProvider implements AIProvider {
  public name = 'cursor';
  private config: AIProviderConfig & { model?: string };
  private maxWaitTime: number = 120000; // 2 minutes
  private checkInterval: number = 1000; // 1 second

  constructor(config: AIProviderConfig) {
    this.config = config as any;

    // Ensure directories exist
    if (!fs.existsSync(REQUESTS_DIR)) {
      fs.mkdirSync(REQUESTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(RESPONSES_DIR)) {
      fs.mkdirSync(RESPONSES_DIR, { recursive: true });
    }
  }

  async generateCode(prompt: string, context: TaskContext): Promise<CodeChanges> {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const model = (this.config as any).model || 'auto';

    const request: FileRequest = {
      id: requestId,
      prompt,
      task: {
        id: context.task.id,
        title: context.task.title,
        description: context.task.description,
      },
      model,
      codebaseContext: context.codebaseContext,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };

    // Write request file
    const requestFile = path.join(REQUESTS_DIR, `${requestId}.json`);
    fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), 'utf-8');

    logger.info(`[CursorProvider] Created request file: ${requestFile}`);
    logger.info(`[CursorProvider] Request ID: ${requestId}`);
    logger.info(`[CursorProvider] Model: ${model}`);
    logger.info(`[CursorProvider] Waiting for Cursor agent to process via MCP tool...`);
    logger.info(`[CursorProvider] Call MCP tool: cursor_process_ai_request with requestId: ${requestId}`);

    // Wait for response file
    // The Cursor agent should call the MCP tool to process this request
    const responseFile = path.join(RESPONSES_DIR, `${requestId}.json`);
    const response = await this.waitForResponse(responseFile, requestId);

    // Clean up files
    try {
      if (fs.existsSync(requestFile)) {
        fs.unlinkSync(requestFile);
      }
      if (fs.existsSync(responseFile)) {
        fs.unlinkSync(responseFile);
      }
    } catch (error) {
      logger.warn(`[CursorProvider] Failed to clean up files: ${error}`);
    }

    if (response.success && response.codeChanges) {
      logger.info(`[CursorProvider] Successfully received code changes: ${response.codeChanges.files.length} files`);
      return response.codeChanges;
    }

    throw new Error(response.error || 'Failed to generate code via Cursor AI');
  }

  async analyzeError(error: string, context: TaskContext): Promise<LogAnalysis> {
    // For error analysis, use the same approach
    const prompt = `Analyze this error and provide recommendations:

Error:
${error}

Task Context:
${context.task.description}

Provide a JSON response with:
{
  "errors": ["list of errors"],
  "warnings": ["list of warnings"],
  "summary": "brief summary",
  "recommendations": ["actionable recommendations"]
}`;

    try {
      const codeChanges = await this.generateCode(prompt, context);
      // Try to extract LogAnalysis from the response
      if (codeChanges.summary) {
        // Parse the summary to extract structured data if possible
        try {
          const parsed = JSON.parse(codeChanges.summary);
          if (parsed.errors || parsed.warnings) {
            return parsed as LogAnalysis;
          }
        } catch {
          // Not JSON, use as summary
        }

        return {
          errors: [error],
          warnings: [],
          summary: codeChanges.summary,
          recommendations: [],
        };
      }
    } catch (error) {
      logger.warn(`[CursorProvider] Error analysis failed: ${error}`);
    }

    return {
      errors: [error],
      warnings: [],
      summary: 'Error analysis via Cursor AI failed',
    };
  }

  private async waitForResponse(responseFile: string, requestId: string): Promise<FileResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.maxWaitTime) {
      if (fs.existsSync(responseFile)) {
        try {
          const content = fs.readFileSync(responseFile, 'utf-8');
          const response = JSON.parse(content) as FileResponse;

          if (response.requestId === requestId) {
            return response;
          }
        } catch (error) {
          logger.warn(`[CursorProvider] Failed to parse response file: ${error}`);
        }
      }

      await new Promise(resolve => setTimeout(resolve, this.checkInterval));
    }

    return {
      requestId,
      success: false,
      error: `Timeout waiting for response. Make sure to call the MCP tool 'cursor_process_ai_request' with requestId: ${requestId} to process the request file.`,
      timestamp: new Date().toISOString(),
    };
  }
}

