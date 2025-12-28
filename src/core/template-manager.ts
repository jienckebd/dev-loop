import * as fs from 'fs-extra';
import * as path from 'path';
import { TemplateSource, FrameworkConfig } from '../types';

export class TemplateManager {
  private frameworkConfig?: FrameworkConfig;

  constructor(
    private source: TemplateSource,
    private customPath?: string,
    frameworkConfig?: FrameworkConfig
  ) {
    this.frameworkConfig = frameworkConfig;
  }

  async getPRDTemplate(): Promise<string> {
    return this.loadTemplate('create-prd.md');
  }

  async getTaskGenerationTemplate(): Promise<string> {
    return this.loadTemplate('generate-tasks.md');
  }

  async getTaskGenerationTemplateWithContext(context: {
    task: { title: string; description: string; priority: string };
    codebaseContext?: string;
    targetFiles?: string;
    existingCode?: string;
    templateType?: string; // Now supports any framework type, not just 'generic' | 'drupal'
  }): Promise<string> {
    // Determine template file based on framework config
    let templateFile = 'generate-tasks.md';

    // Check if framework has a custom template path
    if (this.frameworkConfig?.templatePath) {
      try {
        const customTemplate = await fs.readFile(
          path.resolve(process.cwd(), this.frameworkConfig.templatePath),
          'utf-8'
        );
        return this.substituteVariables(customTemplate, context);
      } catch {
        console.warn(`[TemplateManager] Framework template not found: ${this.frameworkConfig.templatePath}, using default`);
      }
    }

    // Use framework-specific template if available in builtin templates
    if (context.templateType && context.templateType !== 'generic') {
      const frameworkTemplateFile = `${context.templateType}-task.md`;
      try {
        const template = await this.loadTemplate(frameworkTemplateFile);
        return this.substituteVariables(template, context);
      } catch {
        // Framework template not found, fall back to generic
        console.log(`[TemplateManager] No template for ${context.templateType}, using generic`);
      }
    }

    const template = await this.loadTemplate(templateFile);
    return this.substituteVariables(template, context);
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
      throw new Error(`Template not found: ${templatePath}`);
    }

    return fs.readFile(templatePath, 'utf-8');
  }

  listSources(): TemplateSource[] {
    return ['builtin', 'ai-dev-tasks', 'custom'];
  }
}

