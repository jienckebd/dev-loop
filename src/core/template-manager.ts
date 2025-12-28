import * as fs from 'fs-extra';
import * as path from 'path';
import { TemplateSource, FrameworkConfig, Task } from '../types';

export type TemplateType = 'generic' | 'playwright-test' | 'drupal' | string;

/**
 * Embedded templates for when file-based templates are not available.
 * These serve as fallbacks to ensure template loading never fails.
 */
const EMBEDDED_TEMPLATES: Record<string, string> = {
  'playwright-test': `You are an expert Playwright test engineer. Generate Playwright test code to implement the following task.

## CRITICAL RULES - Code Preservation

1. **NEVER remove or modify existing code** - Only ADD new test scenarios
2. **NEVER change import paths** - Copy imports EXACTLY from existing code
3. **Use ONLY existing helper functions** - Check the "Available Functions" section
4. **ADD new test() blocks** - Do not modify or replace existing tests
5. **Preserve test.describe structure** - Add tests inside existing describe blocks
6. **Use PATCH operations** - Never replace entire file contents

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}

## Target Files

{{targetFiles}}

## Existing Code Context

Review this EXISTING code carefully. You must PATCH this code, not replace it:

{{existingCode}}

## Output Format

Use PATCH operations with exact search/replace:

\`\`\`json
{
  "files": [
    {
      "path": "path/to/file.spec.ts",
      "patches": [
        {
          "search": "  });\\n});\\n",
          "replace": "  });\\n\\n  test('new test name', async ({ page }) => {\\n    // new test implementation\\n  });\\n});\\n"
        }
      ],
      "operation": "patch"
    }
  ],
  "summary": "Added new test scenario for X"
}
\`\`\`

## Patch Rules

1. **search** must match EXACTLY - copy from existing code including whitespace
2. Include 3-5 lines of context in search to ensure uniqueness
3. Add new tests BEFORE the closing \`});\` of the test.describe block
4. Preserve all existing helper functions and imports
5. Use existing helper functions (do not create new ones)
`,

  'drupal': `You are an expert Drupal developer. Generate code changes following Drupal coding standards.

## CRITICAL RULES

1. **MODIFY EXISTING FILES** - Do NOT create new modules/packages
2. **Use operation "update"** for existing files, "create" only for new files
3. **Never create custom entity classes** - Use bd.entity_type.*.yml config
4. **Never build custom Form API forms** - Use config_schema_subform
5. **All changes in docroot/modules/share/** - Never modify core/contrib

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}

## Target Files

{{targetFiles}}

## Existing Code Context

{{existingCode}}

## Output Format

\`\`\`json
{
  "files": [
    {
      "path": "exact/path/from/context/file",
      "content": "// Complete modified file content...",
      "operation": "update"
    }
  ],
  "summary": "Brief description of changes"
}
\`\`\`
`,

  'generic': `You are an expert developer. Generate code changes for the following task.

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}

## Target Files

{{targetFiles}}

## Existing Code Context

{{existingCode}}

## Output Format

Return JSON with code changes:

\`\`\`json
{
  "files": [
    {
      "path": "path/to/file",
      "content": "file content",
      "operation": "update"
    }
  ],
  "summary": "Description of changes"
}
\`\`\`
`,
};

export class TemplateManager {
  private frameworkConfig?: FrameworkConfig;
  private debug: boolean;

  constructor(
    private source: TemplateSource,
    private customPath?: string,
    frameworkConfig?: FrameworkConfig,
    debug = false
  ) {
    this.frameworkConfig = frameworkConfig;
    this.debug = debug;
  }

  async getPRDTemplate(): Promise<string> {
    return this.loadTemplate('create-prd.md');
  }

  async getTaskGenerationTemplate(): Promise<string> {
    return this.loadTemplate('generate-tasks.md');
  }

  /**
   * Detect the appropriate template type based on task content.
   */
  detectTemplateType(task: Task, targetFiles?: string): TemplateType {
    const taskText = `${task.title} ${task.description || ''} ${(task as any).details || ''}`.toLowerCase();
    const filesLower = (targetFiles || '').toLowerCase();

    // Playwright test detection
    if (
      filesLower.includes('playwright') ||
      filesLower.includes('.spec.ts') ||
      filesLower.includes('.test.ts') ||
      taskText.includes('playwright') ||
      taskText.includes('test scenario') ||
      taskText.includes('add test') ||
      taskText.includes('browser test')
    ) {
      return 'playwright-test';
    }

    // Drupal detection
    if (
      filesLower.includes('docroot/modules') ||
      filesLower.includes('.module') ||
      filesLower.includes('.php') ||
      taskText.includes('drupal') ||
      taskText.includes('drush') ||
      taskText.includes('entity type')
    ) {
      return 'drupal';
    }

    // Use framework type from config if available
    if (this.frameworkConfig?.type) {
      return this.frameworkConfig.type;
    }

    return 'generic';
  }

  async getTaskGenerationTemplateWithContext(context: {
    task: { title: string; description: string; priority: string };
    codebaseContext?: string;
    targetFiles?: string;
    existingCode?: string;
    templateType?: string;
    fileGuidance?: string; // NEW: File-specific guidance from CodeContextProvider
    patternGuidance?: string; // NEW: Pattern guidance from PatternLearner
  }): Promise<string> {
    const templateType = context.templateType || 'generic';
    let template: string | null = null;
    let templateSource = 'unknown';

    // 1. Try custom path first (.taskmaster/templates/)
    if (templateType === 'playwright-test') {
      const customPath = path.resolve(process.cwd(), '.taskmaster/templates/playwright-test.md');
      if (await fs.pathExists(customPath)) {
        template = await fs.readFile(customPath, 'utf-8');
        templateSource = 'custom (.taskmaster/templates/)';
      }
    }

    // 2. Try framework-specific template path
    if (!template && this.frameworkConfig?.templatePath) {
      const frameworkPath = path.resolve(process.cwd(), this.frameworkConfig.templatePath);
      if (await fs.pathExists(frameworkPath)) {
        template = await fs.readFile(frameworkPath, 'utf-8');
        templateSource = `framework (${this.frameworkConfig.templatePath})`;
      }
    }

    // 3. Try builtin templates directory
    if (!template && templateType !== 'generic') {
      const builtinPath = path.join(__dirname, '../templates/builtin', `${templateType}-task.md`);
      if (await fs.pathExists(builtinPath)) {
        template = await fs.readFile(builtinPath, 'utf-8');
        templateSource = 'builtin';
      }
    }

    // 4. Fallback to embedded templates (always available)
    if (!template) {
      template = EMBEDDED_TEMPLATES[templateType] || EMBEDDED_TEMPLATES['generic'];
      templateSource = 'embedded';
    }

    if (this.debug) {
      console.log(`[TemplateManager] Using ${templateSource} template for type "${templateType}"`);
    }

    // Substitute variables
    let result = this.substituteVariables(template, context);

    // Inject additional guidance sections
    if (context.fileGuidance) {
      result = context.fileGuidance + '\n\n' + result;
    }
    if (context.patternGuidance) {
      result = context.patternGuidance + '\n\n' + result;
    }

    return result;
  }

  private substituteVariables(
    template: string,
    context: {
      task: { title: string; description: string; priority: string };
      codebaseContext?: string;
      targetFiles?: string;
      existingCode?: string;
    }
  ): string {
    let result = template;
    result = result.replace(/\{\{task\.title\}\}/g, context.task.title);
    result = result.replace(/\{\{task\.description\}\}/g, context.task.description);
    result = result.replace(/\{\{task\.priority\}\}/g, context.task.priority);
    result = result.replace(/\{\{codebaseContext\}\}/g, context.codebaseContext || '');
    result = result.replace(/\{\{targetFiles\}\}/g, context.targetFiles || '');
    result = result.replace(/\{\{existingCode\}\}/g, context.existingCode || '');
    return result;
  }

  private async loadTemplate(filename: string): Promise<string> {
    let templatePath: string;

    switch (this.source) {
      case 'builtin':
        templatePath = path.join(__dirname, '../templates/builtin', filename);
        break;
      case 'ai-dev-tasks':
        templatePath = path.join(__dirname, '../templates/ai-dev-tasks', filename);
        break;
      case 'custom':
        if (!this.customPath) {
          throw new Error('customPath is required when using custom template source');
        }
        templatePath = path.join(this.customPath, filename);
        break;
      default:
        throw new Error(`Unknown template source: ${this.source}`);
    }

    if (!(await fs.pathExists(templatePath))) {
      // Fallback to embedded for specific template types
      const baseName = filename.replace('.md', '').replace('-task', '');
      if (EMBEDDED_TEMPLATES[baseName]) {
        if (this.debug) {
          console.log(`[TemplateManager] Template ${filename} not found, using embedded fallback`);
        }
        return EMBEDDED_TEMPLATES[baseName];
      }
      throw new Error(`Template not found: ${templatePath}`);
    }

    return fs.readFile(templatePath, 'utf-8');
  }

  /**
   * Get an embedded template by type (for direct access).
   */
  getEmbeddedTemplate(type: TemplateType): string {
    return EMBEDDED_TEMPLATES[type] || EMBEDDED_TEMPLATES['generic'];
  }

  listSources(): TemplateSource[] {
    return ['builtin', 'ai-dev-tasks', 'custom'];
  }

  listEmbeddedTemplates(): string[] {
    return Object.keys(EMBEDDED_TEMPLATES);
  }
}
