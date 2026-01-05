/**
 * Cursor AI Tools for MCP
 *
 * Tools that allow dev-loop to use Cursor's AI capabilities via file-based communication
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { FastMCPType } from './index';

const REQUESTS_DIR = path.join(process.cwd(), '.cursor-ai-requests');
const RESPONSES_DIR = path.join(process.cwd(), '.cursor-ai-responses');

// Ensure directories exist
if (!fs.existsSync(REQUESTS_DIR)) {
  fs.mkdirSync(REQUESTS_DIR, { recursive: true });
}
if (!fs.existsSync(RESPONSES_DIR)) {
  fs.mkdirSync(RESPONSES_DIR, { recursive: true });
}

export function registerCursorAITools(mcp: FastMCPType): void {
  // Tool: Process AI generation request from file
  // This tool is called by Cursor agent, which has access to Cursor AI
  mcp.addTool({
    name: 'cursor_process_ai_request',
    description: 'Process an AI code generation request from a file. The Cursor agent calling this tool should use Cursor AI to generate code based on the request, then write the response file.',
    parameters: z.object({
      requestId: z.string().describe('Request ID (filename without .json extension)'),
    }),
    execute: async (args: { requestId: string }, context: any) => {
      const requestFile = path.join(REQUESTS_DIR, `${args.requestId}.json`);
      const responseFile = path.join(RESPONSES_DIR, `${args.requestId}.json`);

      // Check if request file exists
      if (!fs.existsSync(requestFile)) {
        return JSON.stringify({
          success: false,
          error: `Request file not found: ${requestFile}`,
        });
      }

      // Read request
      let request: any;
      try {
        const content = fs.readFileSync(requestFile, 'utf-8');
        request = JSON.parse(content);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: `Failed to read/parse request file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      // Update request status
      request.status = 'processing';
      fs.writeFileSync(requestFile, JSON.stringify(request, null, 2));

      // Build instructions for Cursor agent
      // The agent calling this tool should use Cursor AI to generate code
      const instructions = {
        requestId: args.requestId,
        prompt: `Task: ${request.task.title}
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
}`,
        model: request.model || 'auto',
        responseFile,
        note: 'Use Cursor AI to generate code based on the prompt above, then write the response file with the CodeChanges format.',
      };

      return JSON.stringify({
        success: true,
        message: 'Request loaded. Use Cursor AI to generate code and write response file.',
        instructions,
      });
    },
  });

  // Tool: Generate code directly (simpler approach)
  // This tool returns instructions for the Cursor agent to use Cursor AI
  mcp.addTool({
    name: 'cursor_generate_code',
    description: 'Generate code using Cursor AI. The Cursor agent calling this tool should use Cursor AI capabilities to generate code based on the provided prompt and task context.',
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
        message: 'Use Cursor AI to generate code. The agent calling this tool has access to Cursor AI and should generate the code, then return the CodeChanges format.',
        systemPrompt,
        userPrompt: args.prompt,
        model: args.model || 'auto',
        note: 'The calling Cursor agent should use Cursor AI with the prompts above to generate code and return it in CodeChanges format.',
      });
    },
  });
}

