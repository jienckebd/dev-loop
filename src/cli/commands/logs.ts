import * as fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { loadConfig } from '../../config/loader';
import { LogAnalyzerFactory } from '../../providers/log-analyzers/factory';

export async function logsCommand(options: {
  config?: string;
  analyze?: boolean;
  tail?: number;
  follow?: boolean;
  clear?: boolean;
}): Promise<void> {
  const spinner = ora('Loading configuration').start();

  try {
    const config = await loadConfig(options.config);
    spinner.succeed('Configuration loaded');

    const logPath = config.logs.outputPath;

    // Handle --clear flag
    if (options.clear) {
      if (logPath && await fs.pathExists(logPath)) {
        await fs.writeFile(logPath, '');
        console.log(chalk.green(`Cleared log file: ${logPath}`));
      } else {
        console.log(chalk.yellow('No log file configured or file does not exist'));
      }
      return;
    }

    // Default behavior: show dev-loop logs from configured file
    if (logPath) {
      if (await fs.pathExists(logPath)) {
        const content = await fs.readFile(logPath, 'utf-8');
        const lines = content.split('\n');
        const tailLines = options.tail || 50;

        console.log(chalk.bold(`\nDev-loop Logs (${logPath})\n`));
        console.log(chalk.gray('─'.repeat(60)));

        // Show last N lines
        const startIndex = Math.max(0, lines.length - tailLines);
        const displayLines = lines.slice(startIndex);

        displayLines.forEach((line) => {
          if (line.includes('[ERROR]')) {
            console.log(chalk.red(line));
          } else if (line.includes('[WARN]')) {
            console.log(chalk.yellow(line));
          } else if (line.includes('[INFO]')) {
            console.log(chalk.blue(line));
          } else if (line.includes('[DEBUG]')) {
            console.log(chalk.gray(line));
          } else if (line.includes('>>> AI REQUEST') || line.includes('<<< AI RESPONSE')) {
            console.log(chalk.cyan(line));
          } else if (line.includes('[WORKFLOW]')) {
            console.log(chalk.magenta(line));
          } else if (line.startsWith('===') || line.startsWith('---')) {
            console.log(chalk.gray(line));
          } else {
            console.log(line);
          }
        });

        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.gray(`Showing last ${displayLines.length} lines of ${lines.length} total`));

        // Follow mode
        if (options.follow) {
          console.log(chalk.cyan('\nFollowing log file... (Ctrl+C to stop)\n'));

          const chokidar = await import('chokidar');
          let lastLineCount = lines.length;

          const watcher = chokidar.watch(logPath, {
            persistent: true,
            awaitWriteFinish: {
              stabilityThreshold: 100,
              pollInterval: 50,
            },
          });

          watcher.on('change', async () => {
            try {
              const newContent = await fs.readFile(logPath, 'utf-8');
              const newLines = newContent.split('\n');
              if (newLines.length > lastLineCount) {
                const addedLines = newLines.slice(lastLineCount);
                addedLines.forEach((line) => {
                  if (line.trim()) {
                    console.log(line);
                  }
                });
                lastLineCount = newLines.length;
              }
            } catch {
              // Ignore read errors during follow
            }
          });

          // Keep process running
          await new Promise(() => {});
        }
      } else {
        console.log(chalk.yellow(`Log file not found: ${logPath}`));
        console.log(chalk.gray('Run dev-loop to generate logs'));
      }
    } else {
      console.log(chalk.yellow('No log output path configured'));
      console.log(chalk.gray('Add logs.outputPath to your devloop.config.js'));
    }

    // Analyze project logs if requested
    if (options.analyze && config.logs.sources.length > 0) {
      spinner.start('Analyzing project logs');
      const analyzer = LogAnalyzerFactory.create(config);
      const analysis = await analyzer.analyze(config.logs.sources);
      spinner.succeed('Log analysis complete');

      console.log(chalk.bold('\nProject Log Analysis\n'));
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
    }
  } catch (error) {
    spinner.fail('Failed to process logs');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
