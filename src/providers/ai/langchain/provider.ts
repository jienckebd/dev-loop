/**
 * LangChain Provider
 *
 * Unified AI provider implementing the AIProvider interface using LangChain.
 * Replaces the legacy provider-specific implementations with a single,
 * consistent implementation.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AIProvider, TextGenerationOptions, TokenUsage, ResponseMetadata, UnifiedAgentResponse } from '../interface';
import { CodeChanges, TaskContext, LogAnalysis } from '../../../types';
import { Session, SessionContext } from '../session-manager';
import { createLangChainModel, getApiKeyEnvVar, ModelConfig } from './models';
import { CodeChangesSchema, AnalysisSchema } from './schemas';
import { CursorCLIAdapter } from './cursor-adapter';
import { parseCodeChangesFromText } from '../json-parser';
import { logger } from '../../../core/utils/logger';

export interface LangChainProviderConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  cursorRulesPath?: string;
  frameworkConfig?: any;
  sessionManagement?: any;
  debug?: boolean;
}

/**
 * LangChain-based AI provider
 *
 * This provider:
 * - Uses LangChain models for all AI operations
 * - Supports structured output via Zod schemas
 * - Handles Cursor CLI with truncation fallback
 * - Provides consistent interface across all backends
 */
export class LangChainProvider implements AIProvider {
  readonly name: string;
  private model: BaseChatModel;
  private config: LangChainProviderConfig;
  private lastTokenUsage: TokenUsage = {};
  private cursorAdapter: CursorCLIAdapter | null = null;

  constructor(config: LangChainProviderConfig) {
    this.config = config;
    this.name = `langchain-${config.provider}`;

    // Resolve API key from config or environment
    const apiKey = config.apiKey || process.env[getApiKeyEnvVar(config.provider)] || '';

    const modelConfig: ModelConfig = {
      provider: config.provider,
      model: config.model,
      apiKey,
      baseUrl: config.baseUrl,
      maxTokens: config.maxTokens || 4096,
      temperature: config.temperature ?? 0.7,
    };

    // For Cursor, use the special adapter
    if (config.provider === 'cursor') {
      this.cursorAdapter = new CursorCLIAdapter({
        apiKey,
        model: config.model || 'auto',
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        cursorRulesPath: config.cursorRulesPath,
        frameworkConfig: config.frameworkConfig,
        sessionManagement: config.sessionManagement,
        debug: config.debug,
      });
      // Also create a standard model for fallback operations
      this.model = createLangChainModel({ ...modelConfig, provider: 'anthropic' });
    } else {
      this.model = createLangChainModel(modelConfig);
    }

    logger.debug(`[LangChainProvider] Initialized with provider: ${config.provider}, model: ${config.model}`);
  }

  /**
   * Generate code changes from a task context
   */
  async generateCode(prompt: string, context: TaskContext): Promise<CodeChanges> {
    const startTime = Date.now();

    try {
      // Use Cursor adapter if configured
      if (this.config.provider === 'cursor' && this.cursorAdapter) {
        const result = await this.cursorAdapter._generate(
          [new HumanMessage(this.buildCodeGenPrompt(prompt, context))],
          {},
          undefined
        );

        const content = result.generations[0]?.text || '';
        return this.parseCodeChanges(content);
      }

      // Use structured output for other providers
      const structuredModel = this.model.withStructuredOutput(CodeChangesSchema);

      const messages = [
        new SystemMessage(this.getSystemPrompt('code-generation')),
        new HumanMessage(this.buildCodeGenPrompt(prompt, context)),
      ];

      const result = await structuredModel.invoke(messages);

      // Track token usage if available
      this.trackTokenUsage(result);

      logger.debug(`[LangChainProvider] Code generation completed in ${Date.now() - startTime}ms`);

      return result as CodeChanges;
    } catch (error) {
      logger.error(`[LangChainProvider] Code generation failed: ${error}`);

      // Return empty result on error
      return {
        files: [],
        summary: `Error generating code: ${error}`,
      };
    }
  }

  /**
   * Analyze an error and provide recommendations
   */
  async analyzeError(error: string, context: TaskContext): Promise<LogAnalysis> {
    try {
      const structuredModel = this.model.withStructuredOutput(AnalysisSchema);

      const messages = [
        new SystemMessage(this.getSystemPrompt('error-analysis')),
        new HumanMessage(this.buildErrorAnalysisPrompt(error, context)),
      ];

      const result = await structuredModel.invoke(messages);

      return {
        errors: [result.rootCause],
        warnings: [],
        summary: result.suggestedFix,
      };
    } catch (err) {
      logger.error(`[LangChainProvider] Error analysis failed: ${err}`);

      return {
        errors: [error],
        warnings: [],
        summary: 'Failed to analyze error',
      };
    }
  }

  /**
   * Generate text for PRD building and other text generation tasks
   */
  async generateText(prompt: string, options?: TextGenerationOptions): Promise<string> {
    try {
      const messages = [];

      if (options?.systemPrompt) {
        messages.push(new SystemMessage(options.systemPrompt));
      }
      messages.push(new HumanMessage(prompt));

      const result = await this.model.invoke(messages);

      // Extract text content
      const content = typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);

      return content;
    } catch (error) {
      logger.error(`[LangChainProvider] Text generation failed: ${error}`);
      throw error;
    }
  }

  /**
   * Generate code with unified response including metadata
   */
  async generateCodeWithMetrics(
    prompt: string,
    context: TaskContext
  ): Promise<UnifiedAgentResponse> {
    const startTime = Date.now();

    const codeChanges = await this.generateCode(prompt, context);

    const metadata: ResponseMetadata = {
      durationMs: Date.now() - startTime,
      tokens: {
        input: this.lastTokenUsage.input || 0,
        output: this.lastTokenUsage.output || 0,
      },
      model: this.config.model,
      provider: this.config.provider,
    };

    return { codeChanges, metadata };
  }

  /**
   * Get last token usage
   */
  getLastTokens(): TokenUsage {
    return this.lastTokenUsage;
  }

  /**
   * Session management - not supported in this implementation
   * Sessions are handled by the underlying CursorProvider when using Cursor
   */
  getSession(_sessionId: string): Session | null {
    return null;
  }

  getOrCreateSession(_context: SessionContext): Session | null {
    return null;
  }

  supportsSessions(): boolean {
    return this.config.provider === 'cursor';
  }

  /**
   * Calculate cost based on token usage
   */
  calculateCost(tokens: TokenUsage): number {
    // Pricing per 1M tokens (approximate)
    const pricing: Record<string, { input: number; output: number }> = {
      anthropic: { input: 3, output: 15 },
      openai: { input: 2.5, output: 10 },
      gemini: { input: 0.5, output: 1.5 },
      ollama: { input: 0, output: 0 },
      cursor: { input: 0, output: 0 }, // Cursor uses subscription
    };

    const rates = pricing[this.config.provider] || { input: 0, output: 0 };
    const inputCost = ((tokens.input || 0) / 1_000_000) * rates.input;
    const outputCost = ((tokens.output || 0) / 1_000_000) * rates.output;

    return inputCost + outputCost;
  }

  /**
   * Build code generation prompt
   */
  private buildCodeGenPrompt(prompt: string, context: TaskContext): string {
    const parts = [prompt];

    if (context.projectFiles && context.projectFiles.length > 0) {
      parts.push(`\n\n## Project Files\n${context.projectFiles.join('\n')}`);
    }

    if (context.codebaseContext) {
      parts.push(`\n\n## Codebase Context\n${context.codebaseContext}`);
    }

    return parts.join('');
  }

  /**
   * Build error analysis prompt
   */
  private buildErrorAnalysisPrompt(error: string, context: TaskContext): string {
    return `Analyze the following error and provide recommendations:

## Error
${error}

## Task Context
${context.task.title}: ${context.task.description}

## Project Files
${context.projectFiles?.join('\n') || 'None specified'}

Provide:
1. The type of error
2. Root cause analysis
3. Suggested fix
4. Affected files`;
  }

  /**
   * Get system prompt for different operation types
   */
  private getSystemPrompt(operation: 'code-generation' | 'error-analysis'): string {
    switch (operation) {
      case 'code-generation':
        return `You are an expert software engineer. Generate clean, well-documented code that follows best practices.
When generating code changes, always:
1. Include complete file contents, not partial updates
2. Follow the existing code style in the project
3. Add appropriate comments and documentation
4. Handle edge cases and errors appropriately`;

      case 'error-analysis':
        return `You are an expert debugger. Analyze errors carefully and provide actionable recommendations.
Focus on:
1. Identifying the root cause, not just symptoms
2. Providing specific, implementable fixes
3. Considering the broader context of the codebase`;

      default:
        return 'You are a helpful AI assistant.';
    }
  }

  /**
   * Parse code changes from text response
   */
  private parseCodeChanges(content: string): CodeChanges {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(content);
      if (parsed.files && Array.isArray(parsed.files)) {
        return parsed;
      }
    } catch {
      // Not JSON, try text parsing
    }

    // Use existing JSON parser (pass undefined for observationTracker)
    const context = {
      taskId: 'langchain-task',
      taskTitle: 'LangChain Request',
      retryCount: 0,
    };

    const result = parseCodeChangesFromText(content, undefined, context);

    return result || { files: [], summary: content };
  }

  /**
   * Track token usage from model response
   */
  private trackTokenUsage(result: any): void {
    // LangChain models may include token usage in response metadata
    if (result?.llmOutput?.tokenUsage) {
      this.lastTokenUsage = {
        input: result.llmOutput.tokenUsage.promptTokens,
        output: result.llmOutput.tokenUsage.completionTokens,
      };
    }
  }
}
