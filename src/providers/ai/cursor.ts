/**
 * Cursor AI Provider
 *
 * Uses direct MCP tool invocation to access Cursor's AI capabilities.
 * The MCP tool is called by Cursor agents, which have access to Cursor AI.
 */

import { AIProvider, AIProviderConfig } from './interface';
import { CodeChanges, TaskContext, LogAnalysis } from '../../types';
import { logger } from '../../core/logger';
import { executeCursorGenerateCode } from '../../mcp/tools/cursor-ai';

export class CursorProvider implements AIProvider {
  public name = 'cursor';
  private config: AIProviderConfig & { model?: string };

  constructor(config: AIProviderConfig) {
    this.config = config as any;
  }

  async generateCode(prompt: string, context: TaskContext): Promise<CodeChanges> {
    const model = (this.config as any).model || 'auto';

    logger.info(`[CursorProvider] Generating code via direct MCP invocation`);
    logger.info(`[CursorProvider] Task: ${context.task.title}`);
    logger.info(`[CursorProvider] Model: ${model}`);
    logger.info(`[CursorProvider] Waiting for Cursor agent to process via MCP tool...`);

    try {
      // Call the direct execution function
      // This will create an in-memory request that the Cursor agent can process via MCP
      const codeChanges = await executeCursorGenerateCode(
        prompt,
        {
          id: context.task.id,
          title: context.task.title,
          description: context.task.description,
        },
        model,
        context.codebaseContext
      );

      logger.info(`[CursorProvider] Successfully received code changes: ${codeChanges.files.length} files`);
      return codeChanges;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[CursorProvider] Failed to generate code: ${errorMessage}`);
      throw new Error(`Failed to generate code via Cursor AI: ${errorMessage}`);
    }
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

}

