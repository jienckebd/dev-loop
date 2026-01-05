import * as fs from 'fs-extra';
import * as path from 'path';
import { PrdConfigParser, PrdMetadata } from './prd-config-parser';
import { logger } from './logger';

export interface PrdSetManifest {
  parentPrd: {
    id: string;
    path: string;
    metadata: PrdMetadata;
  };
  childPrds: Array<{
    id: string;
    path: string;
    sequence: number;
    metadata: PrdMetadata;
  }>;
}

/**
 * PRD Manifest Parser
 *
 * Parses PRD set index files (index.md.yml) to discover and validate PRD sets.
 * Supports parsing of parent PRD with status: split and child PRD relationships.
 */
export class PrdManifestParser {
  private configParser: PrdConfigParser;
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.configParser = new PrdConfigParser(debug);
    this.debug = debug;
  }

  /**
   * Parse PRD set index file (index.md.yml)
   */
  async parseIndexFile(indexPath: string): Promise<PrdSetManifest> {
    if (!await fs.pathExists(indexPath)) {
      throw new Error(`PRD set index file not found: ${indexPath}`);
    }

    if (this.debug) {
      logger.debug(`[PrdManifestParser] Parsing index file: ${indexPath}`);
    }

    // Parse the index file metadata
    const parentMetadata = await this.configParser.parsePrdMetadata(indexPath);

    if (!parentMetadata?.prd) {
      throw new Error(`Invalid PRD set index file: missing prd metadata in ${indexPath}`);
    }

    if (parentMetadata.prd.status !== 'split') {
      throw new Error(`PRD set index file must have status: split, found: ${parentMetadata.prd.status}`);
    }

    const parentId = parentMetadata.prd.id;
    const indexDir = path.dirname(indexPath);

    // Extract child PRDs from relationships.dependedOnBy
    const childPrds: PrdSetManifest['childPrds'] = [];
    const dependedOnBy = parentMetadata.relationships?.dependedOnBy || [];

    for (const dep of dependedOnBy) {
      const childPrdId = dep.prd;

      // Try to find child PRD file in same directory
      const childPrdPath = await this.findChildPrdFile(indexDir, childPrdId);

      if (!childPrdPath) {
        if (this.debug) {
          logger.warn(`[PrdManifestParser] Child PRD file not found: ${childPrdId}`);
        }
        continue;
      }

      // Parse child PRD metadata
      const childMetadata = await this.configParser.parsePrdMetadata(childPrdPath);

      if (!childMetadata?.prd) {
        if (this.debug) {
          logger.warn(`[PrdManifestParser] Invalid child PRD metadata: ${childPrdPath}`);
        }
        continue;
      }

      // Validate parent/child relationship
      if (childMetadata.prd.parentPrd !== parentId) {
        if (this.debug) {
          logger.warn(`[PrdManifestParser] Child PRD ${childPrdId} parentPrd mismatch: expected ${parentId}, found ${childMetadata.prd.parentPrd}`);
        }
        continue;
      }

      const sequence = childMetadata.prd.prdSequence || 0;

      childPrds.push({
        id: childPrdId,
        path: childPrdPath,
        sequence,
        metadata: childMetadata,
      });
    }

    // Sort by sequence
    childPrds.sort((a, b) => a.sequence - b.sequence);

    return {
      parentPrd: {
        id: parentId,
        path: indexPath,
        metadata: parentMetadata,
      },
      childPrds,
    };
  }

  /**
   * Find child PRD file in directory
   */
  private async findChildPrdFile(dir: string, prdId: string): Promise<string | null> {
    // Try common patterns: {id}.md.yml, {id}.md, {sequence}-{id}.md.yml
    const patterns = [
      `${prdId}.md.yml`,
      `${prdId}.md`,
      `*-${prdId}.md.yml`,
      `*-${prdId}.md`,
    ];

    for (const pattern of patterns) {
      const files = await fs.readdir(dir);
      const matchingFiles = files.filter(f => {
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace('*', '.*'));
          return regex.test(f);
        }
        return f === pattern;
      });

      if (matchingFiles.length > 0) {
        const filePath = path.join(dir, matchingFiles[0]);
        // Verify it's actually the right PRD by checking metadata
        try {
          const metadata = await this.configParser.parsePrdMetadata(filePath);
          if (metadata?.prd?.id === prdId) {
            return filePath;
          }
        } catch (error) {
          // Continue to next pattern
        }
      }
    }

    return null;
  }

  /**
   * Extract PRD relationships and dependencies from frontmatter
   */
  extractRelationships(metadata: PrdMetadata): {
    dependsOn: string[];
    dependedOnBy: string[];
  } {
    const dependsOn: string[] = [];
    const dependedOnBy: string[] = [];

    // Extract from relationships.dependsOn
    if (metadata.relationships?.dependsOn) {
      for (const dep of metadata.relationships.dependsOn) {
        if (typeof dep === 'string') {
          dependsOn.push(dep);
        } else if (dep.prd) {
          dependsOn.push(dep.prd);
        }
      }
    }

    // Extract from relationships.dependedOnBy
    if (metadata.relationships?.dependedOnBy) {
      for (const dep of metadata.relationships.dependedOnBy) {
        if (typeof dep === 'string') {
          dependedOnBy.push(dep);
        } else if (dep.prd) {
          dependedOnBy.push(dep.prd);
        }
      }
    }

    return { dependsOn, dependedOnBy };
  }

  /**
   * Extract execution sequence from PRD metadata
   */
  extractExecutionSequence(manifest: PrdSetManifest): {
    prdId: string;
    sequence: number;
    dependsOn: string[];
  }[] {
    const sequence: Array<{ prdId: string; sequence: number; dependsOn: string[] }> = [];

    // Add parent PRD (if it has phases, it might be executable)
    if (manifest.parentPrd.metadata.requirements?.phases && manifest.parentPrd.metadata.requirements.phases.length > 0) {
      const parentRelationships = this.extractRelationships(manifest.parentPrd.metadata);
      sequence.push({
        prdId: manifest.parentPrd.id,
        sequence: 0,
        dependsOn: parentRelationships.dependsOn,
      });
    }

    // Add child PRDs
    for (const child of manifest.childPrds) {
      const childRelationships = this.extractRelationships(child.metadata);
      sequence.push({
        prdId: child.id,
        sequence: child.sequence,
        dependsOn: childRelationships.dependsOn,
      });
    }

    return sequence;
  }
}

