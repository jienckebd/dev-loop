import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { AIProvider, AIProviderConfig } from './interface';
import { CodeChanges, TaskContext, LogAnalysis, FrameworkConfig } from '../../types';
import { logger } from "../../core/utils/logger";
import { extractCodeChanges, JsonParsingContext } from './json-parser';
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

        // Use shared JSON parser for consistent extraction (primary method)
        const parsingContext: JsonParsingContext = {
          providerName: 'anthropic',
          taskId: context.task.id,
          prdId: context.prdId,
          phaseId: context.phaseId ?? undefined,
        };
        const sharedParserResult = extractCodeChanges(text, undefined, parsingContext);
        if (sharedParserResult) {
          return sharedParserResult;
        }

        // Fallback to Anthropic-specific parsing for complex/truncated cases
        let jsonText: string | null = null;

        // Try code block with json marker - use greedy matching to get the whole JSON
        const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          // Extract just the JSON object from the code block content
          const blockContent = codeBlockMatch[1].trim();
          if (blockContent.startsWith('{')) {
            jsonText = blockContent;
          }
        }

        // Try code block without json marker (but with language hint)
        if (!jsonText) {
          const plainBlockMatch = text.match(/```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)\s*```/);
          if (plainBlockMatch) {
            const blockContent = plainBlockMatch[1].trim();
            // Check if it looks like JSON (starts with { and has "files" key)
            if (blockContent.startsWith('{') && (blockContent.includes('"files"') || blockContent.includes("'files'"))) {
              jsonText = blockContent;
            }
          }
        }

        // Try plain code block (no language marker)
        if (!jsonText) {
          const plainBlockMatch = text.match(/```\s*([\s\S]*?)\s*```/);
          if (plainBlockMatch) {
            const blockContent = plainBlockMatch[1].trim();
            if (blockContent.startsWith('{') && blockContent.includes('"files"')) {
              jsonText = blockContent;
            }
          }
        }

        // Handle truncated code blocks (no closing ```)
        if (!jsonText) {
          // Try with json marker
          const truncatedMatch = text.match(/```json\s*([\s\S]*)$/);
          if (truncatedMatch) {
            const blockContent = truncatedMatch[1].trim();
            if (blockContent.startsWith('{') && blockContent.includes('"files"')) {
              console.warn('[Anthropic] Response appears truncated (no closing ```), attempting to repair JSON');
              jsonText = blockContent;
            }
          }
          
          // Try without marker
          if (!jsonText) {
            const truncatedPlainMatch = text.match(/```\s*([\s\S]*)$/);
            if (truncatedPlainMatch) {
              const blockContent = truncatedPlainMatch[1].trim();
              if (blockContent.startsWith('{') && blockContent.includes('"files"')) {
                console.warn('[Anthropic] Response appears truncated (no closing ```), attempting to repair JSON');
                jsonText = blockContent;
              }
            }
          }
        }

        // Try to find JSON object with "files" key (our expected format) - improved regex
        if (!jsonText) {
          // More flexible matching for "files" array and "summary" field
          // Allow for optional whitespace and flexible structure
          const filesJsonMatch = text.match(/\{\s*"files"\s*:\s*\[[\s\S]*?\]\s*(?:,\s*"summary"\s*:\s*"[^"]*")?\s*\}/);
          if (filesJsonMatch) {
            jsonText = filesJsonMatch[0];
          }
        }
        
        // Try to find JSON that starts with "files" key (alternative structure)
        if (!jsonText) {
          const altFilesMatch = text.match(/\{\s*"files"\s*:\s*\[/);
          if (altFilesMatch && altFilesMatch.index !== undefined) {
            // Find matching closing brace from the start
            const startIdx = altFilesMatch.index;
            let depth = 0;
            let inString = false;
            let escaped = false;
            let endIdx = startIdx;
            
            for (let i = startIdx; i < text.length; i++) {
              const char = text[i];
              if (escaped) {
                escaped = false;
                continue;
              }
              if (char === '\\') {
                escaped = true;
                continue;
              }
              if (char === '"') {
                inString = !inString;
                continue;
              }
              if (!inString) {
                if (char === '{') depth++;
                if (char === '}') {
                  depth--;
                  if (depth === 0) {
                    endIdx = i + 1;
                    break;
                  }
                }
              }
            }
            
            if (endIdx > startIdx) {
              jsonText = text.substring(startIdx, endIdx);
            }
          }
        }

        // Fallback to finding any JSON object that contains "files" array
        if (!jsonText) {
          // Look for { followed by optional whitespace and "files"
          const jsonStartMatch = text.match(/\{\s*"files"\s*:/);
          if (jsonStartMatch && jsonStartMatch.index !== undefined) {
            const startIndex = jsonStartMatch.index;
            // Find the matching closing brace, handling strings properly
            let depth = 0;
            let inString = false;
            let escaped = false;
            let endIndex = startIndex;
            for (let i = startIndex; i < text.length; i++) {
              const char = text[i];
              if (escaped) {
                escaped = false;
                continue;
              }
              if (char === '\\') {
                escaped = true;
                continue;
              }
              if (char === '"') {
                inString = !inString;
                continue;
              }
              if (!inString) {
                if (char === '{') depth++;
                if (char === '}') {
                  depth--;
                  if (depth === 0) {
                    endIndex = i + 1;
                    break;
                  }
                }
              }
            }
            jsonText = text.substring(startIndex, endIndex);
          }
        }

        if (jsonText) {
          try {
            const parsed = JSON.parse(jsonText);
            return parsed as CodeChanges;
          } catch (parseError) {
            // Try to clean common JSON issues before repair
            let cleaned = this.cleanJsonString(jsonText);

            // Try parsing cleaned version
            try {
              const parsed = JSON.parse(cleaned);
              console.log('[Anthropic] Successfully parsed after cleaning');
              return parsed as CodeChanges;
            } catch {
              // Continue to repair attempt
            }

            // Try to repair truncated JSON by closing open structures
            console.warn('[Anthropic] JSON parse failed, attempting repair...', parseError instanceof Error ? parseError.message : String(parseError));
            const repaired = this.repairTruncatedJson(cleaned);
            if (repaired) {
              try {
                const parsed = JSON.parse(repaired);
                console.log('[Anthropic] Successfully repaired truncated JSON');
                return parsed as CodeChanges;
              } catch {
                // Continue to other fallbacks
              }
            }

            console.warn('[Anthropic] JSON repair failed, using extraction fallback');

            // Try to extract file path and content from truncated JSON
            // Look for "path": "..." and "content": "..."
            const pathMatch = jsonText.match(/"path"\s*:\s*"([^"]+)"/);
            const contentMatch = text.match(/"content"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"operation"|"\s*}\s*]\s*}|$)/);

            if (pathMatch && pathMatch[1].endsWith('.php')) {
              // Extract PHP code from the content field
              let phpContent = '';
              if (contentMatch) {
                // Unescape JSON string escapes
                phpContent = contentMatch[1]
                  .replace(/\\n/g, '\n')
                  .replace(/\\t/g, '\t')
                  .replace(/\\"/g, '"')
                  .replace(/\\\\/g, '\\');
              }

              if (phpContent.includes('<?php')) {
                console.log('[Anthropic] Extracted PHP content from truncated JSON for:', pathMatch[1]);
                return {
                  files: [
                    {
                      path: pathMatch[1],
                      content: phpContent,
                      operation: 'update' as const,
                    },
                  ],
                  summary: 'PHP code extracted from truncated JSON response',
                };
              }
            }
          }
        }

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

  /**
   * Clean common JSON syntax issues
   */
  private cleanJsonString(json: string): string {
    let cleaned = json.trim();

    // Remove trailing commas before closing brackets/braces (common JSON error)
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

    // Note: We don't escape newlines/tabs here because they might be in string values
    // The JSON parser should handle them correctly if the JSON is otherwise valid

    return cleaned;
  }

  /**
   * Attempts to repair truncated JSON by closing open structures
   */
  private repairTruncatedJson(json: string): string | null {
    let repaired = json.trim();

    // Count open brackets and braces
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;
    let lastStringStart = -1;

    for (let i = 0; i < repaired.length; i++) {
      const char = repaired[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        if (!inString) {
          lastStringStart = i;
        }
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') openBraces++;
        if (char === '}') openBraces--;
        if (char === '[') openBrackets++;
        if (char === ']') openBrackets--;
      }
    }

    // Handle unterminated strings - close them properly
    if (inString) {
      // Check if we're in the middle of a string value (not a key)
      // Look backwards from lastStringStart to see if it's a key or value
      let isValue = false;
      if (lastStringStart > 0) {
        const beforeString = repaired.substring(0, lastStringStart).trim();
        // If we see "key": before the string, it's a value
        if (beforeString.endsWith(':') || beforeString.match(/:\s*$/)) {
          isValue = true;
        }
      }
      
      // Close the string
      repaired += '"';
      
      // If it was a value and we're in an object, add comma if needed
      if (isValue && openBraces > 0) {
        // Check if there's already content after (shouldn't be, but be safe)
        const afterPos = repaired.length;
        // Add comma only if we're not at the end of object
        if (openBraces > 0) {
          // Actually, don't add comma - let the brace closing handle it
        }
      }
    }

    // Close open brackets and braces
    while (openBrackets > 0) {
      repaired += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      repaired += '}';
      openBraces--;
    }

    // Try to parse the repaired JSON
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // If repair failed, try one more time with more aggressive fixes
      return this.aggressiveJsonRepair(repaired);
    }
  }

  /**
   * More aggressive JSON repair for difficult cases
   */
  private aggressiveJsonRepair(json: string): string | null {
    let repaired = json.trim();
    
    // Remove trailing commas before closing brackets/braces (common error)
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
    
    // Try to fix unterminated strings by finding the last quote and closing properly
    const lastQuoteIndex = repaired.lastIndexOf('"');
    if (lastQuoteIndex >= 0) {
      const afterLastQuote = repaired.substring(lastQuoteIndex + 1);
      // If there's content after last quote but no closing quote, add one
      if (afterLastQuote.trim().length > 0 && !afterLastQuote.includes('"')) {
        // Find where the string should end (before next : or , or })
        const nextSpecial = afterLastQuote.search(/[,\}:]/);
        if (nextSpecial > 0) {
          // Insert closing quote before the special character
          const insertPos = lastQuoteIndex + 1 + nextSpecial;
          repaired = repaired.substring(0, insertPos) + '"' + repaired.substring(insertPos);
        } else {
          // Just close it at the end
          repaired += '"';
        }
      }
    }
    
    // Try parsing again
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      return null;
    }
  }
}
