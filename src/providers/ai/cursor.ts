/**
 * Cursor AI Provider
 *
 * Uses direct MCP tool invocation to access Cursor's AI capabilities.
 * The MCP tool is called by Cursor agents, which have access to Cursor AI.
 */

import { AIProvider, AIProviderConfig } from './interface';
import { CodeChanges, TaskContext, LogAnalysis, Task, TaskType } from '../../types';
import { logger } from "../../core/utils/logger";
import { executeCursorGenerateCode } from '../../mcp/tools/cursor-ai';
import { generateAgentConfig } from './cursor-agent-generator';
import { createChatRequest } from './cursor-chat-requests';
import { CursorChatOpener } from './cursor-chat-opener';
import { extractCodeChanges, parseCodeChangesFromText, JsonParsingContext, extractCodeChangesWithAiFallback, shouldUseAiFallback } from './json-parser';
import { ObservationTracker } from "../../core/tracking/observation-tracker";
import * as path from 'path';
import * as fs from 'fs-extra';

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
          const taskType = context.task.taskType || this.inferTaskTypeFromTask(context.task);
          const isAnalysisTask = taskType === 'analysis' || taskType === 'investigate';
          
          if (codeChanges) {
            // For analysis tasks, empty files array is valid - return immediately
            if (isAnalysisTask && codeChanges.files.length === 0) {
              logger.info(`[CursorProvider] Analysis task completed successfully with summary: ${codeChanges.summary?.substring(0, 100) || 'no summary'}`);
              return codeChanges;
            }
            
            // For code generation tasks, empty files array might mean "already exists"
            if (!isAnalysisTask && codeChanges.files.length === 0) {
              // Check if summary indicates files already exist
              const summary = (codeChanges.summary || '').toLowerCase();
              const indicatesAlreadyExists = summary.includes('already exists') || 
                                            summary.includes('already complete') ||
                                            summary.includes('meets all requirements') ||
                                            summary.includes('no changes needed') ||
                                            summary.includes('no changes required');
              
              if (indicatesAlreadyExists) {
                // Verify target files actually exist before accepting
                const targetFiles = await this.verifyTargetFilesExist(context, codeChanges.summary);
                if (targetFiles.allExist) {
                  logger.info(`[CursorProvider] Code generation task: files already exist (verified). Summary: ${codeChanges.summary?.substring(0, 100) || 'no summary'}`);
                  return codeChanges;
                } else {
                  logger.warn(`[CursorProvider] AI said files exist but verification failed. Missing: ${targetFiles.missing.join(', ')}. Will retry.`);
                  // Fall through to retry logic
                }
              } else {
                logger.warn(`[CursorProvider] Code generation task returned empty files array, will retry`);
                // Fall through to retry logic below
              }
            } else {
              // Task has files - success
              logger.info(`[CursorProvider] Successfully received code changes from background agent: ${codeChanges.files.length} files`);
              return codeChanges;
            }
          }
          
          // For analysis tasks with no codeChanges (null), return empty result as success
          if (!codeChanges && isAnalysisTask) {
            logger.info(`[CursorProvider] Analysis task completed with no code changes extracted (valid for analysis tasks)`);
            return { files: [], summary: 'Analysis completed with no code changes extracted' };
          }
          
          // Retry logic: only retry if codeChanges is null (and not analysis task) OR if it's a code generation task with empty files
          if (!codeChanges || (!isAnalysisTask && codeChanges && codeChanges.files.length === 0)) {
            logger.warn(`[CursorProvider] ${codeChanges ? 'Code generation task returned empty files' : 'Background agent succeeded but no CodeChanges extracted'}, will retry`);
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
                  // Check task type again for retry response
                  const retryTaskType = context.task.taskType || this.inferTaskTypeFromTask(context.task);
                  const retryIsAnalysisTask = retryTaskType === 'analysis' || retryTaskType === 'investigate';
                  
                  // For analysis tasks, empty files is valid
                  if (retryIsAnalysisTask && retryChanges.files.length === 0) {
                    logger.info(`[CursorProvider] Retry ${retryAttempt} succeeded for analysis task with summary`);
                    return retryChanges;
                  }
                  
                  // For code generation tasks, only return if files exist
                  if (!retryIsAnalysisTask && retryChanges.files.length > 0) {
                    logger.info(`[CursorProvider] Retry ${retryAttempt} succeeded: ${retryChanges.files.length} files`);
                    return retryChanges;
                  }
                }
              }
            }

            // AI Fallback: Use AI to extract from the original response (only for code generation tasks)
            if (!isAnalysisTask && shouldUseAiFallback(result.response)) {
              logger.info(`[CursorProvider] Attempting AI-assisted extraction fallback`);
              try {
                const aiFallbackChanges = await extractCodeChangesWithAiFallback(
                  result.response,
                  async (prompt: string) => {
                    // Use a simpler agent call for extraction
                    const extractRequest = {
                      id: `ai-extract-${chatRequest.id}`,
                      agentName: chatRequest.agentName,
                      question: prompt,
                      model: 'claude-3-5-sonnet', // Use a capable model for extraction
                      mode: 'Ask' as const,
                      status: 'pending' as const,
                      createdAt: new Date().toISOString(),
                    };
                    const extractResult = await chatOpener.openChat(extractRequest);
                    if (extractResult.success && extractResult.response) {
                      return typeof extractResult.response === 'string'
                        ? extractResult.response
                        : JSON.stringify(extractResult.response);
                    }
                    return '';
                  },
                  { providerName: 'cursor', taskId: context.task.id }
                );

                // For analysis tasks, accept empty files; for code generation, require files
                if (aiFallbackChanges) {
                  if (isAnalysisTask && aiFallbackChanges.files.length === 0) {
                    logger.info(`[CursorProvider] AI fallback succeeded for analysis task with summary`);
                    return aiFallbackChanges;
                  } else if (!isAnalysisTask && aiFallbackChanges.files.length > 0) {
                    logger.info(`[CursorProvider] AI fallback succeeded: ${aiFallbackChanges.files.length} files`);
                    return aiFallbackChanges;
                  }
                }
              } catch (fallbackError) {
                logger.warn(`[CursorProvider] AI fallback failed: ${fallbackError}`);
              }
            }

            // HALT: JSON parsing failed after all retries and AI fallback (only for code generation tasks)
            // Analysis tasks with empty files should not reach here
            if (!isAnalysisTask) {
              const haltError = this.createJsonParsingHaltError(context, maxRetries, result.response);
              logger.error(haltError.message);
              throw haltError;
            } else {
              // Analysis task with no codeChanges - return empty result as success
              logger.info(`[CursorProvider] Analysis task completed with no code changes (valid for analysis tasks)`);
              return { files: [], summary: 'Analysis completed with no code changes required' };
            }
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
    lines.push('**YOU MUST RETURN PURE JSON. NO MARKDOWN CODE BLOCKS, NO NARRATIVE TEXT.**');
    lines.push('');
    lines.push('Your ENTIRE response must be exactly this JSON object (NO ```json wrapper, NO markdown):');
    lines.push('');
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
    lines.push('');
    lines.push('### FORBIDDEN:');
    lines.push('- ❌ Markdown code blocks (```json ... ```) - causes parsing failures');
    lines.push('- ❌ Escaped JSON strings or nested JSON');
    lines.push('- ❌ Narrative text before or after JSON');
    lines.push('- ❌ Explanations, questions, or comments');
    lines.push('- ❌ Multiple JSON objects - return exactly ONE');
    lines.push('');
    lines.push('### REQUIRED:');
    lines.push('- ✅ Pure JSON object starting with { character');
    lines.push('- ✅ Valid structure with "files" array and "summary" string');
    lines.push('- ✅ Each file has "path", "content", and "operation" fields');
    lines.push('- ✅ End with } character and nothing else');
    lines.push('');
    lines.push('If no changes needed, return: {"files": [], "summary": "No changes required"}');

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
    lines.push('**YOUR PREVIOUS RESPONSE FAILED BECAUSE JSON PARSING FAILED.**');
    lines.push('');
    lines.push('DO NOT USE MARKDOWN CODE BLOCKS. DO NOT WRAP IN ```json. PURE JSON ONLY.');
    lines.push('');
    lines.push(`Task: ${context.task.title}`);
    lines.push(`Description: ${context.task.description}`);
    lines.push('');
    lines.push('# OUTPUT FORMAT (EXACT)');
    lines.push('');
    lines.push('Your response must be EXACTLY this pure JSON object - NO markdown, NO wrapping:');
    lines.push('');
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
    lines.push('');
    lines.push('## RULES (VIOLATION = FAILURE):');
    lines.push('1. First character of your response MUST be: {');
    lines.push('2. Last character MUST be: }');
    lines.push('3. NO markdown code blocks (```json causes escaping issues)');
    lines.push('4. NO text before or after the JSON object');
    lines.push('5. Valid JSON that can be parsed with JSON.parse()');
    lines.push('');
    lines.push('GENERATE THE CODE NOW. START WITH { CHARACTER IMMEDIATELY.');

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
   * Infer task type from task title and description
   * Similar to TaskMasterBridge.inferTaskType but implemented here for cursor provider
   */
  private inferTaskTypeFromTask(task: Task): TaskType {
    // Return explicit task type if set
    if (task.taskType) {
      return task.taskType;
    }

    const title = (task.title || '').toLowerCase();
    const description = (task.description || '').toLowerCase();
    const combined = `${title} ${description}`;

    // Investigation/analysis tasks
    if (
      combined.includes('investigate') ||
      combined.includes('investigation') ||
      combined.includes('analyze') ||
      combined.includes('analysis') ||
      combined.includes('why') ||
      combined.includes('root cause') ||
      combined.includes('diagnose') ||
      combined.includes('debug')
    ) {
      // If it's asking to investigate a failure, it's an investigate task
      if (combined.includes('failure') || combined.includes('error') || combined.includes('issue')) {
        return 'investigate';
      }
      // Otherwise it's a general analysis
      return 'analysis';
    }

    // Fix tasks (fixing existing code)
    if (
      title.startsWith('fix') ||
      title.startsWith('fix:') ||
      combined.includes('fix') ||
      combined.includes('resolve') ||
      combined.includes('correct') ||
      combined.includes('repair') ||
      combined.includes('patch')
    ) {
      return 'fix';
    }

    // Generate tasks (creating new code) - default
    return 'generate';
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
   * Verify target files exist when AI says "already exists"
   * Returns object with allExist flag and missing files list
   */
  private async verifyTargetFilesExist(
    context: TaskContext,
    summary?: string
  ): Promise<{ allExist: boolean; missing: string[] }> {
    const taskDetails = (context.task as any).details || '';
    const taskText = `${context.task.title} ${context.task.description} ${taskDetails}`;
    
    // Extract file paths from task text (similar to workflow engine logic)
    const filePathPattern = /(?:Target Files?|file exists at|File exists at|path|Path)[:\s]*`?([^\s`\n]+\.(?:php|yml|yaml|ts|js|json|md|twig|css|scss))`?/gi;
    const matches = [...taskText.matchAll(filePathPattern)];
    const targetFiles: string[] = [];
    
    for (const match of matches) {
      if (match[1]) {
        let filePath = match[1].replace(/`/g, '').trim();
        // Normalize paths
        if (!filePath.startsWith('docroot/') && !filePath.startsWith('config/') && !filePath.startsWith('./')) {
          // Assume it's relative to docroot/modules/share/ if it starts with src/ or similar
          if (filePath.startsWith('src/') || filePath.startsWith('config/')) {
            // Try to infer module name from context
            const moduleMatch = taskText.match(/bd_[\w]+/);
            if (moduleMatch) {
              filePath = `docroot/modules/share/${moduleMatch[0]}/${filePath}`;
            }
          }
        }
        if (filePath && !targetFiles.includes(filePath)) {
          targetFiles.push(filePath);
        }
      }
    }
    
    // Also try extracting from acceptance criteria
    const acceptancePattern = /(?:File exists at|file exists at|exists at)[:\s]*`([^`]+)`/gi;
    const acceptanceMatches = [...taskText.matchAll(acceptancePattern)];
    for (const match of acceptanceMatches) {
      if (match[1]) {
        const filePath = match[1].trim();
        if (filePath && !targetFiles.includes(filePath)) {
          targetFiles.push(filePath);
        }
      }
    }
    
    if (targetFiles.length === 0) {
      // No target files found - can't verify, assume retry needed
      return { allExist: false, missing: ['unknown'] };
    }
    
    // Check if files exist
    const missing: string[] = [];
    for (const filePath of targetFiles) {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!await fs.pathExists(fullPath)) {
        missing.push(filePath);
      }
    }
    
    return {
      allExist: missing.length === 0,
      missing,
    };
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

