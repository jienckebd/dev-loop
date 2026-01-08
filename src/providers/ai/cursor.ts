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

/**
 * Custom error class for JSON parsing failures that should halt execution
 * This error indicates that the AI response could not be parsed and the
 * system should stop attempting workarounds.
 */
export class JsonParsingHaltError extends Error {
  public readonly taskId: string;
  public readonly taskTitle: string;
  public readonly retryCount: number;
  public readonly responseSample: string;
  public readonly debugInfo: Record<string, any>;

  constructor(
    message: string,
    taskId: string,
    taskTitle: string,
    retryCount: number,
    responseSample: string,
    debugInfo: Record<string, any> = {}
  ) {
    super(message);
    this.name = 'JsonParsingHaltError';
    this.taskId = taskId;
    this.taskTitle = taskTitle;
    this.retryCount = retryCount;
    this.responseSample = responseSample;
    this.debugInfo = debugInfo;
  }
}

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
            // HALT: JSON parsing failed after all retries
            const haltError = this.createJsonParsingHaltError(context, maxRetries, result.response);
            logger.error(haltError.message);
            throw haltError;
          }
        } else {
          logger.warn(`[CursorProvider] Background agent failed: ${result.message}`);
        }
      } catch (error) {
        // Check if this is already a halt error (re-throw without modification)
        if (error instanceof JsonParsingHaltError) {
          throw error;
        }
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

    // 4. HALT: All methods failed - throw actionable error
    throw this.createFinalHaltError(context, useBackgroundAgent, fallbackToFileBased);
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
    lines.push('## CRITICAL: Response Format Requirements (STRICT)');
    lines.push('');
    lines.push('**YOU MUST RETURN ONLY VALID JSON. NO NARRATIVE TEXT, NO EXPLANATIONS, NO MARKDOWN OUTSIDE THE JSON BLOCK.**');
    lines.push('');
    lines.push('Your ENTIRE response must be exactly this format:');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify({
      files: [
        {
          path: 'relative/path/to/file',
          content: 'complete file content',
          operation: 'create'
        }
      ],
      summary: 'brief summary of changes'
    }, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('### FORBIDDEN:');
    lines.push('- ❌ Starting with "Here are the code changes..." or any narrative');
    lines.push('- ❌ Adding explanations before or after the JSON');
    lines.push('- ❌ Asking questions - generate the code NOW');
    lines.push('- ❌ Using multiple code blocks - use exactly ONE ```json block');
    lines.push('- ❌ Adding comments like "// operation type" inside JSON values');
    lines.push('');
    lines.push('### REQUIRED:');
    lines.push('- ✅ Start IMMEDIATELY with ```json');
    lines.push('- ✅ Valid JSON structure with "files" array and "summary" string');
    lines.push('- ✅ Each file has "path", "content", and "operation" fields');
    lines.push('- ✅ End with ``` and nothing else');
    lines.push('');
    lines.push('If no changes needed, return: ```json\n{"files": [], "summary": "No changes required"}\n```');

    return lines.join('\n');
  }

  /**
   * Build a strict JSON-only prompt for retry attempts
   * Uses minimal context and extremely strict format enforcement
   */
  private buildStrictJsonPrompt(context: TaskContext): string {
    const lines: string[] = [];

    lines.push('# STRICT JSON-ONLY MODE');
    lines.push('');
    lines.push('**YOUR PREVIOUS RESPONSE FAILED BECAUSE IT CONTAINED NARRATIVE TEXT.**');
    lines.push('');
    lines.push('DO NOT WRITE ANY TEXT. DO NOT EXPLAIN. DO NOT ASK QUESTIONS.');
    lines.push('');
    lines.push(`Task: ${context.task.title}`);
    lines.push(`Description: ${context.task.description}`);
    lines.push('');
    lines.push('# OUTPUT FORMAT (EXACT)');
    lines.push('');
    lines.push('Your response must be EXACTLY this - nothing before, nothing after:');
    lines.push('');
    lines.push('```json');
    lines.push('{');
    lines.push('  "files": [');
    lines.push('    {');
    lines.push('      "path": "exact/path/to/file.ext",');
    lines.push('      "content": "complete file content",');
    lines.push('      "operation": "create"');
    lines.push('    }');
    lines.push('  ],');
    lines.push('  "summary": "description"');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('## RULES (VIOLATION = FAILURE):');
    lines.push('1. First 7 characters of your response MUST be: ```json');
    lines.push('2. Last 3 characters MUST be: ```');
    lines.push('3. NO text before ```json');
    lines.push('4. NO text after closing ```');
    lines.push('5. Valid JSON only between the markers');
    lines.push('');
    lines.push('GENERATE THE CODE NOW. RESPOND WITH ```json FIRST CHARACTER.');

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

  /**
   * Create a halt error for JSON parsing failures
   * Provides actionable debugging information
   */
  private createJsonParsingHaltError(
    context: TaskContext,
    retryCount: number,
    response: any
  ): JsonParsingHaltError {
    const responseSample = typeof response === 'string'
      ? response.substring(0, 1000)
      : JSON.stringify(response).substring(0, 1000);

    const debugInfo: Record<string, any> = {
      responseType: typeof response,
      responseKeys: typeof response === 'object' && response !== null
        ? Object.keys(response)
        : [],
      hasText: !!response?.text,
      hasResult: !!response?.result,
      hasFiles: !!response?.files,
      prdId: context.prdId,
      phaseId: context.phaseId,
    };

    const message = [
      `JSON PARSING HALT: Failed to extract CodeChanges after ${retryCount} retries.`,
      '',
      '=== ROOT CAUSE ===',
      'The AI agent returned narrative text instead of the required JSON format.',
      'Dev-loop has halted to prevent further attempts and wasted API calls.',
      '',
      '=== TASK INFO ===',
      `Task ID: ${context.task.id}`,
      `Task Title: ${context.task.title}`,
      `PRD: ${context.prdId || 'default'}`,
      `Phase: ${context.phaseId || 'none'}`,
      '',
      '=== DEBUG INFO ===',
      `Response type: ${debugInfo.responseType}`,
      `Response keys: ${debugInfo.responseKeys.join(', ') || 'N/A'}`,
      '',
      '=== RESPONSE SAMPLE (first 500 chars) ===',
      responseSample.substring(0, 500),
      '',
      '=== HOW TO FIX ===',
      '1. Check .devloop/observations.json for JSON parsing failure patterns',
      '2. Review the prompt templates in src/providers/ai/cursor.ts',
      '3. Verify the AI model is respecting JSON format instructions',
      '4. Consider using a different model or adjusting prompts',
      '',
      '=== FILES TO EXAMINE ===',
      '- node_modules/dev-loop/src/providers/ai/cursor.ts (prompts)',
      '- node_modules/dev-loop/src/providers/ai/json-parser.ts (parsing)',
      '- .devloop/observations.json (failure tracking)',
    ].join('\n');

    return new JsonParsingHaltError(
      message,
      context.task.id,
      context.task.title,
      retryCount,
      responseSample,
      debugInfo
    );
  }

  /**
   * Create a final halt error when all methods failed
   */
  private createFinalHaltError(
    context: TaskContext,
    useBackgroundAgent: boolean,
    fallbackToFileBased: boolean
  ): Error {
    const message = [
      'CODE GENERATION HALT: All methods failed to generate code.',
      '',
      '=== CONFIGURATION ===',
      `Background Agent Enabled: ${useBackgroundAgent}`,
      `Fallback to File-Based Enabled: ${fallbackToFileBased}`,
      '',
      '=== TASK INFO ===',
      `Task ID: ${context.task.id}`,
      `Task Title: ${context.task.title}`,
      '',
      '=== TROUBLESHOOTING ===',
      '1. Verify Cursor CLI is installed and accessible',
      '2. Check if cursor agent --print command works manually',
      '3. Verify network connectivity to AI services',
      '4. Check dev-loop logs for specific error messages',
      '',
      '=== CONFIGURATION OPTIONS ===',
      'In devloop.config.js, set:',
      '  cursor.agents.useBackgroundAgent: true',
      '  cursor.agents.fallbackToFileBased: true (for backup)',
    ].join('\n');

    return new Error(message);
  }

}

