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
import { generateAgentConfig } from './cursor-agent-generator';
import { createChatRequest } from './cursor-chat-requests';
import { CursorChatOpener } from './cursor-chat-opener';
import { extractCodeChanges, parseCodeChangesFromText, JsonParsingContext } from './json-parser';
import { ObservationTracker } from '../../core/observation-tracker';
import * as path from 'path';

export class CursorProvider implements AIProvider {
  public name = 'cursor';
  private config: AIProviderConfig & { model?: string };
  private observationTracker: ObservationTracker;

  constructor(config: AIProviderConfig, observationTracker?: ObservationTracker) {
    this.config = config as any;
    // Create a default ObservationTracker if not provided
    this.observationTracker = observationTracker || new ObservationTracker();
  }

  async generateCode(prompt: string, context: TaskContext): Promise<CodeChanges> {
    const model = (this.config as any).model || 'auto';
    const cursorConfig = (this.config as any).cursor || {};
    const agentsConfig = cursorConfig.agents || {};

    // Check configuration for background agent mode
    const useBackgroundAgent = agentsConfig.useBackgroundAgent !== false; // Default to true
    const createObservabilityChats = agentsConfig.createObservabilityChats === true; // Only true if explicitly true
    const fallbackToFileBased = agentsConfig.fallbackToFileBased === true; // Only true if explicitly true
    const agentOutputFormat = agentsConfig.agentOutputFormat || 'json';

    // Extract PRD/phase context
    const prdId = context.prdId || 'default';
    const phaseId = context.phaseId || null;
    const prdSetId = context.prdSetId || null;

    // Generate unique agent name
    const agentName = this.getAgentName(context);

    // 1. Create observability chat (parallel, non-blocking) if enabled
    if (createObservabilityChats && agentsConfig.enabled !== false && agentsConfig.autoGenerate !== false) {
      this.createObservabilityChat(context, prompt, agentName).catch(error => {
        logger.warn(`[CursorProvider] Failed to create observability chat: ${error}`);
        // Don't block execution if observability chat fails
      });
    }

    // 2. Use background agent for autonomous execution (primary path)
    if (useBackgroundAgent) {
      try {
        logger.info(`[CursorProvider] Using background agent for autonomous code generation`);
        logger.info(`[CursorProvider] Task: ${context.task.title}`);
        logger.info(`[CursorProvider] Model: ${model}`);

        const workspacePath = (this.config as any).workspacePath || process.cwd();
        // Get session management config from cursor config
        const sessionConfig = (cursorConfig as any)?.agents?.sessionManagement;

        const chatOpener = new CursorChatOpener({
          useBackgroundAgent: true,
          agentOutputFormat: agentOutputFormat as 'json' | 'text' | 'stream-json',
          openStrategy: 'agent',
          workspacePath,
          sessionManagement: sessionConfig,
        });

        const chatRequest = {
          id: `req-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          agentName,
          question: this.buildFullPrompt(prompt, context),
          model,
          mode: 'Ask' as const,
          status: 'pending' as const,
          createdAt: new Date().toISOString(),
          context: {
            prdId,
            phaseId,
            prdSetId,
            taskId: context.task.id,
            taskTitle: context.task.title,
          },
        };

        const result = await chatOpener.openChat(chatRequest);

        if (result.success && result.response) {
          const codeChanges = this.extractCodeChangesFromResponse(result.response, context);
          if (codeChanges) {
            logger.info(`[CursorProvider] Successfully received code changes from background agent: ${codeChanges.files.length} files`);
            return codeChanges;
          } else {
            logger.warn(`[CursorProvider] Background agent succeeded but no CodeChanges extracted`);
            // Retry with stricter JSON instruction (up to 2 retries)
            const maxRetries = 2;
            for (let retryAttempt = 1; retryAttempt <= maxRetries; retryAttempt++) {
              logger.info(`[CursorProvider] Retry ${retryAttempt}/${maxRetries} with stricter JSON instruction`);

              const retryRequest = {
                ...chatRequest,
                id: `retry-${retryAttempt}-${chatRequest.id}`,
                question: this.buildStrictJsonPrompt(context),
              };

              const retryResult = await chatOpener.openChat(retryRequest);
              if (retryResult.success && retryResult.response) {
                const retryChanges = this.extractCodeChangesFromResponse(retryResult.response, context);
                if (retryChanges) {
                  logger.info(`[CursorProvider] Retry ${retryAttempt} succeeded: ${retryChanges.files.length} files`);
                  return retryChanges;
                }
              }
            }
            logger.error(`[CursorProvider] All retries failed to extract CodeChanges`);
          }
        } else {
          logger.warn(`[CursorProvider] Background agent failed: ${result.message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`[CursorProvider] Background agent error: ${errorMessage}`);
        // Fall through to fallback
      }
    }

    // 3. Fallback to file-based if background agent failed or disabled
    if (fallbackToFileBased) {
      logger.info(`[CursorProvider] Falling back to file-based method`);
      return this.fallbackToFileBased(prompt, context, model);
    }

    // 4. If all methods failed, throw error
    throw new Error('Failed to generate code via Cursor AI: Background agent failed and fallback disabled');
  }

  /**
   * Get agent name from context
   */
  private getAgentName(context: TaskContext): string {
    const prdId = context.prdId || 'default';
    const phaseId = context.phaseId || null;
    const prdSetId = context.prdSetId || null;

    const agentNameParts = ['DevLoop'];
    if (prdSetId) agentNameParts.push(`Set-${prdSetId}`);
    if (prdId && prdId !== 'default') agentNameParts.push(`PRD-${prdId}`);
    if (phaseId) agentNameParts.push(`Phase-${phaseId}`);
    agentNameParts.push(`Task-${context.task.id}`);
    return agentNameParts.join('-');
  }

  /**
   * Build full prompt with context
   */
  private buildFullPrompt(prompt: string, context: TaskContext): string {
    const lines: string[] = [];

    lines.push(`Task: ${context.task.title}`);
    lines.push(`Description: ${context.task.description}`);
    lines.push('');

    if (context.codebaseContext) {
      lines.push('Codebase Context:');
      lines.push(context.codebaseContext);
      lines.push('');
    }

    lines.push('Instructions:');
    lines.push(prompt);
    lines.push('');
    lines.push('CRITICAL: You must generate code changes and return them as JSON. Use this exact format:');
    lines.push('```json');
    lines.push(JSON.stringify({
      files: [
        {
          path: 'relative/path/to/file',
          content: 'complete file content',
          operation: 'create' // or 'update', 'delete', 'patch'
        }
      ],
      summary: 'brief summary of changes'
    }, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('IMPORTANT: Return ONLY the JSON code block above. Do not ask questions - generate the code changes now.');

    return lines.join('\n');
  }

  /**
   * Build a strict JSON-only prompt for retry attempts
   * Uses minimal context to increase chance of JSON-only response
   */
  private buildStrictJsonPrompt(context: TaskContext): string {
    const lines: string[] = [];

    lines.push('RESPOND WITH JSON ONLY. NO EXPLANATIONS.');
    lines.push('');
    lines.push(`Task: ${context.task.title}`);
    lines.push(`Description: ${context.task.description}`);
    lines.push('');
    lines.push('Generate the code changes. Return ONLY this JSON structure:');
    lines.push('');
    lines.push('```json');
    lines.push('{');
    lines.push('  "files": [');
    lines.push('    {');
    lines.push('      "path": "path/to/file.ext",');
    lines.push('      "content": "complete file content here",');
    lines.push('      "operation": "create"');
    lines.push('    }');
    lines.push('  ],');
    lines.push('  "summary": "what was changed"');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('If no changes are needed, return: {"files": [], "summary": "No changes required"}');
    lines.push('');
    lines.push('START YOUR RESPONSE WITH ```json');

    return lines.join('\n');
  }

  /**
   * Create observability chat (visible agent for monitoring)
   * This runs in parallel and doesn't block execution
   */
  private async createObservabilityChat(
    context: TaskContext,
    prompt: string,
    agentName: string
  ): Promise<void> {
    const agentsConfig = (this.config as any).cursor?.agents || {};
    const observabilityStrategy = agentsConfig.observabilityStrategy || 'agent';
    const prdId = context.prdId || 'default';
    const phaseId = context.phaseId || null;
    const prdSetId = context.prdSetId || null;

    try {
      // Generate agent config for observability (visible agent, not background)
      await generateAgentConfig({
        name: agentName,
        question: `${context.task.title}\n\n${context.task.description}\n\n${prompt}`,
        model: 'Auto',
        mode: 'Ask',
        purpose: 'Code generation for dev-loop tasks (observability)',
        type: 'code-generation',
        metadata: {
          prdId,
          phaseId,
          prdSetId,
          taskId: context.task.id,
        },
      });

      // Create chat request (will open visible agent, not background)
      await createChatRequest({
        agentName,
        question: prompt,
        model: 'Auto',
        mode: 'Ask',
        context: {
          prdId,
          phaseId,
          prdSetId,
          taskId: context.task.id,
          taskTitle: context.task.title,
        },
      });

      logger.info(`[CursorProvider] Created observability chat: ${agentName}`);
    } catch (error) {
      logger.warn(`[CursorProvider] Failed to create observability chat: ${error}`);
      throw error;
    }
  }

  /**
   * Extract CodeChanges from background agent response
   * Uses shared parser utility for consistent parsing logic
   */
  private extractCodeChangesFromResponse(response: any, taskContext: TaskContext): CodeChanges | null {
    const parsingContext: JsonParsingContext = {
      providerName: 'cursor',
      taskId: taskContext.task.id,
      prdId: taskContext.prdId,
      phaseId: taskContext.phaseId ?? undefined,
      projectType: (this.config as any).projectType,
    };
    return extractCodeChanges(response, this.observationTracker, parsingContext);
  }

  /**
   * Parse code changes from text response
   * Uses shared parser utility for consistent parsing logic
   */
  private parseCodeChangesFromTextResponse(text: string): CodeChanges | null {
    return parseCodeChangesFromText(text);
  }

  /**
   * Fallback to file-based method (existing implementation)
   */
  private async fallbackToFileBased(
    prompt: string,
    context: TaskContext,
    model: string
  ): Promise<CodeChanges> {
    logger.info(`[CursorProvider] Using file-based fallback method`);
    logger.info(`[CursorProvider] Task: ${context.task.title}`);
    logger.info(`[CursorProvider] Model: ${model}`);
    logger.info(`[CursorProvider] Waiting for Cursor agent to process via MCP tool...`);

    try {
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
      logger.error(`[CursorProvider] File-based method failed: ${errorMessage}`);
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

