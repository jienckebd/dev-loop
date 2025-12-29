import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { isPaused } from './pause';

export async function resumeCommand(): Promise<void> {
  try {
    const pauseFile = path.join(process.cwd(), '.devloop', 'pause');
    if (await fs.pathExists(pauseFile)) {
      await fs.remove(pauseFile);
      console.log(chalk.green('▶  Workflow resumed'));
    } else {
      console.log(chalk.yellow('Workflow is not paused'));
    }
  } catch (error) {
    console.error(chalk.red(`Failed to resume: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

export async function checkAndResumeIfNeeded(): Promise<boolean> {
  if (isPaused()) {
    return false;
  }
  return true;
}
