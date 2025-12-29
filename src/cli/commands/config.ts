import chalk from 'chalk';
import { loadConfig } from '../../config/loader';

export async function configShowCommand(options: {
  config?: string;
  key?: string;
}): Promise<void> {
  try {
    const config = await loadConfig(options.config);

    if (options.key) {
      // Show specific key
      const keys = options.key.split('.');
      let value: any = config;
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          console.error(chalk.red(`Key not found: ${options.key}`));
          process.exit(1);
        }
      }

      console.log(chalk.bold(`\n${options.key}:`));
      if (typeof value === 'object') {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(value);
      }
      return;
    }

    // Show full configuration
    console.log(chalk.bold('\nDev-Loop Configuration\n'));
    console.log(chalk.gray('─'.repeat(60)));

    // AI Configuration
    console.log(chalk.cyan('\nAI Provider:'));
    console.log(`  Provider: ${(config as any).ai?.provider || 'not configured'}`);
    console.log(`  Model: ${(config as any).ai?.model || 'not configured'}`);
    console.log(`  Fallback: ${(config as any).ai?.fallback || 'none'}`);

    // Templates
    console.log(chalk.cyan('\nTemplates:'));
    console.log(`  Source: ${config.templates?.source || 'builtin'}`);
    if (config.templates?.customPath) {
      console.log(`  Custom Path: ${config.templates.customPath}`);
    }

    // Testing
    console.log(chalk.cyan('\nTesting:'));
    console.log(`  Runner: ${config.testing?.runner || 'not configured'}`);
    console.log(`  Command: ${config.testing?.command || 'npm test'}`);
    console.log(`  Timeout: ${config.testing?.timeout || 300000}ms`);

    // Logs
    console.log(chalk.cyan('\nLogs:'));
    console.log(`  Output Path: ${(config as any).logs?.outputPath || 'not configured'}`);
    console.log(`  Sources: ${config.logs?.sources?.length || 0} configured`);
    console.log(`  Use AI: ${config.logs?.useAI ? 'enabled' : 'disabled'}`);

    // Intervention
    console.log(chalk.cyan('\nIntervention:'));
    console.log(`  Mode: ${config.intervention?.mode || 'autonomous'}`);
    if (config.intervention?.approvalRequired?.length > 0) {
      console.log(`  Approval Required: ${config.intervention.approvalRequired.join(', ')}`);
    }

    // Task Master
    console.log(chalk.cyan('\nTask Master:'));
    console.log(`  Tasks Path: ${config.taskMaster?.tasksPath || '.taskmaster/tasks/tasks.json'}`);

    // Pattern Learning
    const patternLearning = (config as any).patternLearning;
    if (patternLearning) {
      console.log(chalk.cyan('\nPattern Learning:'));
      console.log(`  Enabled: ${patternLearning.enabled !== false ? 'yes' : 'no'}`);
      console.log(`  Patterns Path: ${patternLearning.patternsPath || '.devloop/patterns.json'}`);
    }

    // Pre-Validation
    const preValidation = (config as any).preValidation;
    if (preValidation) {
      console.log(chalk.cyan('\nPre-Validation:'));
      console.log(`  Enabled: ${preValidation.enabled !== false ? 'yes' : 'no'}`);
      console.log(`  Max Retries: ${preValidation.maxRetries || 2}`);
    }

    // Debug
    console.log(chalk.cyan('\nDebug:'));
    console.log(`  Debug Mode: ${(config as any).debug ? 'enabled' : 'disabled'}`);

    console.log(chalk.gray('\n─'.repeat(60)));

  } catch (error) {
    console.error(chalk.red(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
