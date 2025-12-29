import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';

const TEMPLATE_DIR = path.join(process.cwd(), '.taskmaster', 'templates');

export async function templateListCommand(): Promise<void> {
  try {
    console.log(chalk.bold('\nAvailable Templates\n'));
    console.log(chalk.gray('─'.repeat(80)));

    // List custom templates
    if (await fs.pathExists(TEMPLATE_DIR)) {
      const files = await fs.readdir(TEMPLATE_DIR);
      const templateFiles = files.filter(f => f.endsWith('.md'));

      if (templateFiles.length > 0) {
        console.log(chalk.cyan('\nCustom Templates:'));
        for (const file of templateFiles) {
          const filePath = path.join(TEMPLATE_DIR, file);
          const stats = await fs.stat(filePath);
          console.log(`  ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
        }
      }
    }

    // List built-in templates
    console.log(chalk.cyan('\nBuilt-in Templates:'));
    console.log('  playwright-test.md');
    console.log('  drupal-task.md');
    console.log('  generic (embedded)');

    console.log(chalk.gray('\n─'.repeat(80)));
  } catch (error) {
    console.error(chalk.red(`Failed to list templates: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

export async function templateShowCommand(templateName: string): Promise<void> {
  try {
    // Try custom template first
    const customPath = path.join(TEMPLATE_DIR, templateName);
    if (await fs.pathExists(customPath)) {
      const content = await fs.readFile(customPath, 'utf-8');
      console.log(chalk.bold(`\nTemplate: ${templateName}\n`));
      console.log(chalk.gray('─'.repeat(80)));
      console.log(content);
      console.log(chalk.gray('─'.repeat(80)));
      return;
    }

    // Try built-in templates
    const builtinPath = path.join(__dirname, '../../templates/builtin', templateName);
    if (await fs.pathExists(builtinPath)) {
      const content = await fs.readFile(builtinPath, 'utf-8');
      console.log(chalk.bold(`\nTemplate: ${templateName} (built-in)\n`));
      console.log(chalk.gray('─'.repeat(80)));
      console.log(content);
      console.log(chalk.gray('─'.repeat(80)));
      return;
    }

    console.error(chalk.red(`Template not found: ${templateName}`));
    process.exit(1);
  } catch (error) {
    console.error(chalk.red(`Failed to show template: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
