import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';

const PID_FILE = '.devloop.pid';
const PID_DIR = '.devloop/pids';

export function getPidDirPath(): string {
  return path.resolve(process.cwd(), PID_DIR);
}

export function getPidFilePath(): string {
  return path.resolve(process.cwd(), PID_FILE);
}

export function getPidFilePathForType(type: 'watch' | 'prd-set', setId?: string): string {
  const pidDir = getPidDirPath();
  if (type === 'watch') {
    return path.join(pidDir, 'watch.pid');
  } else {
    const safeSetId = (setId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(pidDir, `prd-set-${safeSetId}.pid`);
  }
}

export async function writePidFile(): Promise<void> {
  // Legacy support: also write to old location
  const pidPath = getPidFilePath();
  await fs.writeFile(pidPath, process.pid.toString(), 'utf-8');
  
  // New location: write to pids directory
  const watchPidPath = getPidFilePathForType('watch');
  await fs.ensureDir(path.dirname(watchPidPath));
  await fs.writeFile(watchPidPath, process.pid.toString(), 'utf-8');
}

export async function writePidFileForPrdSet(setId: string): Promise<void> {
  const pidPath = getPidFilePathForType('prd-set', setId);
  await fs.ensureDir(path.dirname(pidPath));
  await fs.writeFile(pidPath, process.pid.toString(), 'utf-8');
}

export async function removePidFile(): Promise<void> {
  // Remove legacy file
  const pidPath = getPidFilePath();
  if (await fs.pathExists(pidPath)) {
    await fs.remove(pidPath);
  }
  
  // Remove watch PID file
  const watchPidPath = getPidFilePathForType('watch');
  if (await fs.pathExists(watchPidPath)) {
    await fs.remove(watchPidPath);
  }
}

export async function removePidFileForPrdSet(setId: string): Promise<void> {
  const pidPath = getPidFilePathForType('prd-set', setId);
  if (await fs.pathExists(pidPath)) {
    await fs.remove(pidPath);
  }
}

/**
 * Get all PID files from the pids directory
 */
async function getAllPidFiles(): Promise<Array<{ path: string; pid: number; type: string }>> {
  const pidDir = getPidDirPath();
  const results: Array<{ path: string; pid: number; type: string }> = [];
  
  if (!await fs.pathExists(pidDir)) {
    return results;
  }
  
  const files = await fs.readdir(pidDir);
  for (const file of files) {
    if (file.endsWith('.pid')) {
      const pidPath = path.join(pidDir, file);
      try {
        const pidStr = await fs.readFile(pidPath, 'utf-8');
        const pid = parseInt(pidStr.trim(), 10);
        if (!isNaN(pid)) {
          const type = file.startsWith('prd-set-') ? 'prd-set' : file.startsWith('watch') ? 'watch' : 'unknown';
          results.push({ path: pidPath, pid, type });
        }
      } catch (error) {
        // Skip invalid PID files
      }
    }
  }
  
  return results;
}

/**
 * Stop all dev-loop processes (watch mode and prd-set execute)
 * 
 * **Unified Daemon Mode**: With unified daemon mode, PRD sets create tasks in Task Master
 * and exit immediately. Only watch mode daemon runs continuously to execute tasks.
 * This command stops all dev-loop processes (watch mode daemon and prd-set execute processes).
 * 
 * **Usage**:
 * - PRD sets create tasks: `npx dev-loop prd-set execute <path>` (writes PID file, exits after task creation)
 * - Watch mode executes tasks: `npx dev-loop watch --until-complete` (daemon, writes PID file)
 * - Stop execution: `npx dev-loop stop` (stops all dev-loop processes)
 */
export async function stopCommand(): Promise<void> {
  // Check both legacy PID file and new PID directory
  const legacyPidPath = getPidFilePath();
  const pidFiles = await getAllPidFiles();
  
  // Add legacy PID file if it exists
  if (await fs.pathExists(legacyPidPath)) {
    try {
      const pidStr = await fs.readFile(legacyPidPath, 'utf-8');
      const pid = parseInt(pidStr.trim(), 10);
      if (!isNaN(pid)) {
        pidFiles.push({ path: legacyPidPath, pid, type: 'watch' });
      }
    } catch {
      // Skip invalid legacy PID file
    }
  }

  if (pidFiles.length === 0) {
    console.log(chalk.yellow('No dev-loop processes are running (no PID files found)'));
    console.log(chalk.gray(`You can also use: pkill -f "dev-loop"`));
    process.exit(0);
  }

  let stoppedCount = 0;
  let failedCount = 0;
  let stoppedWatch = false;

  for (const { path: pidPath, pid, type } of pidFiles) {
    try {
      // Check if process exists
      try {
        process.kill(pid, 0); // Signal 0 just checks if process exists
      } catch {
        console.log(chalk.yellow(`Process ${pid} (${type}) is not running (stale PID file)`));
        await fs.remove(pidPath);
        continue;
      }

      // Send SIGTERM for graceful shutdown
      const typeLabel = type === 'watch' ? 'watch mode daemon' : `prd-set execute (${pidPath.split('/').pop()?.replace('.pid', '') || 'unknown'})`;
      console.log(chalk.cyan(`Stopping dev-loop ${typeLabel} (PID: ${pid})...`));
      process.kill(pid, 'SIGTERM');

      // Wait a moment and verify it stopped
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        process.kill(pid, 0);
        // Still running, try SIGKILL
        console.log(chalk.yellow(`Process ${pid} did not stop gracefully, forcing...`));
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process is gone, good
      }

      await fs.remove(pidPath);
      stoppedCount++;
      if (type === 'watch') {
        stoppedWatch = true;
      }
      console.log(chalk.green(`✓ Dev-loop ${typeLabel} stopped`));

    } catch (error) {
      console.error(chalk.red(`Failed to stop process ${pid}: ${error instanceof Error ? error.message : String(error)}`));
      failedCount++;
      // Try to remove stale PID file
      try {
        await fs.remove(pidPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  if (stoppedCount > 0) {
    console.log(chalk.green(`\n✓ Stopped ${stoppedCount} dev-loop process(es)`));
    if (stoppedWatch) {
      console.log(chalk.gray('  (Task execution stopped - tasks remain in Task Master)'));
    }
  }

  if (failedCount > 0) {
    console.error(chalk.red(`\n✗ Failed to stop ${failedCount} process(es)`));
    process.exit(1);
  }

  process.exit(0);
}
