import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdManifestParser, PrdSetManifest } from './prd-manifest-parser';
import { PrdConfigParser, PrdMetadata } from './prd-config-parser';
import { PrdSet } from './prd-coordinator';
import { logger } from './logger';

export interface DiscoveredPrdSet {
  setId: string;
  indexPath: string;
  directory: string;
  manifest: PrdSetManifest;
  prdSet: PrdSet;
}

/**
 * PRD Set Discovery
 *
 * Discovers PRD sets by:
 * 1. Looking for index.md.yml in directories
 * 2. Scanning directories for PRD files and auto-detecting relationships
 */
export class PrdSetDiscovery {
  private manifestParser: PrdManifestParser;
  private configParser: PrdConfigParser;
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.manifestParser = new PrdManifestParser(debug);
    this.configParser = new PrdConfigParser(debug);
    this.debug = debug;
  }

  /**
   * Discover PRD set from directory or index file path
   */
  async discoverPrdSet(inputPath: string): Promise<DiscoveredPrdSet> {
    const resolvedPath = path.resolve(process.cwd(), inputPath);
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      return this.discoverFromDirectory(resolvedPath);
    } else if (stats.isFile()) {
      return this.discoverFromIndexFile(resolvedPath);
    } else {
      throw new Error(`Path is neither a directory nor a file: ${inputPath}`);
    }
  }

  /**
   * Discover PRD set from directory (looks for index.md.yml)
   */
  async discoverFromDirectory(dir: string): Promise<DiscoveredPrdSet> {
    if (this.debug) {
      logger.debug(`[PrdSetDiscovery] Discovering PRD set in directory: ${dir}`);
    }

    // Priority 1: Look for index.md.yml
    const indexPath = path.join(dir, 'index.md.yml');
    if (await fs.pathExists(indexPath)) {
      return this.discoverFromIndexFile(indexPath);
    }

    // Priority 2: Fallback to directory scanning
    if (this.debug) {
      logger.debug(`[PrdSetDiscovery] index.md.yml not found, scanning directory for PRD files`);
    }
    return this.discoverFromDirectoryScan(dir);
  }

  /**
   * Discover PRD set from index.md.yml file
   */
  async discoverFromIndexFile(indexPath: string): Promise<DiscoveredPrdSet> {
    if (this.debug) {
      logger.debug(`[PrdSetDiscovery] Discovering from index file: ${indexPath}`);
    }

    const manifest = await this.manifestParser.parseIndexFile(indexPath);
    const directory = path.dirname(indexPath);

    // Build PrdSet from manifest
    const prdSet: PrdSet = {
      prds: [
        {
          id: manifest.parentPrd.id,
          path: manifest.parentPrd.path,
          metadata: manifest.parentPrd.metadata,
        },
        ...manifest.childPrds.map(child => ({
          id: child.id,
          path: child.path,
          metadata: child.metadata,
        })),
      ],
    };

    return {
      setId: manifest.parentPrd.id,
      indexPath,
      directory,
      manifest,
      prdSet,
    };
  }

  /**
   * Discover PRD set by scanning directory and auto-detecting relationships
   */
  async discoverFromDirectoryScan(dir: string): Promise<DiscoveredPrdSet> {
    if (this.debug) {
      logger.debug(`[PrdSetDiscovery] Scanning directory for PRD files: ${dir}`);
    }

    // Find all PRD files in directory
    const files = await fs.readdir(dir);
    const prdFiles = files.filter(f =>
      f.endsWith('.md.yml') || f.endsWith('.md')
    );

    const prds: Array<{ id: string; path: string; metadata: PrdMetadata }> = [];
    let parentPrd: { id: string; path: string; metadata: PrdMetadata } | null = null;

    // Parse all PRD files
    for (const file of prdFiles) {
      const filePath = path.join(dir, file);
      try {
        const metadata = await this.configParser.parsePrdMetadata(filePath);

        if (!metadata?.prd) {
          continue;
        }

        const prdId = metadata.prd.id;
        const prdEntry = {
          id: prdId,
          path: filePath,
          metadata,
        };

        // Check if this is a parent PRD (status: split)
        if (metadata.prd.status === 'split') {
          if (parentPrd) {
            if (this.debug) {
              logger.warn(`[PrdSetDiscovery] Multiple parent PRDs found, using first: ${parentPrd.id}`);
            }
          } else {
            parentPrd = prdEntry;
          }
        }

        prds.push(prdEntry);
      } catch (error: any) {
        if (this.debug) {
          logger.debug(`[PrdSetDiscovery] Failed to parse PRD file ${file}: ${error.message}`);
        }
      }
    }

    if (!parentPrd) {
      throw new Error(`No parent PRD (status: split) found in directory: ${dir}`);
    }

    // Build manifest from discovered PRDs
    const childPrds = prds
      .filter(p => p.id !== parentPrd!.id && p.metadata.prd?.parentPrd === parentPrd!.id)
      .map(p => ({
        id: p.id,
        path: p.path,
        sequence: p.metadata.prd?.prdSequence || 0,
        metadata: p.metadata,
      }))
      .sort((a, b) => a.sequence - b.sequence);

    const manifest: PrdSetManifest = {
      parentPrd: {
        id: parentPrd.id,
        path: parentPrd.path,
        metadata: parentPrd.metadata,
      },
      childPrds,
    };

    const prdSet: PrdSet = {
      prds: prds.map(p => ({
        id: p.id,
        path: p.path,
        metadata: p.metadata,
      })),
    };

    // Use parent PRD path as index path (even though it might not be named index.md.yml)
    return {
      setId: parentPrd.id,
      indexPath: parentPrd.path,
      directory: dir,
      manifest,
      prdSet,
    };
  }

  /**
   * List all discovered PRD sets in planning directory
   */
  async listPrdSets(planningDir: string = '.taskmaster/planning'): Promise<DiscoveredPrdSet[]> {
    const resolvedDir = path.resolve(process.cwd(), planningDir);

    if (!await fs.pathExists(resolvedDir)) {
      return [];
    }

    const sets: DiscoveredPrdSet[] = [];
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(resolvedDir, entry.name);
        try {
          const set = await this.discoverFromDirectory(subDir);
          sets.push(set);
        } catch (error: any) {
          if (this.debug) {
            logger.debug(`[PrdSetDiscovery] Failed to discover PRD set in ${subDir}: ${error.message}`);
          }
          // Continue to next directory
        }
      }
    }

    return sets;
  }
}

