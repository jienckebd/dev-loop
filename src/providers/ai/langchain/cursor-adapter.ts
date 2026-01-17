/**
 * Cursor CLI Adapter for LangChain
 *
 * Wraps the existing CursorProvider as a LangChain BaseChatModel.
 * Handles the 8192-byte truncation issue by detecting truncated responses
 * and falling back to Anthropic API when necessary.
 */

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseMessage, AIMessage } from '@langchain/core/messages';
import { ChatResult, ChatGeneration } from '@langchain/core/outputs';
import { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { CursorProvider } from '../cursor';
import { AIProviderConfig } from '../interface';
import { logger } from '../../../core/utils/logger';

export interface CursorCLIAdapterConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  cursorRulesPath?: string;
  frameworkConfig?: any;
  sessionManagement?: any;
  debug?: boolean;
}

/**
 * LangChain adapter for Cursor CLI
 *
 * This adapter allows using Cursor's AI capabilities through LangChain's
 * unified interface. It handles:
 * - Cursor CLI invocation via CursorProvider
 * - Detection of 8192-byte truncation
 * - Automatic fallback to Anthropic API on truncation
 */
export class CursorCLIAdapter extends BaseChatModel {
  private cursorProvider: CursorProvider;
  private anthropicFallback: ChatAnthropic | null = null;
  private config: CursorCLIAdapterConfig;
  private truncationThreshold = 8190;

  static lc_name(): string {
    return 'CursorCLIAdapter';
  }

  constructor(config: CursorCLIAdapterConfig) {
    super({});
    this.config = config;

    // Initialize Cursor provider
    const providerConfig: AIProviderConfig = {
      apiKey: config.apiKey || '',
      model: config.model || 'auto',
      maxTokens: config.maxTokens || 32000,
      temperature: config.temperature || 0.7,
      cursorRulesPath: config.cursorRulesPath,
      frameworkConfig: config.frameworkConfig,
      sessionManagement: config.sessionManagement,
    };

    this.cursorProvider = new CursorProvider(providerConfig);

    // Initialize Anthropic fallback if API key is available
    const anthropicKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      this.anthropicFallback = new ChatAnthropic({
        anthropicApiKey: anthropicKey,
        model: 'claude-sonnet-4-20250514',
        maxTokens: config.maxTokens || 4096,
        temperature: config.temperature || 0.7,
      });
    }
  }

  _llmType(): string {
    return 'cursor-cli';
  }

  /**
   * Main generation method for LangChain compatibility
   */
  async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    // Convert LangChain messages to a prompt string
    const prompt = this.messagesToPrompt(messages);

    try {
      // Try Cursor CLI first
      const result = await this.invokeCursor(prompt);

      // Check for truncation
      if (this.isLikelyTruncated(result)) {
        logger.warn('[CursorCLIAdapter] Detected truncated response, falling back to Anthropic API');

        if (this.anthropicFallback) {
          // Use invoke instead of _generate for public API
          const fallbackResult = await this.anthropicFallback.invoke(messages);
          return this.formatResult(
            typeof fallbackResult.content === 'string'
              ? fallbackResult.content
              : JSON.stringify(fallbackResult.content)
          );
        } else {
          logger.warn('[CursorCLIAdapter] No Anthropic fallback available, returning truncated result');
        }
      }

      return this.formatResult(result);
    } catch (error) {
      logger.error(`[CursorCLIAdapter] Cursor CLI failed: ${error}`);

      // Fallback to Anthropic on error
      if (this.anthropicFallback) {
        logger.info('[CursorCLIAdapter] Falling back to Anthropic API due to error');
        const fallbackResult = await this.anthropicFallback.invoke(messages);
        return this.formatResult(
          typeof fallbackResult.content === 'string'
            ? fallbackResult.content
            : JSON.stringify(fallbackResult.content)
        );
      }

      throw error;
    }
  }

  /**
   * Invoke Cursor provider and get response
   */
  private async invokeCursor(prompt: string): Promise<string> {
    // Create a minimal task context for the provider
    const taskContext = {
      task: {
        id: 'langchain-task',
        title: 'LangChain Request',
        description: prompt,
        status: 'in-progress' as const,
        priority: 'high' as const,
      },
      projectFiles: [],
      codebaseContext: '',
    };

    const result = await this.cursorProvider.generateCode(prompt, taskContext);

    // Return the summary if no files, otherwise serialize the result
    if (!result.files || result.files.length === 0) {
      return result.summary || '';
    }

    return JSON.stringify(result);
  }

  /**
   * Detect if a response is likely truncated at the 8192-byte limit
   */
  private isLikelyTruncated(result: string): boolean {
    // Check if response is near the truncation threshold
    if (result.length < this.truncationThreshold) {
      return false;
    }

    // Common indicators of truncation
    const truncationIndicators = [
      // JSON truncation
      !result.endsWith('}') && !result.endsWith(']') && !result.endsWith('"'),
      // Truncated mid-word
      /\w$/.test(result) && result.length >= this.truncationThreshold,
      // Unterminated string
      (result.match(/"/g) || []).length % 2 !== 0,
    ];

    return truncationIndicators.some(indicator => indicator);
  }

  /**
   * Convert LangChain messages to a single prompt string
   */
  private messagesToPrompt(messages: BaseMessage[]): string {
    return messages.map(msg => {
      const role = msg._getType();
      const content = typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);

      switch (role) {
        case 'system':
          return `System: ${content}`;
        case 'human':
          return `Human: ${content}`;
        case 'ai':
          return `Assistant: ${content}`;
        default:
          return content;
      }
    }).join('\n\n');
  }

  /**
   * Format result as LangChain ChatResult
   */
  private formatResult(content: string): ChatResult {
    const generation: ChatGeneration = {
      text: content,
      message: new AIMessage({ content }),
      generationInfo: {
        provider: 'cursor-cli',
      },
    };

    return {
      generations: [generation],
      llmOutput: {
        provider: 'cursor-cli',
      },
    };
  }

  /**
   * Bind tools to the model (for structured output compatibility)
   */
  bindTools(_tools: any[]): this {
    // Cursor doesn't natively support tool binding, but we can still use
    // withStructuredOutput via the provider's JSON parsing
    return this;
  }
}
