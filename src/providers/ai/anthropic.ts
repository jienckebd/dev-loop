import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { AIProvider, AIProviderConfig } from './interface';
import { CodeChanges, TaskContext, LogAnalysis, FrameworkConfig } from '../../types';
import { logger } from "../../core/utils/logger";
import { JsonParsingContext } from './json-parser';
import { CodeChangesValidator } from './code-changes-validator';
import { GenericSessionManager, GenericSession } from './generic-session-manager';
import { Session, SessionContext } from './session-manager';

export class AnthropicProvider implements AIProvider {
  public name = 'anthropic';
  private client: Anthropic;
  private cursorRules: string | null = null;
  private frameworkConfig: FrameworkConfig | null = null;
  private maxRetries = 3;
  private baseDelay = 60000; // 60 seconds base delay for rate limits
  private debug = false;
  private lastTokens: { input?: number; output?: number } = {};
  private sessionManager: GenericSessionManager | null = null;

  // Model pricing per 1M tokens (input, output)
  private static readonly PRICING: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
    'claude-3-5-sonnet-latest': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku-latest': { input: 0.8, output: 4.0 },
    'claude-3-opus-latest': { input: 15.0, output: 75.0 },
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  };

  constructor(private config: AIProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.debug = (config as any).debug || process.env.DEBUG === 'true';

    // Load cursor rules if path is provided
    if (config.cursorRulesPath) {
      this.loadCursorRules(config.cursorRulesPath);
    }

    // Load framework config if provided
    if (config.frameworkConfig) {
      this.frameworkConfig = config.frameworkConfig;
      console.log('[Anthropic] Using framework config:', this.frameworkConfig.type || 'generic');
    }

    // Initialize session manager if enabled
    const sessionConfig = (config as any).sessionManagement;
    if (sessionConfig?.enabled !== false) {
      this.sessionManager = new GenericSessionManager({
        providerName: 'anthropic',
        maxSessionAge: sessionConfig?.maxSessionAge,
        maxHistoryItems: sessionConfig?.maxHistoryItems,
        enabled: sessionConfig?.enabled,
      });
      logger.debug('[AnthropicProvider] Session management initialized');
    }
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
   * Get last token usage from the most recent API call
   */
  public getLastTokens(): { input?: number; output?: number } {
    return { ...this.lastTokens };
  }

  /**
   * Calculate cost in USD for token usage (provider-native pricing)
   */
  calculateCost(tokens: { input?: number; output?: number }): number {
    const pricing = AnthropicProvider.PRICING[this.config.model] || { input: 10.0, output: 10.0 };
    const inputCost = ((tokens.input || 0) / 1_000_000) * pricing.input;
    const outputCost = ((tokens.output || 0) / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: Error): boolean {
    return error.message.includes('429') || error.message.includes('rate_limit');
  }

  private loadCursorRules(rulesPath: string): void {
    try {
      const fullPath = path.resolve(process.cwd(), rulesPath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        // Extract key rules for injection (condensed version)
        this.cursorRules = this.extractKeyRules(content);
        console.log('[Anthropic] Loaded cursor rules from:', rulesPath);
      }
    } catch (error) {
      console.warn('[Anthropic] Failed to load cursor rules:', error instanceof Error ? error.message : String(error));
    }
  }

  private extractKeyRules(content: string): string {
    // If framework config has rules, use those instead of extracting from cursor rules
    if (this.frameworkConfig?.rules && this.frameworkConfig.rules.length > 0) {
      const numberedRules = this.frameworkConfig.rules
        .map((rule, i) => `${i + 1}. ${rule}`)
        .join('\n');
      return `\nCRITICAL PROJECT RULES:\n${numberedRules}\n`;
    }

    // Default: return a generic message pointing to cursor rules
    // (no hardcoded framework-specific rules)
    return '\n(Project rules loaded from cursor rules file)\n';
  }

  async generateCode(prompt: string, context: TaskContext): Promise<CodeChanges> {
    // Detect if this is a framework-specific task using config patterns
    const isFrameworkTask = this.detectFrameworkTask(prompt, context);

    // Build system prompt with cursor rules for framework tasks
    let systemPrompt: string;

    if (isFrameworkTask && this.frameworkConfig) {
      const rulesSection = this.cursorRules ? `\n${this.cursorRules}\n` : '';
      const frameworkType = this.frameworkConfig.type || 'framework';

      systemPrompt = `You are an expert ${frameworkType} developer. Generate code changes following ${frameworkType} coding standards.
${rulesSection}
CRITICAL RULES:
1. MODIFY EXISTING FILES - Do NOT create new modules/packages. The codebase context shows existing files that need to be modified.
2. When you see "### EXISTING FILE:" in the context, you MUST use that exact file path with operation "update"
3. Never create new config files if they already exist

Return your response as a JSON object with this structure:
{
  "files": [
    {
      "path": "exact/path/from/context/file",
      "content": "// Complete modified file content...",
      "operation": "update"
    }
  ],
  "summary": "Brief summary of changes"
}

IMPORTANT: The "content" field must contain the COMPLETE file content, not just the changed parts.`;
    } else {
      systemPrompt = `You are an expert software developer. Generate code changes based on the task description.
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
    }

    const userPrompt = `Task: ${context.task.title}
Description: ${context.task.description}

${context.codebaseContext ? `Codebase Context:\n${context.codebaseContext}\n` : ''}

${prompt}`;

    // Debug: Log prompts for visibility
    if (this.debug) {
      console.log('\n[DEBUG] ===== AI PROMPT START =====');
      console.log('[DEBUG] System prompt length:', systemPrompt.length, 'chars');
      console.log('[DEBUG] User prompt length:', userPrompt.length, 'chars');
      console.log('[DEBUG] Task:', context.task.title);
      console.log('[DEBUG] Task details:', context.task.details?.substring(0, 200) || 'N/A');
      console.log('[DEBUG] Codebase context length:', context.codebaseContext?.length || 0, 'chars');
      console.log('[DEBUG] Template prompt length:', prompt.length, 'chars');

      // Show first 500 chars of template prompt for debugging
      console.log('[DEBUG] Template prompt preview:');
      console.log(prompt.substring(0, 500) + (prompt.length > 500 ? '...' : ''));
      console.log('[DEBUG] ===== AI PROMPT END =====\n');
    }

    // Use higher token limit for framework-specific tasks
    const maxTokens = isFrameworkTask ? (this.config.maxTokens || 16000) : (this.config.maxTokens || 4000);

    // Log AI request
    logger.logAICall('request', {
      model: this.config.model,
      systemPrompt,
      userPrompt,
    });

    const apiCallStart = Date.now();

    // Retry loop for rate limit errors
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.config.model,
          max_tokens: maxTokens,
          temperature: this.config.temperature || 0.7,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        });

        const apiCallDuration = Date.now() - apiCallStart;
        const content = response.content[0];

        // Store token usage for metrics
        if (response.usage) {
          this.lastTokens = {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
          };
        }

        // Log AI response
        logger.logAICall('response', {
          model: response.model,
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          duration: apiCallDuration,
          response: content.type === 'text' ? content.text : '[non-text content]',
        });

        // Debug: Log response metadata
        if (this.debug) {
          console.log('\n[DEBUG] ===== AI RESPONSE START =====');
          console.log('[DEBUG] Stop reason:', response.stop_reason);
          console.log('[DEBUG] Input tokens:', response.usage?.input_tokens || 'N/A');
          console.log('[DEBUG] Output tokens:', response.usage?.output_tokens || 'N/A');
          console.log('[DEBUG] Model:', response.model);
        }

      if (content.type === 'text') {
        const text = content.text;

        if (this.debug) {
          console.log('[DEBUG] Response text length:', text.length, 'chars');
          console.log('[DEBUG] Response preview (first 500 chars):');
          console.log(text.substring(0, 500) + (text.length > 500 ? '...' : ''));
          console.log('[DEBUG] ===== AI RESPONSE END =====\n');
        }

        // Use unified CodeChangesValidator for consistent extraction
        const parsingContext: JsonParsingContext = {
          providerName: 'anthropic',
          taskId: context.task.id,
          prdId: context.prdId,
          phaseId: context.phaseId ?? undefined,
        };
        
        const validationResult = CodeChangesValidator.validate(text, parsingContext);
        if (validationResult.valid && validationResult.codeChanges) {
          logger.debug(`[Anthropic] Extracted CodeChanges using ${validationResult.method} method`);
          return validationResult.codeChanges;
        }

        // If validation failed, log and use fallback
        logger.warn(`[Anthropic] Failed to extract CodeChanges: ${validationResult.errors?.join(', ') || 'Unknown error'}`);
        
        // Fallback: create a single file with the response for debugging
        const fileExtension = isFrameworkTask ? (this.frameworkConfig?.type === 'drupal' ? 'php' : 'ts') : 'ts';
        const filePath = `generated-code.${fileExtension}`;
        
        // Log diagnostic info to help understand why JSON extraction failed
        if (this.debug) {
          const hasJsonBlock = text.includes('```json') || text.includes('```');
          const hasFilesKey = text.includes('"files"') || text.includes("'files'");
          const hasOpeningBrace = text.includes('{');
          console.warn(`[Anthropic] JSON extraction failed. Diagnostics: hasJsonBlock=${hasJsonBlock}, hasFilesKey=${hasFilesKey}, hasOpeningBrace=${hasOpeningBrace}`);
          console.warn(`[Anthropic] Response preview (first 500 chars): ${text.substring(0, 500)}`);
        }
        
        console.warn('[Anthropic] Using raw response fallback - code will need manual review');
        return {
          files: [
            {
              path: filePath,
              content: text,
              operation: 'create' as const,
            },
          ],
          summary: 'Code generated by Anthropic Claude (raw response - needs manual review)',
        };
      }

        throw new Error('Unexpected response format from Anthropic API');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is a rate limit error
        if (this.isRateLimitError(lastError)) {
          const delay = this.baseDelay * Math.pow(2, attempt); // Exponential backoff
          console.log(`[Anthropic] Rate limited (attempt ${attempt + 1}/${this.maxRetries}), waiting ${delay / 1000}s...`);
          await this.sleep(delay);
          continue; // Retry
        }

        // For non-rate-limit errors, throw immediately
        throw new Error(`Anthropic API error: ${lastError.message}`);
      }
    }

    // All retries exhausted
    throw new Error(`Anthropic API rate limit exceeded after ${this.maxRetries} retries: ${lastError?.message}`);
  }

  /**
   * Generate text without expecting JSON CodeChanges format
   * Used for PRD building (schemas, test plans, etc.) where plain text output is expected
   */
  async generateText(prompt: string, options?: { maxTokens?: number; temperature?: number; systemPrompt?: string; model?: string }): Promise<string> {
    const maxTokens = options?.maxTokens || this.config.maxTokens || 4000;
    const temperature = options?.temperature ?? 0.7;
    const systemPrompt = options?.systemPrompt || 'You are a helpful assistant.';
    const model = options?.model || this.config.model;

    logger.info(`[AnthropicProvider] generateText: Generating text with ${model}`);

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    // Track token usage for metrics
    if (response.usage) {
      this.lastTokens = {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      };
    }

    const textBlock = response.content.find(block => block.type === 'text');
    if (textBlock && 'text' in textBlock) {
      logger.info(`[AnthropicProvider] generateText: Successfully received text response (${textBlock.text.length} chars)`);
      return textBlock.text;
    }
    throw new Error('No text content in Anthropic response');
  }

  async analyzeError(error: string, context: TaskContext): Promise<LogAnalysis> {
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
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 2000,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const text = content.text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]) as LogAnalysis;
        }
      }

      // Fallback
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

  /**
   * Detect if this is a framework-specific task using config patterns
   */
  private detectFrameworkTask(prompt: string, context: TaskContext): boolean {
    if (!this.frameworkConfig?.taskPatterns || this.frameworkConfig.taskPatterns.length === 0) {
      return false;
    }

    const textToSearch = [
      prompt,
      context.codebaseContext || '',
      context.task.title,
      context.task.description,
    ].join(' ');

    // Check if any of the configured patterns match
    for (const pattern of this.frameworkConfig.taskPatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(textToSearch)) {
          return true;
        }
      } catch {
        // If pattern is not valid regex, treat as literal string
        if (textToSearch.includes(pattern)) {
          return true;
        }
      }
    }

    return false;
  }
}
