import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';

export async function pauseCommand(): Promise<void> {
  try {
    const pauseFile = path.join(process.cwd(), '.devloop', 'pause');
    await fs.ensureDir(path.dirname(pauseFile));
    await fs.writeFile(pauseFile, Date.now().toString());
    console.log(chalk.yellow('⏸  Workflow paused'));
    console.log(chalk.gray('Run "dev-loop resume" to continue'));
  } catch (error) {
    console.error(chalk.red(`Failed to pause: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

export function isPaused(): boolean {
  const pauseFile = path.join(process.cwd(), '.devloop', 'pause');
  return fs.existsSync(pauseFile);
}
