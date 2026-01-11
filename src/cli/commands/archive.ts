/**
 * Archive Command
 *
 * Moves Task Master and dev-loop JSON state files to an archive location
 * and resets them to empty/default state.
 */

import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream } from 'fs';
import { loadConfig } from '../../config/loader';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PatternLoader } from '../../core/prd/learning/pattern-loader';
import { ObservationLoader } from '../../core/prd/learning/observation-loader';
import { TestResultsLoader } from '../../core/prd/learning/test-results-loader';
import { SchemaValidator } from '../../core/prd/learning/schema-validator';

const execAsync = promisify(exec);

export interface ArchiveOptions {
  config?: string;
  prdName?: string;
  archivePath?: string;
  compress?: boolean;
  // Pruning options (manual pruning of learning files)
  prune?: boolean; // Remove old entries from learning JSON files instead of archiving them
  pruneDays?: number; // Only keep entries newer than N days (default: 90)
  pruneTestResults?: boolean; // Remove test results older than threshold
  prunePatterns?: boolean; // Remove patterns not used in last N days
  pruneObservations?: boolean; // Remove observations older than N days
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

    // Step 1: Kill background agent processes
    console.log(chalk.cyan('🛑 Killing background agent processes...'));
    try {
      await execAsync('pkill -f "cursor.*agent" || true', { timeout: 5000 });
      console.log(chalk.gray('  Killed hanging Cursor background agent processes'));
    } catch (error) {
      console.log(chalk.gray('  No background agent processes found'));
    }

    // Step 2: Delete Cursor agent files (not archived, deleted completely)
    console.log(chalk.cyan('🗑️  Deleting Cursor agent files...'));
    const agentsDir = path.resolve(projectRoot, '.cursor/agents');
    let deletedAgentCount = 0;
    if (await fs.pathExists(agentsDir)) {
      try {
        const agentFiles = await fs.readdir(agentsDir);
        for (const file of agentFiles) {
          if (file.endsWith('.md')) {
            const filePath = path.join(agentsDir, file);
            await fs.unlink(filePath);
            deletedAgentCount++;
            console.log(chalk.gray(`  Deleted ${path.relative(projectRoot, filePath)}`));
          }
        }
      } catch (error) {
        console.log(chalk.yellow(`  Warning: Could not delete agent files: ${error}`));
      }
    }
    if (deletedAgentCount > 0) {
      console.log(chalk.green(`✓ Deleted ${deletedAgentCount} agent file(s)`));
    } else {
      console.log(chalk.gray('  No agent files to delete'));
    }

    // Files to archive
    const filesToArchive: Array<{ source: string; dest: string }> = [];

    // Dev-loop state files (EXCLUDE learning files - they stay in place)
    // Learning files (patterns.json, observations.json, test-results.json, prd-set-state.json, config/*.json)
    // are NOT archived - they remain in place with filtering to prevent stale data interference
    const excludeLearningFiles = (config as any).archive?.excludeLearningFiles !== false; // Default: true
    
    const devloopFiles = [
      '.devloop/state.json',
      '.devloop/metrics.json',
      // NOTE: observations.json, patterns.json are NOT archived (learning files stay in place)
      '.devloop/retry-counts.json',
      '.devloop/contribution-mode.json',
      '.devloop/prd-set-metrics.json',
      '.devloop/prd-metrics.json',
      '.devloop/phase-metrics.json',
      '.devloop/feature-metrics.json',
      '.devloop/schema-metrics.json',
      '.devloop/observation-metrics.json',
      '.devloop/pattern-metrics.json',
      '.devloop/cursor-sessions.json', // Cursor background agent session state
      // NOTE: test-results.json/test-results.json, prd-set-state.json, config/*.json are NOT archived
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
    // Note: .taskmaster/config.json is user configuration and should NOT be archived
    const taskmasterFiles = [
      '.taskmaster/state.json',
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

    // Cursor chat request files
    const cursorChatRequestsPath = path.resolve(projectRoot, 'files-private/cursor/chat-requests.json');
    if (await fs.pathExists(cursorChatRequestsPath)) {
      const destPath = path.join(archiveDir, 'files-private', 'cursor', 'chat-requests.json');
      filesToArchive.push({ source: cursorChatRequestsPath, dest: destPath });
    }

    // Cursor chat instructions directory
    const cursorChatInstructionsDir = path.resolve(projectRoot, 'files-private/cursor/chat-instructions');
    if (await fs.pathExists(cursorChatInstructionsDir)) {
      try {
        const instructionFiles = await fs.readdir(cursorChatInstructionsDir);
        for (const file of instructionFiles) {
          if (file.endsWith('.md') || file.endsWith('.json')) {
            const sourcePath = path.join(cursorChatInstructionsDir, file);
            const destPath = path.join(archiveDir, 'files-private', 'cursor', 'chat-instructions', file);
            filesToArchive.push({ source: sourcePath, dest: destPath });
          }
        }
      } catch (error) {
        // Directory might be empty or inaccessible
      }
    }

    // Cursor completed requests directory
    const cursorCompletedDir = path.resolve(projectRoot, 'files-private/cursor/completed');
    if (await fs.pathExists(cursorCompletedDir)) {
      try {
        const completedFiles = await fs.readdir(cursorCompletedDir);
        for (const file of completedFiles) {
          if (file.endsWith('.json')) {
            const sourcePath = path.join(cursorCompletedDir, file);
            const destPath = path.join(archiveDir, 'files-private', 'cursor', 'completed', file);
            filesToArchive.push({ source: sourcePath, dest: destPath });
          }
        }
      } catch (error) {
        // Directory might be empty or inaccessible
      }
    }

    // Note: tasksDir is reused below for reset logic

    if (filesToArchive.length === 0) {
      console.log(chalk.yellow('⚠ No state files found to archive'));
      return;
    }

    // Archive files (move, not copy)
    let archivedCount = 0;
    const movedFiles: string[] = [];
    for (const { source, dest } of filesToArchive) {
      await fs.ensureDir(path.dirname(dest));
      await fs.move(source, dest);
      movedFiles.push(source);
      archivedCount++;
    }

    console.log(chalk.green(`✓ Archived ${archivedCount} file(s)`));

    // Reset state files after moving
    console.log(chalk.cyan('🔄 Resetting state files...'));

    // Reset Task Master task files
    const tasksJsonPath = path.resolve(tasksDir, 'tasks.json');
    for (const movedFile of movedFiles) {
      // Check if this is a task file from .taskmaster/tasks/
      if (movedFile.startsWith(tasksDir + path.sep) && movedFile.endsWith('.json')) {
        await fs.ensureDir(path.dirname(movedFile));
        // Main tasks.json gets the standard structure, others get empty
        if (movedFile === tasksJsonPath) {
          await fs.writeJson(movedFile, { master: { tasks: [] } }, { spaces: 2 });
        } else {
          await fs.writeJson(movedFile, {}, { spaces: 2 });
        }
        console.log(chalk.gray(`  Reset ${path.relative(projectRoot, movedFile)}`));
      }
    }

    // Reset Task Master state.json
    const taskmasterStatePath = path.resolve(projectRoot, '.taskmaster/state.json');
    if (movedFiles.includes(taskmasterStatePath)) {
      await fs.ensureDir(path.dirname(taskmasterStatePath));
      await fs.writeJson(taskmasterStatePath, { migrationNoticeShown: true }, { spaces: 2 });
      console.log(chalk.gray(`  Reset ${path.relative(projectRoot, taskmasterStatePath)}`));
    }

    // Reset dev-loop state files (EXCLUDE learning files - they stay in place)
    // Learning files (patterns.json, observations.json, test-results.json, prd-set-state.json, config/*.json)
    // are NOT reset - they remain in place with filtering to prevent stale data interference
    const devloopFilesToReset = [
      '.devloop/state.json',
      '.devloop/metrics.json',
      // NOTE: observations.json, patterns.json are NOT reset (learning files stay in place)
      // NOTE: test-results.json/test-results.json, prd-set-state.json, config/*.json are NOT reset
      '.devloop/retry-counts.json',
      '.devloop/contribution-mode.json',
      '.devloop/prd-set-metrics.json',
      '.devloop/prd-metrics.json',
      '.devloop/phase-metrics.json',
      '.devloop/feature-metrics.json',
      '.devloop/schema-metrics.json',
      '.devloop/observation-metrics.json',
      '.devloop/pattern-metrics.json',
      '.devloop/cursor-sessions.json', // Reset cursor sessions
    ];

    // File-specific reset values (only for files that were archived)
    const resetValues: Record<string, any> = {
      '.devloop/state.json': {},
      '.devloop/metrics.json': { version: '1.0', runs: [], summary: { totalRuns: 0, successRate: 0, avgAiCallMs: 0, avgTestRunMs: 0, totalTokensInput: 0, totalTokensOutput: 0 } },
      // NOTE: observations.json, patterns.json are NOT reset (learning files stay in place)
      '.devloop/retry-counts.json': {},
      '.devloop/contribution-mode.json': {},
      '.devloop/prd-set-metrics.json': {},
      '.devloop/prd-metrics.json': {},
      '.devloop/phase-metrics.json': {},
      '.devloop/feature-metrics.json': {},
      '.devloop/pattern-metrics.json': {},
      '.devloop/cursor-sessions.json': { version: '1.0', updatedAt: new Date().toISOString(), sessions: [] },
    };

    for (const file of devloopFilesToReset) {
      const filePath = path.resolve(projectRoot, file);
      if (movedFiles.includes(filePath)) {
        await fs.ensureDir(path.dirname(filePath));
        const resetValue = resetValues[file] || {};
        await fs.writeJson(filePath, resetValue, { spaces: 2 });
        console.log(chalk.gray(`  Reset ${path.relative(projectRoot, filePath)}`));
      }
    }

    // Reset cursor chat requests file
    if (movedFiles.includes(cursorChatRequestsPath)) {
      await fs.ensureDir(path.dirname(cursorChatRequestsPath));
      await fs.writeJson(cursorChatRequestsPath, { requests: [] }, { spaces: 2 });
      console.log(chalk.gray(`  Reset ${path.relative(projectRoot, cursorChatRequestsPath)}`));
    }

    // Note: PRD context files are not reset (directory may not exist if empty)
    // Note: Chat instruction files and completed files don't need reset (directories will be empty)

    // Handle pruning of learning files if --prune flag is used
    if (options.prune || (config as any).archive?.pruning?.enabled) {
      await pruneLearningFiles(projectRoot, config as any, options);
    }

    // Log which learning files were NOT archived (they stay in place)
    if (excludeLearningFiles) {
      console.log(chalk.cyan('\n📚 Learning files (NOT archived - kept in place with filtering):'));
      console.log(chalk.gray('  • .devloop/patterns.json (kept - auto-filtered on load)'));
      console.log(chalk.gray('  • .devloop/observations.json (kept - auto-filtered on load)'));
      console.log(chalk.gray('  • .devloop/test-results.json/test-results.json (kept - auto-filtered on load)'));
      console.log(chalk.gray('  • .devloop/prd-set-state.json (kept - auto-filtered on load)'));
      console.log(chalk.gray('  • .devloop/config/*.json (kept - framework patterns)'));
      console.log(chalk.gray('  • .devloop/prd-building-checkpoints/*.json (kept - may be pruned manually)'));
      console.log(chalk.gray('\n  These files have versioning/timestamps to prevent stale data from interfering.'));
      console.log(chalk.gray('  Use --prune flag to manually remove old entries if needed.'));
    }

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

/**
 * Prune old entries from learning JSON files (if --prune flag is used)
 */
async function pruneLearningFiles(
  projectRoot: string,
  config: any,
  options: ArchiveOptions
): Promise<void> {
  console.log(chalk.cyan('✂️  Pruning old entries from learning files...'));

  const pruningConfig = config.archive?.pruning || {};
  const pruneDays = options.pruneDays || pruningConfig.patternsRetentionDays || 180;

  // Prune patterns.json if explicitly requested or --prune flag is set
  if (options.prune || options.prunePatterns === true) {
    const patternsPath = path.resolve(projectRoot, '.devloop/patterns.json');
    if (await fs.pathExists(patternsPath)) {
      try {
        const patternLoader = new PatternLoader({
          filePath: patternsPath,
          filterOptions: {
            retentionDays: pruneDays,
            autoPrune: true,
          },
          autoPrune: true,
          validateOnLoad: true,
          debug: false,
        });
        const patterns = await patternLoader.load();
        // Patterns are already pruned by loader, file is saved by loader if needed
        console.log(chalk.gray(`  Pruned patterns.json (kept ${patterns.length} recent patterns)`));
      } catch (error) {
        console.log(chalk.yellow(`  Warning: Could not prune patterns.json: ${error}`));
      }
    }
  }

  // Prune observations.json if explicitly requested or --prune flag is set
  if (options.prune || options.pruneObservations === true) {
    const observationsPath = path.resolve(projectRoot, '.devloop/observations.json');
    if (await fs.pathExists(observationsPath)) {
      try {
        const observationLoader = new ObservationLoader({
          filePath: observationsPath,
          filterOptions: {
            retentionDays: pruneDays,
            autoPrune: true,
          },
          autoPrune: true,
          validateOnLoad: true,
          debug: false,
        });
        const observations = await observationLoader.load();
        // Observations are already pruned by loader, file is saved by loader if needed
        console.log(chalk.gray(`  Pruned observations.json (kept ${observations.length} recent observations)`));
      } catch (error) {
        console.log(chalk.yellow(`  Warning: Could not prune observations.json: ${error}`));
      }
    }
  }

  // Prune test-results.json if explicitly requested or --prune flag is set
  if (options.prune || options.pruneTestResults === true) {
    const testResultsPath = path.resolve(projectRoot, '.devloop/test-results.json/test-results.json');
    if (await fs.pathExists(testResultsPath)) {
      try {
        const testResultsLoader = new TestResultsLoader({
          filePath: testResultsPath,
          filterOptions: {
            retentionDays: pruneDays,
            autoPrune: true,
          },
          autoPrune: true,
          validateOnLoad: true,
          debug: false,
        });
        const testResults = await testResultsLoader.load();
        // Test results are already pruned by loader, file is saved by loader if needed
        console.log(chalk.gray(`  Pruned test-results.json (kept ${testResults.length} recent test results)`));
      } catch (error) {
        console.log(chalk.yellow(`  Warning: Could not prune test-results.json: ${error}`));
      }
    }
  }

  // Prune prd-set-state.json (remove old completed/cancelled states)
  const prdSetStatePath = path.resolve(projectRoot, '.devloop/prd-set-state.json');
  if (await fs.pathExists(prdSetStatePath)) {
    try {
      const validator = new SchemaValidator({
        autoFix: true,
        autoMigrate: false,
        backup: true,
        debug: false,
      });
      await validator.validatePrdSetStateFile(prdSetStatePath);
      // Validation auto-fixes schema issues, but we also need to prune old states
      const data = await fs.readJson(prdSetStatePath);
      const now = new Date();
      const prdStateRetentionDays = options.pruneDays || pruningConfig.prdStateRetentionDays || 90;
      const retentionMs = prdStateRetentionDays * 24 * 60 * 60 * 1000;

      let prunedCount = 0;
      for (const [prdId, state] of Object.entries(data.prdStates || {})) {
        const stateEntry = state as any;
        if (stateEntry.updatedAt) {
          const updatedAt = new Date(stateEntry.updatedAt);
          const daysSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
          
          // Remove old cancelled states (older than 30 days)
          if (stateEntry.status === 'cancelled' && daysSinceUpdate > 30) {
            delete data.prdStates[prdId];
            prunedCount++;
            continue;
          }
          
          // Remove old completed states (older than retentionDays)
          if (stateEntry.status === 'done' && daysSinceUpdate > prdStateRetentionDays) {
            delete data.prdStates[prdId];
            prunedCount++;
            continue;
          }
        }
      }

      if (prunedCount > 0) {
        data.updatedAt = new Date().toISOString();
        await fs.writeJson(prdSetStatePath, data, { spaces: 2 });
        console.log(chalk.gray(`  Pruned prd-set-state.json (removed ${prunedCount} old PRD states)`));
      } else {
        console.log(chalk.gray(`  prd-set-state.json (no old states to prune)`));
      }
    } catch (error) {
      console.log(chalk.yellow(`  Warning: Could not prune prd-set-state.json: ${error}`));
    }
  }

  console.log(chalk.green('✓ Pruning complete'));
}




