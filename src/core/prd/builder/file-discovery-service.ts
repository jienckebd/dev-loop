/**
 * File Discovery Service
 *
 * Service for discovering planning documents and PRD sets using fast-glob.
 * Provides recursive file scanning with proper filtering and path handling.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import fg from 'fast-glob';
import { PrdSetDiscovery } from '../set/discovery';
import { logger } from '../../utils/logger';

/**
 * Planning document discovery result
 */
export interface PlanningDocument {
  path: string;
  relativePath: string;
  name: string;
}

/**
 * PRD set discovery result
 */
export interface PrdSetDiscoveryResult {
  path: string;
  relativePath: string;
  setId: string;
  indexFile: string;
}

/**
 * File Discovery Service Configuration
 */
export interface FileDiscoveryServiceConfig {
  debug?: boolean;
}

/**
 * File Discovery Service
 *
 * Uses fast-glob for efficient recursive file discovery.
 * 10-20% faster than traditional glob libraries.
 */
export class FileDiscoveryService {
  private debug: boolean;
  private prdSetDiscovery: PrdSetDiscovery;

  constructor(config: FileDiscoveryServiceConfig = {}) {
    this.debug = config.debug || false;
    this.prdSetDiscovery = new PrdSetDiscovery(this.debug);
  }

  /**
   * Discover planning documents (*.md files) recursively
   * Excludes index.md.yml files (PRD set indexes)
   */
  async discoverPlanningDocuments(
    preProductionDir: string
  ): Promise<PlanningDocument[]> {
    if (this.debug) {
      logger.debug(`[FileDiscoveryService] Discovering planning documents in: ${preProductionDir}`);
    }

    // Ensure directory exists
    const resolvedDir = path.resolve(process.cwd(), preProductionDir);
    if (!(await fs.pathExists(resolvedDir))) {
      if (this.debug) {
        logger.warn(`[FileDiscoveryService] Directory does not exist: ${resolvedDir}`);
      }
      return [];
    }

    try {
      // Use fast-glob for recursive scanning
      // Pattern: **/*.md
      // Ignore: **/index.md.yml, **/node_modules/**, **/.git/**
      const files = await fg('**/*.md', {
        cwd: resolvedDir,
        absolute: true,
        ignore: [
          '**/index.md.yml',
          '**/node_modules/**',
          '**/.git/**',
          '**/.devloop/**',
          '**/.ddev/**',
        ],
      });

      if (this.debug) {
        logger.debug(`[FileDiscoveryService] Found ${files.length} planning documents`);
      }

      // Transform files into result format
      const documents: PlanningDocument[] = files.map(filePath => {
        const relativePath = path.relative(resolvedDir, filePath);
        const name = path.basename(filePath, path.extname(filePath));

        return {
          path: filePath,
          relativePath,
          name,
        };
      });

      // Sort by relative path for consistent ordering
      documents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

      return documents;
    } catch (error) {
      logger.error(`[FileDiscoveryService] Failed to discover planning documents: ${error}`);
      throw error;
    }
  }

  /**
   * Discover PRD sets (directories containing index.md.yml)
   */
  async discoverPrdSets(
    preProductionDir: string
  ): Promise<PrdSetDiscoveryResult[]> {
    if (this.debug) {
      logger.debug(`[FileDiscoveryService] Discovering PRD sets in: ${preProductionDir}`);
    }

    // Ensure directory exists
    const resolvedDir = path.resolve(process.cwd(), preProductionDir);
    if (!(await fs.pathExists(resolvedDir))) {
      if (this.debug) {
        logger.warn(`[FileDiscoveryService] Directory does not exist: ${resolvedDir}`);
      }
      return [];
    }

    try {
      // Use fast-glob to find all index.md.yml files
      // Pattern: **/index.md.yml
      const indexFiles = await fg('**/index.md.yml', {
        cwd: resolvedDir,
        absolute: true,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.devloop/**',
          '**/.ddev/**',
        ],
      });

      if (this.debug) {
        logger.debug(`[FileDiscoveryService] Found ${indexFiles.length} PRD set index files`);
      }

      // For each found index, use PrdSetDiscovery to get setId
      const prdSets: PrdSetDiscoveryResult[] = [];

      for (const indexFile of indexFiles) {
        try {
          const discovered = await this.prdSetDiscovery.discoverFromIndexFile(indexFile);
          const relativePath = path.relative(resolvedDir, discovered.directory);

          prdSets.push({
            path: discovered.directory,
            relativePath,
            setId: discovered.setId,
            indexFile,
          });
        } catch (error) {
          // Skip invalid PRD sets but log warning
          logger.warn(`[FileDiscoveryService] Failed to discover PRD set from ${indexFile}: ${error}`);
          if (this.debug) {
            logger.debug(`[FileDiscoveryService] Error details: ${error instanceof Error ? error.stack : String(error)}`);
          }
        }
      }

      // Sort by setId for consistent ordering
      prdSets.sort((a, b) => a.setId.localeCompare(b.setId));

      return prdSets;
    } catch (error) {
      logger.error(`[FileDiscoveryService] Failed to discover PRD sets: ${error}`);
      throw error;
    }
  }

  /**
   * Check if directory exists, create if needed (for preProductionDir)
   */
  async ensureDirectoryExists(
    dir: string,
    createIfMissing: boolean = false
  ): Promise<boolean> {
    const resolvedDir = path.resolve(process.cwd(), dir);

    const exists = await fs.pathExists(resolvedDir);

    if (!exists && createIfMissing) {
      try {
        await fs.ensureDir(resolvedDir);
        if (this.debug) {
          logger.debug(`[FileDiscoveryService] Created directory: ${resolvedDir}`);
        }
        return true;
      } catch (error) {
        logger.error(`[FileDiscoveryService] Failed to create directory ${resolvedDir}: ${error}`);
        return false;
      }
    }

    return exists;
  }
}
