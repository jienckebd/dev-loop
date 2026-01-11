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
  private lastPruneTime: number = 0;
  private readonly PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

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
      backup: true,
      debug: this.debug,
    });
  }

  /**
   * Load patterns with filtering
   */
  async load(): Promise<PatternEntry[]> {
    logger.debug(`[PatternLoader] Loading patterns from: ${this.config.filePath}`);

    try {
      // Validate schema (auto-fixes and migrates if needed)
      if (this.config.validateOnLoad) {
        const validationResult = await this.validator.validatePatternsFile(this.config.filePath);
        if (!validationResult.valid && validationResult.errors.length > 0) {
          logger.warn(`[PatternLoader] Schema validation errors (some may have been auto-fixed): ${validationResult.errors.join('; ')}`);
        }
        if (validationResult.warnings.length > 0 && this.debug) {
          logger.debug(`[PatternLoader] Schema validation warnings: ${validationResult.warnings.join('; ')}`);
        }
      }

      // Check if file exists
      if (!(await fs.pathExists(this.config.filePath))) {
        logger.debug(`[PatternLoader] Patterns file does not exist: ${this.config.filePath}`);
        return [];
      }

      // Read file
      const data: PatternsFile = await fs.readJson(this.config.filePath);

      // Verify version
      if (data.version && data.version !== '2.0') {
        logger.warn(`[PatternLoader] Patterns file has unexpected version: ${data.version}. Expected v2.0. Schema may have been migrated.`);
      }

      // Auto-prune old entries if enabled and interval has passed
      let patterns = data.patterns || [];
      if (this.config.autoPrune && this.shouldPruneNow()) {
        const beforeCount = patterns.length;
        patterns = await this.pruneOldEntries(patterns, data);
        if (patterns.length < beforeCount) {
          // Save pruned file
          data.patterns = patterns;
          data.updatedAt = new Date().toISOString();
          await fs.writeJson(this.config.filePath, data, { spaces: 2 });
          logger.debug(`[PatternLoader] Auto-pruned ${beforeCount - patterns.length} old patterns`);
        }
        this.lastPruneTime = Date.now();
      }

      // Filter patterns
      const filtered = this.filterPatterns(patterns);

      logger.debug(`[PatternLoader] Loaded ${filtered.length} patterns (from ${patterns.length} total after pruning)`);
      return filtered;
    } catch (error) {
      logger.error(`[PatternLoader] Failed to load patterns: ${error}`);
      return [];
    }
  }

  /**
   * Update pattern lastUsedAt timestamp (marks pattern as recently used)
   */
  async markPatternUsed(patternId: string): Promise<void> {
    try {
      if (!(await fs.pathExists(this.config.filePath))) {
        return;
      }

      const data: PatternsFile = await fs.readJson(this.config.filePath);
      const pattern = data.patterns.find(p => p.id === patternId);
      
      if (pattern) {
        pattern.lastUsedAt = new Date().toISOString();
        data.updatedAt = new Date().toISOString();
        await fs.writeJson(this.config.filePath, data, { spaces: 2 });
        logger.debug(`[PatternLoader] Marked pattern ${patternId} as used`);
      }
    } catch (error) {
      logger.warn(`[PatternLoader] Failed to mark pattern as used: ${error}`);
    }
  }

  /**
   * Filter patterns based on filter options
   */
  private filterPatterns(patterns: PatternEntry[]): PatternEntry[] {
    const now = new Date();
    const filterOpts = this.config.filterOptions;

    return patterns.filter(pattern => {
      // Filter by expiration
      if (filterOpts.excludeExpired && pattern.expiresAt) {
        const expiresAt = new Date(pattern.expiresAt);
        if (expiresAt < now) {
          return false; // Expired
        }
      }

      // Filter by relevance score
      if (pattern.relevanceScore < filterOpts.relevanceThreshold) {
        return false; // Below threshold
      }

      // Filter by lastUsedAt (only load recently used patterns)
      const lastUsedAt = new Date(pattern.lastUsedAt);
      const daysSinceLastUse = (now.getTime() - lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastUse > filterOpts.lastUsedDays) {
        return false; // Not used recently enough
      }

      // Filter by retention days (based on createdAt)
      const createdAt = new Date(pattern.createdAt);
      const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation > filterOpts.retentionDays) {
        return false; // Too old
      }

      // Filter by prdId if specified
      if (filterOpts.prdId && pattern.prdId && pattern.prdId !== filterOpts.prdId) {
        return false; // Different PRD
      }

      // Filter by framework if specified
      if (filterOpts.framework && pattern.framework && pattern.framework !== filterOpts.framework) {
        return false; // Different framework
      }

      // Filter by category if specified
      if (filterOpts.category && pattern.category !== filterOpts.category) {
        return false; // Different category
      }

      return true;
    });
  }

  /**
   * Prune old entries (remove patterns not used in retentionDays+)
   */
  private async pruneOldEntries(patterns: PatternEntry[], data: PatternsFile): Promise<PatternEntry[]> {
    const now = new Date();
    const retentionDays = this.config.filterOptions.retentionDays;

    return patterns.filter(pattern => {
      const lastUsedAt = new Date(pattern.lastUsedAt);
      const daysSinceLastUse = (now.getTime() - lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
      
      // Keep if used recently OR if created recently (might be new)
      const createdAt = new Date(pattern.createdAt);
      const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      
      return daysSinceLastUse <= retentionDays || daysSinceCreation <= 30; // Keep if used recently OR created in last 30 days
    });
  }

  /**
   * Check if we should prune now (based on interval)
   */
  private shouldPruneNow(): boolean {
    if (!this.config.autoPrune) {
      return false;
    }

    const now = Date.now();
    if (now - this.lastPruneTime > this.PRUNE_INTERVAL_MS) {
      // Check file mtime to avoid pruning on every load (use sync since this is called during load)
      try {
        if (fs.existsSync(this.config.filePath)) {
          const stats = fs.statSync(this.config.filePath);
          const fileMtime = stats.mtimeMs;
          // Only prune if file hasn't been modified recently (prevents pruning on every read)
          return now - fileMtime > this.PRUNE_INTERVAL_MS;
        }
      } catch {
        // File might not exist yet
        return false;
      }
    }

    return false;
  }
}
