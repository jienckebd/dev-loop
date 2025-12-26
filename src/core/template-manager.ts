import * as fs from 'fs-extra';
import * as path from 'path';
import { TemplateSource } from '../types';

export class TemplateManager {
  constructor(private source: TemplateSource, private customPath?: string) {}

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
    templateType?: 'generic' | 'drupal';
  }): Promise<string> {
    // Use Drupal template if specified or if target files suggest Drupal
    const useDrupalTemplate = context.templateType === 'drupal' || 
      (context.targetFiles && /\.(php|module|yml)$/.test(context.targetFiles));
    
    const templateFile = useDrupalTemplate ? 'drupal-task.md' : 'generate-tasks.md';
    let template = await this.loadTemplate(templateFile);

    // Simple variable substitution
    template = template.replace(/\{\{task\.title\}\}/g, context.task.title);
    template = template.replace(/\{\{task\.description\}\}/g, context.task.description);
    template = template.replace(/\{\{task\.priority\}\}/g, context.task.priority);
    template = template.replace(/\{\{codebaseContext\}\}/g, context.codebaseContext || '');
    template = template.replace(/\{\{targetFiles\}\}/g, context.targetFiles || '');
    template = template.replace(/\{\{existingCode\}\}/g, context.existingCode || '');

    return template;
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

