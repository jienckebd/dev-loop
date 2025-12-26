import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { LogAnalyzerFactory } from '../../providers/log-analyzers/factory';

export async function logsCommand(options: { config?: string; analyze?: boolean }): Promise<void> {
  const spinner = ora('Loading configuration').start();

  try {
    const config = await loadConfig(options.config);
    spinner.succeed('Configuration loaded');

    if (options.analyze && config.logs.sources.length > 0) {
      spinner.start('Analyzing logs');
      const analyzer = LogAnalyzerFactory.create(config);
      const analysis = await analyzer.analyze(config.logs.sources);
      spinner.succeed('Log analysis complete');

      console.log(chalk.bold('\nLog Analysis Results\n'));
      console.log(chalk.gray('─'.repeat(50)));

      if (analysis.errors.length > 0) {
        console.log(chalk.red(`Errors (${analysis.errors.length}):`));
        analysis.errors.forEach((error) => {
          console.log(chalk.red(`  • ${error}`));
        });
      }

      if (analysis.warnings.length > 0) {
        console.log(chalk.yellow(`Warnings (${analysis.warnings.length}):`));
        analysis.warnings.forEach((warning) => {
          console.log(chalk.yellow(`  • ${warning}`));
        });
      }

      console.log(chalk.cyan('\nSummary:'));
      console.log(`  ${analysis.summary}`);

      if (analysis.recommendations && analysis.recommendations.length > 0) {
        console.log(chalk.cyan('\nRecommendations:'));
        analysis.recommendations.forEach((rec) => {
          console.log(chalk.gray(`  • ${rec}`));
        });
      }
    } else {
      console.log(chalk.yellow('No log sources configured or analysis not requested'));
      console.log(chalk.gray('Use --analyze flag to run log analysis'));
    }
  } catch (error) {
    spinner.fail('Failed to process logs');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

