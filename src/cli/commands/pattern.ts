import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { loadConfig } from '../../config/loader';

export async function patternListCommand(options: { config?: string }): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const patternsPath = (config as any).patternLearning?.patternsPath || '.devloop/patterns.json';

    console.log(chalk.bold('\nLearned Patterns\n'));
    console.log(chalk.gray('─'.repeat(80)));

    if (await fs.pathExists(patternsPath)) {
      const patterns = await fs.readJson(patternsPath);

      if (patterns && Array.isArray(patterns) && patterns.length > 0) {
        patterns.forEach((pattern: any, index: number) => {
          console.log(chalk.bold(`\nPattern ${index + 1}:`));
          if (pattern.name) console.log(`  Name: ${pattern.name}`);
          if (pattern.description) console.log(`  Description: ${pattern.description}`);
          if (pattern.condition) console.log(`  Condition: ${pattern.condition}`);
          if (pattern.action) console.log(`  Action: ${pattern.action}`);
          if (pattern.successRate !== undefined) {
            const rateColor = pattern.successRate > 0.8 ? chalk.green : pattern.successRate > 0.5 ? chalk.yellow : chalk.red;
            console.log(`  Success Rate: ${rateColor((pattern.successRate * 100).toFixed(1) + '%')}`);
          }
        });
      } else {
        console.log(chalk.yellow('No patterns found'));
      }
    } else {
      console.log(chalk.yellow('Patterns file not found'));
      console.log(chalk.gray(`Expected: ${patternsPath}`));
    }

    console.log(chalk.gray('\n─'.repeat(80)));
  } catch (error) {
    console.error(chalk.red(`Failed to list patterns: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
