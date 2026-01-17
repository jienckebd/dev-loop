/**
 * Apply Changes Node
 *
 * LangGraph node that applies validated code changes to the filesystem.
 * Supports create, update, delete, and patch operations.
 */

import { CodeChanges } from '../../../../types';
import { WorkflowState, ApplyResult } from '../state';
import { Config } from '../../../../config/schema/core';
import { logger } from '../../../utils/logger';
import { findFuzzyMatch, findAggressiveMatch } from '../../../utils/string-matcher';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface ApplyChangesNodeConfig {
  config: Config;
  debug?: boolean;
  // Optional rollback manager for recovery
  rollbackManager?: {
    createCheckpoint: (files: string[]) => Promise<string>;
    rollback: (checkpointId: string) => Promise<void>;
  };
}

/**
 * Create the apply changes node function
 */
export function applyChanges(nodeConfig: ApplyChangesNodeConfig) {
  const { config, debug, rollbackManager } = nodeConfig;

  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    // Skip if validation failed
    if (!state.validationResult?.valid) {
      logger.warn('[ApplyChanges] Skipping - validation failed');
      return {
        status: 'applying',
        applyResult: {
          success: false,
          filesModified: [],
          filesCreated: [],
          filesDeleted: [],
          errors: ['Validation failed'],
          rollbackAvailable: false,
        },
      };
    }

    // Skip if no code changes
    if (!state.codeChanges || !state.codeChanges.files.length) {
      logger.warn('[ApplyChanges] No code changes to apply');
      return {
        status: 'applying',
        applyResult: {
          success: false,
          filesModified: [],
          filesCreated: [],
          filesDeleted: [],
          errors: ['No code changes'],
          rollbackAvailable: false,
        },
      };
    }

    try {
      if (debug) {
        logger.debug(`[ApplyChanges] Applying ${state.codeChanges.files.length} file change(s)`);
      }

      const filesModified: string[] = [];
      const filesCreated: string[] = [];
      const filesDeleted: string[] = [];
      const errors: string[] = [];
      let checkpointId: string | undefined;

      // Create rollback checkpoint if available
      if (rollbackManager) {
        const filePaths = state.codeChanges.files.map(f => f.path);
        try {
          checkpointId = await rollbackManager.createCheckpoint(filePaths);
          if (debug) {
            logger.debug(`[ApplyChanges] Created rollback checkpoint: ${checkpointId}`);
          }
        } catch (error) {
          logger.warn(`[ApplyChanges] Failed to create checkpoint: ${error}`);
        }
      }

      // Apply each file change
      for (const file of state.codeChanges.files) {
        try {
          const result = await applyFileChange(file, debug);
          
          switch (result.type) {
            case 'created':
              filesCreated.push(file.path);
              break;
            case 'modified':
              filesModified.push(file.path);
              break;
            case 'deleted':
              filesDeleted.push(file.path);
              break;
          }

          if (result.error) {
            errors.push(`${file.path}: ${result.error}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`${file.path}: ${errorMessage}`);
          logger.error(`[ApplyChanges] Failed to apply ${file.path}: ${errorMessage}`);
        }
      }

      const success = errors.length === 0;
      const allFiles = [...filesModified, ...filesCreated];

      logger.info(`[ApplyChanges] Applied changes: ${filesCreated.length} created, ${filesModified.length} modified, ${filesDeleted.length} deleted`);

      return {
        status: 'applying',
        applyResult: {
          success,
          filesModified,
          filesCreated,
          filesDeleted,
          errors: errors.length > 0 ? errors : undefined,
          rollbackAvailable: !!checkpointId,
        },
        filesModified: allFiles,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[ApplyChanges] Error: ${errorMessage}`);

      return {
        status: 'failed',
        applyResult: {
          success: false,
          filesModified: [],
          filesCreated: [],
          filesDeleted: [],
          errors: [errorMessage],
          rollbackAvailable: false,
        },
        error: `Failed to apply changes: ${errorMessage}`,
      };
    }
  };
}

interface ApplyFileResult {
  type: 'created' | 'modified' | 'deleted' | 'unchanged';
  error?: string;
}

/**
 * Apply a single file change
 */
async function applyFileChange(
  file: CodeChanges['files'][0],
  debug?: boolean
): Promise<ApplyFileResult> {
  const fullPath = path.resolve(process.cwd(), file.path);
  const dir = path.dirname(fullPath);

  switch (file.operation) {
    case 'create':
      await fs.ensureDir(dir);
      await fs.writeFile(fullPath, file.content || '', 'utf-8');
      if (debug) {
        logger.debug(`[ApplyChanges] Created: ${file.path}`);
      }
      return { type: 'created' };

    case 'update':
      if (file.content) {
        await fs.ensureDir(dir);
        await fs.writeFile(fullPath, file.content, 'utf-8');
        if (debug) {
          logger.debug(`[ApplyChanges] Updated: ${file.path}`);
        }
        return { type: 'modified' };
      } else if (file.patches && file.patches.length > 0) {
        return await applyPatches(fullPath, file.patches, debug);
      }
      return { type: 'unchanged', error: 'No content or patches' };

    case 'patch':
      if (file.patches && file.patches.length > 0) {
        return await applyPatches(fullPath, file.patches, debug);
      }
      return { type: 'unchanged', error: 'No patches provided' };

    case 'delete':
      if (await fs.pathExists(fullPath)) {
        await fs.remove(fullPath);
        if (debug) {
          logger.debug(`[ApplyChanges] Deleted: ${file.path}`);
        }
        return { type: 'deleted' };
      }
      return { type: 'unchanged', error: 'File does not exist' };

    default:
      return { type: 'unchanged', error: `Unknown operation: ${file.operation}` };
  }
}

/**
 * Apply patches to a file
 */
async function applyPatches(
  fullPath: string,
  patches: Array<{ search: string; replace: string }>,
  debug?: boolean
): Promise<ApplyFileResult> {
  if (!await fs.pathExists(fullPath)) {
    return { type: 'unchanged', error: 'File does not exist for patching' };
  }

  let content = await fs.readFile(fullPath, 'utf-8');
  let patchesApplied = 0;

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];

    // Try exact match first
    if (content.includes(patch.search)) {
      content = content.replace(patch.search, patch.replace);
      patchesApplied++;
      if (debug) {
        logger.debug(`[ApplyChanges] Applied patch ${i + 1} using exact match`);
      }
      continue;
    }

    // Try fuzzy match
    const fuzzyMatch = findFuzzyMatch(content, patch.search);
    if (fuzzyMatch) {
      content = content.replace(fuzzyMatch, patch.replace);
      patchesApplied++;
      if (debug) {
        logger.debug(`[ApplyChanges] Applied patch ${i + 1} using fuzzy match`);
      }
      continue;
    }

    // Try aggressive match
    const aggressiveResult = findAggressiveMatch(content, patch.search, patch.replace);
    if (aggressiveResult) {
      content = aggressiveResult.newContent;
      patchesApplied++;
      if (debug) {
        logger.debug(`[ApplyChanges] Applied patch ${i + 1} using aggressive match at line ${aggressiveResult.lineNumber}`);
      }
      continue;
    }

    // Patch failed
    logger.warn(`[ApplyChanges] Could not apply patch ${i + 1}`);
  }

  if (patchesApplied > 0) {
    await fs.writeFile(fullPath, content, 'utf-8');
    return { type: 'modified' };
  }

  return { type: 'unchanged', error: `Failed to apply ${patches.length - patchesApplied} patch(es)` };
}
