import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { AIProvider, AIProviderConfig } from './interface';
import { CodeChanges, TaskContext, LogAnalysis } from '../../types';

export class AnthropicProvider implements AIProvider {
  public name = 'anthropic';
  private client: Anthropic;
  private cursorRules: string | null = null;

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
    // Extract the most critical rules for Drupal development
    // This is a condensed version to stay within token limits
    return `
PROJECT RULES (from .cursorrules):

CRITICAL - DO NOT VIOLATE:
1. NEVER create custom PHP entity classes - use bd.entity_type.*.yml config files instead
2. NEVER build custom Form API forms - use config_schema_subform with schema definitions
3. NEVER modify Drupal core or contrib - all changes in docroot/modules/share/
4. All plugins MUST extend Drupal\\bd\\Plugin\\EntityPluginBase
5. Define plugin config in bd.schema.yml as: plugin.plugin_configuration.{plugin_type}.{plugin_id}

MODULE RESPONSIBILITIES:
- bd/ = Core framework: entity types, plugins, schema, services
- design_system/ = UI/UX: layout builder, display config, theming
- entity_form_wizard/ = Multi-step form workflows
- openapi_entity/ = OpenAPI schema to entity generation
- spapp/ = AJAX navigation, SPA features

COMMANDS (via DDEV):
- Cache clear: ddev exec bash -c "drush cr"
- All drush: ddev exec bash -c "drush <command>"

BEFORE WRITING CODE:
- Search for existing implementations first
- Check bd.schema.yml for existing schema types
- Extend existing base classes, don't duplicate
- Prefer configuration over PHP code
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
        const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1];
        } else {
          // Fallback to raw JSON extraction
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonText = jsonMatch[0];
          }
        }

        if (jsonText) {
          try {
            const parsed = JSON.parse(jsonText);
            return parsed as CodeChanges;
          } catch (parseError) {
            console.warn('[Anthropic] JSON parse failed, using fallback:', parseError instanceof Error ? parseError.message : String(parseError));

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
      throw new Error(`Anthropic API error: ${error instanceof Error ? error.message : String(error)}`);
    }
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
}
