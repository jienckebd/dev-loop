/**
 * Pattern Loader
 *
 * Loads patterns from patterns.json with filtering to prevent stale data from interfering.
 * Filters by expiration, relevance score, lastUsedAt, and optional context (prdId, framework).
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { SchemaValidator } from './schema-validator';
import { PatternsFile, PatternEntry, PatternFilterOptions } from './types';
import { PatternLibraryManager } from '../../analysis/pattern-library-manager';
import { PrdPattern } from '../../../config/schema/pattern-library';

/**
 * Pattern Loader Configuration
 */
export interface PatternLoaderConfig {
  filePath: string;
  filterOptions?: PatternFilterOptions;
  autoPrune?: boolean; // Auto-prune old entries when loading (default: true)
  validateOnLoad?: boolean; // Validate schema on load (default: true)
  debug?: boolean;
}

/**
 * Loads patterns from JSON file with filtering
 */
export class PatternLoader {
  private config: Required<PatternLoaderConfig>;
  private validator: SchemaValidator;
  private debug: boolean;
  private patternLibraryManager: PatternLibraryManager;

  constructor(config: PatternLoaderConfig) {
    this.config = {
      filePath: config.filePath,
      filterOptions: {
        retentionDays: config.filterOptions?.retentionDays || 180,
        relevanceThreshold: config.filterOptions?.relevanceThreshold || 0.5,
        lastUsedDays: config.filterOptions?.lastUsedDays || 90,
        prdId: config.filterOptions?.prdId,
        framework: config.filterOptions?.framework,
        category: config.filterOptions?.category,
        excludeExpired: config.filterOptions?.excludeExpired !== false,
        autoPrune: config.filterOptions?.autoPrune !== false,
      },
      autoPrune: config.autoPrune !== false,
      validateOnLoad: config.validateOnLoad !== false,
      debug: config.debug || false,
    };
    this.debug = this.config.debug;
    this.validator = new SchemaValidator({
      autoFix: true,
      autoMigrate: true,
      backup: false, // Disabled: backup files should never be created
      debug: this.debug,
    });
    // Initialize PatternLibraryManager for unified storage
    const projectRoot = path.dirname(config.filePath).replace(/\/(\.devloop|\.taskmaster).*$/, '') || process.cwd();
    this.patternLibraryManager = new PatternLibraryManager({
      projectRoot,
      debug: this.debug,
    });
  }

  /**
   * Load patterns with filtering using PatternLibraryManager.
   * Also migrates from old patterns.json format if it exists.
   */
  async load(): Promise<PatternEntry[]> {
    logger.debug(`[PatternLoader] Loading patterns from: ${this.config.filePath}`);

    try {
      // Migrate from old patterns.json if it exists (backward compatibility)
      if (await fs.pathExists(this.config.filePath)) {
        // Validate schema (auto-fixes and migrates if needed)
        if (this.config.validateOnLoad) {
          const validationResult = await this.validator.validatePatternsFile(this.config.filePath);
          if (!validationResult.valid && validationResult.errors.length > 0) {
            const warningMsg = `Schema validation errors (some may have been auto-fixed): ${validationResult.errors.join('; ')}`;
            logger.warn(`[PatternLoader] ${warningMsg}`);
            // Record warning in build metrics if available
            try {
              const { getBuildMetrics } = await import('../../metrics/build');
              getBuildMetrics().recordWarning('PatternLoader', warningMsg);
            } catch {
              // Build metrics not available
            }
          }
        }

        // Read old file and migrate to PatternLibraryManager
        const data: PatternsFile = await fs.readJson(this.config.filePath);

        if (data.patterns && data.patterns.length > 0) {
          // Migrate patterns to PatternLibraryManager
          await this.patternLibraryManager.load();
          for (const pattern of data.patterns) {
            const prdPattern: PrdPattern = {
              id: pattern.id,
              createdAt: pattern.createdAt,
              lastUsedAt: pattern.lastUsedAt,
              relevanceScore: pattern.relevanceScore,
              expiresAt: pattern.expiresAt || null,
              prdId: pattern.prdId,
              framework: pattern.framework,
              category: pattern.category,
              pattern: pattern.pattern,
              examples: pattern.examples,
              metadata: pattern.metadata,
            };
            this.patternLibraryManager.addPrdPattern(prdPattern);
          }
          await this.patternLibraryManager.save();
          logger.debug(`[PatternLoader] Migrated ${data.patterns.length} patterns to PatternLibraryManager`);
        }
      }

      // Load filtered patterns from PatternLibraryManager
      const prdPatterns = await this.patternLibraryManager.filterPrdPatterns({
        retentionDays: this.config.filterOptions.retentionDays,
        relevanceThreshold: this.config.filterOptions.relevanceThreshold,
        lastUsedDays: this.config.filterOptions.lastUsedDays,
        prdId: this.config.filterOptions.prdId,
        framework: this.config.filterOptions.framework,
        category: this.config.filterOptions.category,
        excludeExpired: this.config.filterOptions.excludeExpired,
      });

      // Convert PrdPattern to PatternEntry format
      const patterns: PatternEntry[] = prdPatterns.map(p => ({
        id: p.id,
        createdAt: p.createdAt,
        lastUsedAt: p.lastUsedAt,
        relevanceScore: p.relevanceScore,
        expiresAt: p.expiresAt || undefined,
        prdId: p.prdId,
        framework: p.framework,
        category: p.category,
        pattern: p.pattern,
        examples: p.examples,
        metadata: p.metadata,
      }));

      // Auto-prune if enabled
      if (this.config.autoPrune) {
        const prunedCount = await this.patternLibraryManager.prune(this.config.filterOptions.retentionDays || 180);
        if (prunedCount > 0 && this.debug) {
          logger.debug(`[PatternLoader] Pruned ${prunedCount} old patterns`);
        }
      }

      logger.debug(`[PatternLoader] Loaded ${patterns.length} patterns from PatternLibraryManager`);
      return patterns;
    } catch (error) {
      logger.error(`[PatternLoader] Failed to load patterns: ${error}`);
      return [];
    }
  }

  /**
   * Update pattern lastUsedAt timestamp (marks pattern as recently used)
   * Delegates to PatternLibraryManager.
   */
  async markPatternUsed(patternId: string): Promise<void> {
    try {
      await this.patternLibraryManager.markPrdPatternUsed(patternId);
    } catch (error) {
      logger.warn(`[PatternLoader] Failed to mark pattern as used: ${error}`);
    }
  }

  // Filtering, pruning, and file I/O operations removed - now delegated to PatternLibraryManager
  // The filterPrdPatterns() method in PatternLibraryManager handles all filtering logic
  // The prune() method in PatternLibraryManager handles pruning
}
