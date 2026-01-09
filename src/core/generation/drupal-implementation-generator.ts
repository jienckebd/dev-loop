import * as fs from 'fs-extra';
import * as path from 'path';
import { AIProvider } from '../../providers/ai/interface';
import { Config } from '../../config/schema/core';
import { PrdContext, Requirement } from '../prd/coordination/context';
import { CodeChanges } from '../../types';
import { logger } from '../utils/logger';

export class DrupalImplementationGenerator {
  constructor(
    private aiProvider: AIProvider,
    private config: Config,
    private debug: boolean = false
  ) {}

  /**
   * Generate Drupal PHP code fixes for a requirement
   */
  async generateFix(req: Requirement, context: PrdContext): Promise<CodeChanges> {
    // Access drupal config from framework.config.drupal (moved from top-level)
    const frameworkConfig = (this.config as any).framework || {};
    const drupalConfig = frameworkConfig.config?.drupal || {};

    if (this.debug) {
      logger.debug(`[DrupalImplementationGenerator] Generating fix for requirement ${req.id}`);
    }

    // Read implementation files
    const fileContents = await this.readImplementationFiles(req.implementationFiles || []);

    if (fileContents.size === 0) {
      throw new Error(`No implementation files found for requirement ${req.id}`);
    }

    // Build Drupal-specific prompt
    const prompt = this.buildPrompt(req, context, fileContents, drupalConfig);

    // Generate via AI
    const response = await this.aiProvider.generateCode(prompt, {
      task: {
        id: `drupal-fix-${req.id}`,
        title: `Generate Drupal fix for ${req.id}`,
        description: req.description,
        status: 'pending',
        priority: req.priority === 'must' ? 'high' : 'medium',
      },
      codebaseContext: this.buildCodebaseContext(context),
    });

    // Parse code changes from response
    const changes = this.parseCodeChanges(response, fileContents);
    changes.summary = response.summary || `Generated fix for requirement ${req.id}`;
    return changes;
  }

  /**
   * Read implementation files from disk
   */
  private async readImplementationFiles(filePaths: string[]): Promise<Map<string, string>> {
    const contents = new Map<string, string>();

    for (const filePath of filePaths) {
      try {
        // Handle paths with method names (e.g., "file.php: methodName()")
        const [cleanPath] = filePath.split(':');
        const fullPath = path.resolve(process.cwd(), cleanPath.trim());

        if (await fs.pathExists(fullPath)) {
          const content = await fs.readFile(fullPath, 'utf-8');
          contents.set(filePath, content);
        } else if (this.debug) {
          logger.warn(`[DrupalImplementationGenerator] File not found: ${fullPath}`);
        }
      } catch (error) {
        if (this.debug) {
          logger.warn(`[DrupalImplementationGenerator] Error reading file ${filePath}:`, error);
        }
      }
    }

    return contents;
  }

  /**
   * Build Drupal-specific prompt for code generation
   */
  private buildPrompt(
    req: Requirement,
    context: PrdContext,
    files: Map<string, string>,
    drupalConfig: any
  ): string {
    const fieldTypeMapping = drupalConfig.fieldTypeMapping || {};
    const namespaces = drupalConfig.namespaces || [];

    const sections: string[] = [
      `## Drupal 11 Implementation Required`,
      ``,
      `**Requirement**: ${req.description}`,
      ``,
      `**Acceptance Criteria**:`,
      ...req.acceptanceCriteria.map(c => `- ${c}`),
      ``,
    ];

    // Add field type mapping reference
    if (Object.keys(fieldTypeMapping).length > 0) {
      sections.push(
        `**Field Type Mapping Reference**:`,
        ...Object.entries(fieldTypeMapping).map(([k, v]) => `- OpenAPI "${k}" → Drupal "${v}"`),
        ``
      );
    }

    // Add namespaces
    if (namespaces.length > 0) {
      sections.push(
        `**Common Namespaces**:`,
        ...namespaces.map((ns: string) => `- ${ns}`),
        ``
      );
    }

    // Add files to modify
    sections.push(`**Files to Modify**:`);
    for (const [filePath, content] of files.entries()) {
      sections.push(
        `### ${filePath}`,
        `\`\`\`php`,
        content,
        `\`\`\``,
        ``
      );
    }

    // Add Drupal coding standards from config
    const codingStandards = drupalConfig.codingStandards || [
      'Use dependency injection via constructors',
      'Follow PSR-4 autoloading',
      'Use strict typing (PHP 8.3)',
      'No direct database queries - use entity API',
      'Use service injection: $this->entityHelper = $entity_helper;',
      'Use third-party settings: $entity->setThirdPartySetting(\'module\', \'key\', $value)',
      'All changes in docroot/modules/share/ only',
    ];

    sections.push(
      `**Drupal Coding Standards**:`,
      ...codingStandards.map((std: string) => `- ${std}`),
      ``
    );

    // Add wizard patterns from config
    const wizardPatterns = drupalConfig.wizardPatterns;
    if (wizardPatterns) {
      sections.push(`**Wizard-Specific Patterns**:`);

      if (wizardPatterns.prePopulationHook) {
        sections.push(`- Pre-population happens in ${wizardPatterns.prePopulationHook}`);
      }
      if (wizardPatterns.entitySaveHook) {
        sections.push(`- Entity save happens in ${wizardPatterns.entitySaveHook}`);
      }
      sections.push(`- Entities created in memory on form load, saved on forward navigation`);

      if (wizardPatterns.thirdPartySettings) {
        sections.push(`- Use third-party settings for OpenAPI metadata:`);
        if (wizardPatterns.thirdPartySettings.field) {
          wizardPatterns.thirdPartySettings.field.forEach((setting: string) => {
            const [module, key] = setting.split('.');
            sections.push(`  - \`$field->setThirdPartySetting('${module}', '${key}', $value)\``);
          });
        }
        if (wizardPatterns.thirdPartySettings.bundle) {
          wizardPatterns.thirdPartySettings.bundle.forEach((setting: string) => {
            const [module, key] = setting.split('.');
            sections.push(`  - \`$bundle->setThirdPartySetting('${module}', '${key}', $value)\``);
          });
        }
      }

      if (wizardPatterns.thirdPartySettings?.field) {
        const propQuery = wizardPatterns.thirdPartySettings.field.find((s: string) => s.includes('property_json_query'));
        if (propQuery) {
          sections.push(`- Field mappings for feeds use: \`$field->getThirdPartySetting('openapi_entity', 'property_json_query')\``);
        }
      }

      sections.push(`- Unique entity ID generation: Check for existing IDs before creating`);

      if (wizardPatterns.idFormats) {
        if (wizardPatterns.idFormats.feedType) {
          const maxLen = wizardPatterns.idFormats.maxLength || 64;
          sections.push(`- Feed type ID format: \`${wizardPatterns.idFormats.feedType}\` (truncated to ${maxLen} chars)`);
        }
        if (wizardPatterns.idFormats.webhook) {
          const maxLen = wizardPatterns.idFormats.maxLength || 64;
          sections.push(`- Webhook ID format: \`${wizardPatterns.idFormats.webhook}\` (truncated to ${maxLen} chars)`);
        }
      }

      sections.push(``);

      if (wizardPatterns.validationPatterns) {
        sections.push(`**Validation Before Pre-Population**:`);
        wizardPatterns.validationPatterns.forEach((pattern: string) => {
          sections.push(`- Always validate: \`${pattern}\``);
        });
        sections.push(`- For Step 8/9: Validate schema.org mappings and fields exist`);
        sections.push(``);
      }

      sections.push(
        `**Entity Save Timing**:`,
        `- Create entities in memory during form load (pre-population)`,
        `- Save entities only when user clicks "Next" (hook_wizard_step_post_save())`,
        `- Never save entities when clicking "Back"`,
        ``
      );

      if (wizardPatterns.thirdPartySettings) {
        sections.push(`**Third-Party Settings Reference**:`);
        if (wizardPatterns.thirdPartySettings.field) {
          wizardPatterns.thirdPartySettings.field.forEach((setting: string) => {
            const [module, key] = setting.split('.');
            const description = key === 'property_json_query' ? 'OpenAPI property path' :
                               key === 'schema_name' ? 'OpenAPI schema name' :
                               key === 'api_spec_id' ? 'Reference to api_spec entity' : '';
            sections.push(`- Field: \`${setting}\` - ${description}`);
          });
        }
        if (wizardPatterns.thirdPartySettings.bundle) {
          wizardPatterns.thirdPartySettings.bundle.forEach((setting: string) => {
            const [module, key] = setting.split('.');
            const description = key === 'component_schema_id' ? 'OpenAPI schema ID' :
                               key === 'component_schema_ref' ? 'OpenAPI schema reference' :
                               key === 'original_bundle_id' ? 'Original bundle ID' : '';
            sections.push(`- Bundle: \`${setting}\` - ${description}`);
          });
        }
        sections.push(``);
      }
    }

    // Add failed approaches to avoid
    if (context.knowledge.failedApproaches.length > 0) {
      sections.push(
        `**Failed Approaches (AVOID THESE)**:`,
        ...context.knowledge.failedApproaches.map(
          a => `- ${a.description}: ${a.reason}`
        ),
        ``
      );
    }

    // Add working patterns
    if (context.knowledge.workingPatterns.length > 0) {
      sections.push(
        `**Working Patterns (USE THESE)**:`,
        ...context.knowledge.workingPatterns.map(
          p => `- ${p.description}:\n\`\`\`php\n${p.code}\n\`\`\``
        ),
        ``
      );
    }

    sections.push(
      `**Output Format**:`,
      `Generate patches in unified diff format for each file that needs changes.`,
      `Use the exact file paths provided above.`,
      `Include only the necessary changes to fix the requirement.`
    );

    return sections.join('\n');
  }

  /**
   * Build codebase context from accumulated knowledge
   */
  private buildCodebaseContext(context: PrdContext): string {
    const sections: string[] = [];

    if (context.knowledge.codeLocations.length > 0) {
      sections.push(
        '## Known Files and Functions',
        ...context.knowledge.codeLocations.map(
          l => `- ${l.path}: ${l.purpose}${l.relevantFunctions ? ` (functions: ${l.relevantFunctions.join(', ')})` : ''}`
        )
      );
    }

    return sections.join('\n');
  }

  /**
   * Parse code changes from AI response
   */
  private parseCodeChanges(response: any, originalFiles: Map<string, string>): CodeChanges {
    const changes: CodeChanges = {
      files: [],
      summary: response.summary || '',
    };

    // Try to extract from files array
    if (response.files && Array.isArray(response.files)) {
      for (const file of response.files) {
        if (file.path && file.content) {
          changes.files.push({
            path: file.path,
            content: file.content,
            operation: originalFiles.has(file.path) ? 'update' : 'create',
          });
        }
      }
    }

    // Try to extract from summary/content if no files
    if (changes.files.length === 0 && response.summary) {
      // Look for diff format in summary
      const diffMatch = response.summary.match(/```diff\n([\s\S]+?)\n```/);
      if (diffMatch) {
        // Parse unified diff format
        const diffContent = diffMatch[1];
        const fileMatches = diffContent.match(/^---\s+a\/(.+)$/gm);
        if (fileMatches) {
          // This is a simplified parser - full diff parsing would be more complex
          for (const match of fileMatches) {
            const filePath = match.replace(/^---\s+a\//, '').trim();
            if (filePath) {
              changes.files.push({
                path: filePath,
                content: response.summary, // Fallback to full summary
                operation: 'update',
              });
            }
          }
        }
      }
    }

    return changes;
  }
}
