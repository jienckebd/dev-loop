import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';

const PID_FILE = '.devloop.pid';

export function getPidFilePath(): string {
  return path.resolve(process.cwd(), PID_FILE);
}

export async function writePidFile(): Promise<void> {
  const pidPath = getPidFilePath();
  await fs.writeFile(pidPath, process.pid.toString(), 'utf-8');
}

export async function removePidFile(): Promise<void> {
  const pidPath = getPidFilePath();
  if (await fs.pathExists(pidPath)) {
    await fs.remove(pidPath);
  }
}

export async function stopCommand(): Promise<void> {
  const pidPath = getPidFilePath();

  if (!await fs.pathExists(pidPath)) {
    console.log(chalk.yellow('No dev-loop daemon is running (PID file not found)'));
    console.log(chalk.gray(`You can also use: pkill -f "dev-loop watch"`));
    process.exit(0);
  }

  try {
    const pid = parseInt(await fs.readFile(pidPath, 'utf-8'), 10);

    if (isNaN(pid)) {
      console.log(chalk.red('Invalid PID file'));
      await fs.remove(pidPath);
      process.exit(1);
    }

    // Check if process exists
    try {
      process.kill(pid, 0); // Signal 0 just checks if process exists
    } catch {
      console.log(chalk.yellow(`Process ${pid} is not running (stale PID file)`));
      await fs.remove(pidPath);
      process.exit(0);
    }

    // Send SIGTERM for graceful shutdown
    console.log(chalk.cyan(`Stopping dev-loop daemon (PID: ${pid})...`));
    process.kill(pid, 'SIGTERM');

    // Wait a moment and verify it stopped
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      process.kill(pid, 0);
      // Still running, try SIGKILL
      console.log(chalk.yellow('Process did not stop gracefully, forcing...'));
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process is gone, good
    }

    await fs.remove(pidPath);
    console.log(chalk.green('✓ Dev-loop daemon stopped'));

  } catch (error) {
    console.error(chalk.red(`Failed to stop daemon: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
