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

/**
 * Stop dev-loop daemon (watch mode)
 * 
 * **Unified Daemon Mode**: With unified daemon mode, PRD sets create tasks in Task Master
 * and exit immediately. Only watch mode daemon runs continuously to execute tasks.
 * This command stops the watch mode daemon, which stops all task execution.
 * 
 * **Usage**:
 * - PRD sets create tasks: `npx dev-loop prd-set execute <path>` (exits after task creation)
 * - Watch mode executes tasks: `npx dev-loop watch --until-complete` (daemon, writes PID file)
 * - Stop execution: `npx dev-loop stop` (stops watch mode daemon)
 * 
 * **Note**: PRD set execute doesn't write PID file (exits immediately after task creation).
 * Only watch mode writes PID file, so this command stops watch mode daemon.
 */
export async function stopCommand(): Promise<void> {
  const pidPath = getPidFilePath();

  if (!await fs.pathExists(pidPath)) {
    console.log(chalk.yellow('No dev-loop daemon is running (PID file not found)'));
    console.log(chalk.gray(`You can also use: pkill -f "dev-loop watch"`));
    console.log(chalk.gray(`Note: PRD set execute doesn't write PID file (creates tasks and exits).`));
    console.log(chalk.gray(`Only watch mode daemon writes PID file and can be stopped with this command.`));
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
    // This stops watch mode daemon, which stops all task execution
    console.log(chalk.cyan(`Stopping dev-loop watch mode daemon (PID: ${pid})...`));
    console.log(chalk.dim('  (This stops all task execution - watch mode executes tasks from Task Master)'));
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

    await removePidFile();
    console.log(chalk.green('✓ Dev-loop watch mode daemon stopped'));
    console.log(chalk.gray('  (Task execution stopped - tasks remain in Task Master)'));

  } catch (error) {
    console.error(chalk.red(`Failed to stop daemon: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}
