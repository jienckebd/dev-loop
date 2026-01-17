import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';

const PID_FILE = '.devloop.pid';
const PID_DIR = '.devloop/pids';

function getPidDirPath(): string {
  return path.resolve(process.cwd(), PID_DIR);
}

function getPidFilePath(): string {
  return path.resolve(process.cwd(), PID_FILE);
}

function getPidFilePathForPrdSet(setId?: string): string {
  const pidDir = getPidDirPath();
  const safeSetId = (setId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(pidDir, `prd-set-${safeSetId}.pid`);
}

export async function writePidFile(setId?: string): Promise<void> {
  // Legacy support: also write to old location
  const pidPath = getPidFilePath();
  await fs.writeFile(pidPath, process.pid.toString(), 'utf-8');
  
  // New location: write to pids directory for prd-set
  if (setId) {
    const prdSetPidPath = getPidFilePathForPrdSet(setId);
    await fs.ensureDir(path.dirname(prdSetPidPath));
    await fs.writeFile(prdSetPidPath, process.pid.toString(), 'utf-8');
  }
}

export async function writePidFileForPrdSet(setId: string): Promise<void> {
  const pidPath = getPidFilePathForPrdSet(setId);
  await fs.ensureDir(path.dirname(pidPath));
  await fs.writeFile(pidPath, process.pid.toString(), 'utf-8');
}

export async function removePidFile(): Promise<void> {
  // Remove legacy file
  const pidPath = getPidFilePath();
  if (await fs.pathExists(pidPath)) {
    await fs.remove(pidPath);
  }
}

export async function removePidFileForPrdSet(setId: string): Promise<void> {
  const pidPath = getPidFilePathForPrdSet(setId);
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
          const type = file.startsWith('prd-set-') ? 'prd-set' : 'unknown';
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
 * Stop all dev-loop processes
 * 
 * **Execution Model**: PRD sets use parallel IterationRunner instances for
 * execution. The loop behavior is determined by the PRD set schema and
 * parallel PRD execution, not by a separate command.
 * 
 * **Usage**:
 * - Execute PRD set: `npx dev-loop prd-set execute <path>`
 * - Stop execution: `npx dev-loop stop`
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
        pidFiles.push({ path: legacyPidPath, pid, type: 'legacy' });
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
      const typeLabel = type === 'prd-set' ? `prd-set execute (${pidPath.split('/').pop()?.replace('.pid', '') || 'unknown'})` : 'process';
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
    console.log(chalk.gray('  (Task execution stopped - tasks remain in Task Master)'));
  }

  if (failedCount > 0) {
    console.error(chalk.red(`\n✗ Failed to stop ${failedCount} process(es)`));
    process.exit(1);
  }

  process.exit(0);
}
