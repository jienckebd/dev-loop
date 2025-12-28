import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { promptInitConfig } from '../prompts';
import { Config } from '../../config/schema';

export async function initCommand(options: { template?: string }): Promise<void> {
  const spinner = ora('Initializing dev-loop configuration').start();

  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');

    if (await fs.pathExists(configPath)) {
      spinner.warn('Config file already exists');
      const { overwrite } = await import('inquirer').then((m) =>
        m.default.prompt([
          {
            type: 'confirm',
            name: 'overwrite',
            message: 'Overwrite existing config file?',
            default: false,
          },
        ])
      );

      if (!overwrite) {
        spinner.info('Cancelled');
        return;
      }
    }

    spinner.stop();

    const answers = await promptInitConfig();

    // Override template source if provided via CLI
    if (options.template) {
      answers.templateSource = options.template as any;
    }

    const config: Config = {
      debug: false,
      ai: {
        provider: answers.aiProvider,
        model: answers.aiModel,
        fallback: answers.aiFallback,
      },
      templates: {
        source: answers.templateSource,
        customPath: answers.customTemplatePath,
      },
      testing: {
        runner: answers.testRunner,
        command: answers.testCommand,
        timeout: answers.testTimeout,
        artifactsDir: answers.artifactsDir,
      },
      logs: {
        sources: answers.logSources,
        patterns: {
          error: /Error|Exception|Fatal/i,
          warning: /Warning|Deprecated/i,
        },
        useAI: true,
      },
      intervention: {
        mode: answers.interventionMode,
        approvalRequired: Array.isArray(answers.approvalRequired)
          ? answers.approvalRequired
          : typeof answers.approvalRequired === 'string'
          ? [answers.approvalRequired]
          : [],
      },
      taskMaster: {
        tasksPath: answers.tasksPath,
      },
    };

    const configContent = `module.exports = ${JSON.stringify(config, null, 2)};`;

    await fs.writeFile(configPath, configContent, 'utf-8');

    console.log(chalk.green('✓ Configuration file created: devloop.config.js'));
    console.log(chalk.cyan('\nNext steps:'));
    console.log(chalk.gray('  1. Review and customize devloop.config.js'));
    console.log(chalk.gray('  2. Set up your AI provider API keys in environment variables'));
    console.log(chalk.gray('  3. Run "dev-loop run" to start the workflow'));
  } catch (error) {
    spinner.fail('Failed to initialize configuration');
    console.error(error);
    process.exit(1);
  }
}

