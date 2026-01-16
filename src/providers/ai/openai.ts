import OpenAI from 'openai';
import { AIProvider, AIProviderConfig } from './interface';
import { CodeChanges, TaskContext, LogAnalysis } from '../../types';
import { JsonParsingContext } from './json-parser';
import { CodeChangesValidator } from './code-changes-validator';
import { GenericSessionManager } from './generic-session-manager';
import { Session, SessionContext } from './session-manager';
import { logger } from '../../core/utils/logger';

export class OpenAIProvider implements AIProvider {
  public name = 'openai';
  private client: OpenAI;
  private lastTokens: { input?: number; output?: number } = {};
  private sessionManager: GenericSessionManager | null = null;

  // Model pricing per 1M tokens (input, output)
  private static readonly PRICING: Record<string, { input: number; output: number }> = {
    'gpt-4o': { input: 5.0, output: 15.0 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4-turbo': { input: 10.0, output: 30.0 },
    'gpt-4': { input: 30.0, output: 60.0 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  };

  constructor(private config: AIProviderConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAI API key is required');
    }
    this.client = new OpenAI({ apiKey: config.apiKey });

    // Initialize session manager if enabled
    const sessionConfig = (config as any).sessionManagement;
    if (sessionConfig?.enabled !== false) {
      this.sessionManager = new GenericSessionManager({
        providerName: 'openai',
        maxSessionAge: sessionConfig?.maxSessionAge,
        maxHistoryItems: sessionConfig?.maxHistoryItems,
        enabled: sessionConfig?.enabled,
      });
      logger.debug('[OpenAIProvider] Session management initialized');
    }
  }

  /**
   * Get last token usage from the most recent API call
   */
  public getLastTokens(): { input?: number; output?: number } {
    return { ...this.lastTokens };
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | null {
    return this.sessionManager?.getSession(sessionId) || null;
  }

  /**
   * Get or create session for a given context
   */
  getOrCreateSession(context: SessionContext): Session | null {
    return this.sessionManager?.getOrCreateSession(context) || null;
  }

  /**
   * Check if provider supports sessions
   */
  supportsSessions(): boolean {
    return this.sessionManager !== null;
  }

  /**
   * Calculate cost in USD for token usage (provider-native pricing)
   */
  calculateCost(tokens: { input?: number; output?: number }): number {
    const pricing = OpenAIProvider.PRICING[this.config.model] || { input: 10.0, output: 10.0 };
    const inputCost = ((tokens.input || 0) / 1_000_000) * pricing.input;
    const outputCost = ((tokens.output || 0) / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  async generateCode(prompt: string, context: TaskContext): Promise<CodeChanges> {
    const systemPrompt = `You are an expert software developer. Generate code changes based on the task description.
Include both feature implementation and test code together. Return your response as a JSON object with this structure:
{
  "files": [
    {
      "path": "relative/path/to/file",
      "content": "file content here",
      "operation": "create" | "update" | "delete"
    }
  ],
  "summary": "Brief summary of changes"
}`;

    const userPrompt = `Task: ${context.task.title}
Description: ${context.task.description}

${context.codebaseContext ? `Codebase Context:\n${context.codebaseContext}\n` : ''}

${prompt}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: this.config.maxTokens || 4000,
        temperature: this.config.temperature || 0.7,
        response_format: { type: 'json_object' },
      });

      // Track token usage
      if (response.usage) {
        this.lastTokens = {
          input: response.usage.prompt_tokens,
          output: response.usage.completion_tokens,
        };
      }

      const content = response.choices[0]?.message?.content;
      if (content) {
        // Use shared JSON parser for consistent extraction
        const parsingContext: JsonParsingContext = {
          providerName: 'openai',
          taskId: context.task.id,
          prdId: context.prdId,
          phaseId: context.phaseId ?? undefined,
        };
        const validationResult = CodeChangesValidator.validate(content, parsingContext);
        if (validationResult.valid && validationResult.codeChanges) {
          return validationResult.codeChanges;
        }
        // Fallback: create a single file
        return {
          files: [
            {
              path: 'generated-code.ts',
              content: content,
              operation: 'create' as const,
            },
          ],
          summary: 'Code generated by OpenAI',
        };
      }

      throw new Error('Empty response from OpenAI API');
    } catch (error) {
      throw new Error(`OpenAI API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate text without expecting JSON CodeChanges format
   * Used for PRD building (schemas, test plans, etc.) where plain text output is expected
   */
  async generateText(prompt: string, options?: { maxTokens?: number; temperature?: number; systemPrompt?: string }): Promise<string> {
    const maxTokens = options?.maxTokens || this.config.maxTokens || 4000;
    const temperature = options?.temperature ?? 0.7;
    const systemPrompt = options?.systemPrompt || 'You are a helpful assistant.';

    const response = await this.client.chat.completions.create({
      model: this.config.model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (content) {
      return content;
    }
    throw new Error('Empty response from OpenAI API');
  }

  async analyzeError(error: string, context: TaskContext): Promise<LogAnalysis> {
    const prompt = `Analyze this error and provide recommendations. Return JSON:

{
  "errors": ["list of errors"],
  "warnings": ["list of warnings"],
  "summary": "brief summary",
  "recommendations": ["actionable recommendations"]
}

Error:
${error}

Task Context:
${context.task.description}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content;
      if (content) {
        try {
          return JSON.parse(content) as LogAnalysis;
        } catch {
          // Fallback
        }
      }

      return {
        errors: [error],
        warnings: [],
        summary: 'Error analysis completed',
        recommendations: ['Review the error message and fix the underlying issue'],
      };
    } catch (error) {
      return {
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        summary: 'Failed to analyze error',
      };
    }
  }
}

