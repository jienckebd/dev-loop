/**
 * Archive Command
 *
 * Moves Task Master and dev-loop JSON state files to an archive location.
 */

import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { loadConfig } from '../../config/loader';

export interface ArchiveOptions {
  config?: string;
  prdName?: string;
  archivePath?: string;
  compress?: boolean;
}

export async function archiveCommand(options: ArchiveOptions): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const projectRoot = process.cwd();

    // Determine PRD name
    const prdName = options.prdName || 'default';

    // Determine archive path
    const defaultArchivePath = (config as any).archive?.defaultPath || '.devloop/archive';
    const archivePath = options.archivePath || path.resolve(projectRoot, defaultArchivePath);

    // Create timestamped archive directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: 2026-01-05T19-30-45
    const archiveDir = path.join(archivePath, prdName, timestamp);

    console.log(chalk.cyan(`📦 Archiving state files for PRD: ${chalk.bold(prdName)}`));
    console.log(chalk.gray(`Archive location: ${archiveDir}`));

    // Ensure archive directory exists
    await fs.ensureDir(archiveDir);

    // Files to archive
    const filesToArchive: Array<{ source: string; dest: string }> = [];

    // Dev-loop state files
    const devloopFiles = [
      '.devloop/state.json',
      '.devloop/metrics.json',
      '.devloop/observations.json',
      '.devloop/patterns.json',
      '.devloop/retry-counts.json',
      '.devloop/contribution-mode.json',
      '.devloop/evolution-state.json',
      '.devloop/prd-set-metrics.json',
      '.devloop/prd-metrics.json',
      '.devloop/phase-metrics.json',
      '.devloop/feature-metrics.json',
      '.devloop/schema-metrics.json',
      '.devloop/observation-metrics.json',
      '.devloop/pattern-metrics.json',
    ];

    for (const file of devloopFiles) {
      const sourcePath = path.resolve(projectRoot, file);
      if (await fs.pathExists(sourcePath)) {
        const relativePath = path.relative(projectRoot, sourcePath);
        const destPath = path.join(archiveDir, 'devloop', relativePath);
        filesToArchive.push({ source: sourcePath, dest: destPath });
      }
    }

    // Dev-loop PRD context files
    const prdContextDir = path.resolve(projectRoot, '.devloop/prd-context');
    if (await fs.pathExists(prdContextDir)) {
      const contextFiles = await fs.readdir(prdContextDir);
      for (const file of contextFiles) {
        if (file.endsWith('.json')) {
          const sourcePath = path.join(prdContextDir, file);
          const destPath = path.join(archiveDir, 'devloop', 'prd-context', file);
          filesToArchive.push({ source: sourcePath, dest: destPath });
        }
      }
    }

    // Task Master state files
    const taskmasterFiles = [
      '.taskmaster/state.json',
      '.taskmaster/config.json',
    ];

    for (const file of taskmasterFiles) {
      const sourcePath = path.resolve(projectRoot, file);
      if (await fs.pathExists(sourcePath)) {
        const relativePath = path.relative(projectRoot, sourcePath);
        const destPath = path.join(archiveDir, 'taskmaster', relativePath);
        filesToArchive.push({ source: sourcePath, dest: destPath });
      }
    }

    // Task Master tasks directory
    const tasksDir = path.resolve(projectRoot, '.taskmaster/tasks');
    if (await fs.pathExists(tasksDir)) {
      const taskFiles = await fs.readdir(tasksDir);
      for (const file of taskFiles) {
        if (file.endsWith('.json')) {
          const sourcePath = path.join(tasksDir, file);
          const destPath = path.join(archiveDir, 'taskmaster', 'tasks', file);
          filesToArchive.push({ source: sourcePath, dest: destPath });
        }
      }
    }

    if (filesToArchive.length === 0) {
      console.log(chalk.yellow('⚠ No state files found to archive'));
      return;
    }

    // Archive files
    let archivedCount = 0;
    for (const { source, dest } of filesToArchive) {
      await fs.ensureDir(path.dirname(dest));
      await fs.copy(source, dest);
      archivedCount++;
    }

    console.log(chalk.green(`✓ Archived ${archivedCount} file(s)`));

    // Compress if requested
    if (options.compress) {
      const archiveFile = `${archiveDir}.tar.gz`;
      console.log(chalk.cyan(`🗜️  Compressing archive...`));

      // For simplicity, we'll create a tar.gz using Node.js streams
      // Note: This is a simplified compression - for full tar.gz support, consider using a library like 'tar'
      await compressDirectory(archiveDir, archiveFile);

      // Remove uncompressed directory
      await fs.remove(archiveDir);

      console.log(chalk.green(`✓ Compressed archive created: ${archiveFile}`));
      console.log(chalk.gray(`Archive size: ${formatFileSize(await fs.stat(archiveFile).then(s => s.size))}`));
    } else {
      console.log(chalk.green(`✓ Archive created at: ${archiveDir}`));
    }

  } catch (error) {
    console.error(chalk.red(`Failed to archive: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

/**
 * Compress a directory to a tar.gz file
 * Note: This is a simplified implementation. For production, consider using 'tar' library.
 */
async function compressDirectory(sourceDir: string, destFile: string): Promise<void> {
  // For now, we'll use a simple approach: zip the directory
  // In production, you'd want to use a proper tar.gz library
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    // Try using tar command if available
    await execAsync(`tar -czf "${destFile}" -C "${path.dirname(sourceDir)}" "${path.basename(sourceDir)}"`);
  } catch (error) {
    // Fallback: create a simple zip-like archive
    // For now, just copy the directory structure
    // In production, implement proper tar.gz compression
    throw new Error('Compression requires tar command. Install tar or use --no-compress flag.');
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

