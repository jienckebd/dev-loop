import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { AIProvider, AIProviderConfig } from './interface';
import { CodeChanges, TaskContext, LogAnalysis } from '../../types';

export class AnthropicProvider implements AIProvider {
  public name = 'anthropic';
  private client: Anthropic;
  private cursorRules: string | null = null;
  private maxRetries = 3;
  private baseDelay = 60000; // 60 seconds base delay for rate limits

  constructor(private config: AIProviderConfig) {
    if (!config.apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.client = new Anthropic({ apiKey: config.apiKey });

    // Load cursor rules if path is provided
    if (config.cursorRulesPath) {
      this.loadCursorRules(config.cursorRulesPath);
    }
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
    // Return ONLY the absolute minimum rules to reduce token usage
    // The full .cursorrules is way too large (200k+ tokens)
    return `
CRITICAL PROJECT RULES:
1. NEVER create custom PHP entity classes - use bd.entity_type.*.yml config
2. NEVER build custom Form API forms - use config_schema_subform  
3. All changes in docroot/modules/share/ only
4. Plugins extend Drupal\\bd\\Plugin\\EntityPluginBase
5. Commands via DDEV: ddev exec bash -c "drush <command>"
`;
  }

  async generateCode(prompt: string, context: TaskContext): Promise<CodeChanges> {
    // Detect if this is a Drupal/PHP task
    const isDrupalTask = context.codebaseContext?.includes('docroot/modules') ||
                         context.codebaseContext?.includes('.php') ||
                         prompt.includes('Drupal') ||
                         prompt.includes('hook_') ||
                         prompt.includes('EntityFormService') ||
                         prompt.includes('WizardStepProcessor');

    // Build system prompt with cursor rules for Drupal tasks
    let systemPrompt: string;

    if (isDrupalTask) {
      const rulesSection = this.cursorRules ? `\n${this.cursorRules}\n` : '';

      systemPrompt = `You are an expert Drupal developer. Generate PHP code changes following Drupal coding standards.
${rulesSection}
CRITICAL RULES:
1. MODIFY EXISTING FILES - Do NOT create new modules. The codebase context shows existing files that need to be modified.
2. When you see "### EXISTING FILE:" in the context, you MUST use that exact file path with operation "update"
3. Never create new .info.yml or .module files if they already exist
4. Use dependency injection via services.yml
5. Follow hook naming: {module}_{hook}()
6. Use \\Drupal::logger('{module}') for logging

Return your response as a JSON object with this structure:
{
  "files": [
    {
      "path": "exact/path/from/context/file.php",
      "content": "<?php\\n\\n// Complete modified file content...",
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

    // Use higher token limit for PHP/Drupal files
    const maxTokens = isDrupalTask ? (this.config.maxTokens || 16000) : (this.config.maxTokens || 4000);

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

        const content = response.content[0];
      if (content.type === 'text') {
        const text = content.text;

        // Try to extract JSON from code block first
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
        
        // Try code block without json marker
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
          const truncatedMatch = text.match(/```json\s*([\s\S]*)$/);
          if (truncatedMatch) {
            const blockContent = truncatedMatch[1].trim();
            if (blockContent.startsWith('{') && blockContent.includes('"files"')) {
              console.warn('[Anthropic] Response appears truncated (no closing ```), attempting to repair JSON');
              jsonText = blockContent;
            }
          }
        }
        
        // Try to find JSON object with "files" key (our expected format)
        if (!jsonText) {
          const filesJsonMatch = text.match(/\{\s*"files"\s*:\s*\[[\s\S]*?\]\s*,\s*"summary"\s*:\s*"[^"]*"\s*\}/);
          if (filesJsonMatch) {
            jsonText = filesJsonMatch[0];
          }
        }
        
        // Fallback to finding any JSON object that contains "files" array
        if (!jsonText) {
          // Look for { followed by optional whitespace and "files"
          const jsonStartMatch = text.match(/\{\s*"files"\s*:/);
          if (jsonStartMatch && jsonStartMatch.index !== undefined) {
            const startIndex = jsonStartMatch.index;
            // Find the matching closing brace
            let depth = 0;
            let endIndex = startIndex;
            for (let i = startIndex; i < text.length; i++) {
              if (text[i] === '{') depth++;
              if (text[i] === '}') depth--;
              if (depth === 0) {
                endIndex = i + 1;
                break;
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
            // Try to repair truncated JSON by closing open structures
            console.warn('[Anthropic] JSON parse failed, attempting repair...', parseError instanceof Error ? parseError.message : String(parseError));
            const repaired = this.repairTruncatedJson(jsonText);
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
        const fileExtension = isDrupalTask ? 'php' : 'ts';
        const filePath = isDrupalTask ? 'generated-code.php' : 'generated-code.ts';
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
   * Attempts to repair truncated JSON by closing open structures
   */
  private repairTruncatedJson(json: string): string | null {
    let repaired = json.trim();
    
    // Count open brackets and braces
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;
    
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
    
    // If we're in a string, try to close it
    if (inString) {
      repaired += '"';
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
      return null;
    }
  }
}
