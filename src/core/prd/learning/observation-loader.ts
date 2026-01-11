/**
 * Observation Loader
 *
 * Loads observations from observations.json with filtering to prevent stale data from interfering.
 * Filters by expiration, relevance score, createdAt, and optional context (prdId, phaseId).
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { SchemaValidator } from './schema-validator';
import { ObservationsFile, ObservationEntry, ObservationFilterOptions } from './types';

/**
 * Observation Loader Configuration
 */
export interface ObservationLoaderConfig {
  filePath: string;
  filterOptions?: ObservationFilterOptions;
  autoPrune?: boolean; // Auto-prune old entries when loading (default: true)
  validateOnLoad?: boolean; // Validate schema on load (default: true)
  debug?: boolean;
}

/**
 * Loads observations from JSON file with filtering
 */
export class ObservationLoader {
  private config: Required<ObservationLoaderConfig>;
  private validator: SchemaValidator;
  private debug: boolean;
  private lastPruneTime: number = 0;
  private readonly PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(config: ObservationLoaderConfig) {
    this.config = {
      filePath: config.filePath,
      filterOptions: {
        retentionDays: config.filterOptions?.retentionDays || 180,
        relevanceThreshold: config.filterOptions?.relevanceThreshold || 0.5,
        prdId: config.filterOptions?.prdId,
        phaseId: config.filterOptions?.phaseId,
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
   * Load observations with filtering
   */
  async load(): Promise<ObservationEntry[]> {
    logger.debug(`[ObservationLoader] Loading observations from: ${this.config.filePath}`);

    try {
      // Validate schema (auto-fixes and migrates if needed)
      if (this.config.validateOnLoad) {
        const validationResult = await this.validator.validateObservationsFile(this.config.filePath);
        if (!validationResult.valid && validationResult.errors.length > 0) {
          logger.warn(`[ObservationLoader] Schema validation errors (some may have been auto-fixed): ${validationResult.errors.join('; ')}`);
        }
        if (validationResult.warnings.length > 0 && this.debug) {
          logger.debug(`[ObservationLoader] Schema validation warnings: ${validationResult.warnings.join('; ')}`);
        }
      }

      // Check if file exists
      if (!(await fs.pathExists(this.config.filePath))) {
        logger.debug(`[ObservationLoader] Observations file does not exist: ${this.config.filePath}`);
        return [];
      }

      // Read file
      const data: ObservationsFile = await fs.readJson(this.config.filePath);

      // Verify version
      if (data.version && data.version !== '2.0') {
        logger.warn(`[ObservationLoader] Observations file has unexpected version: ${data.version}. Expected v2.0. Schema may have been migrated.`);
      }

      // Auto-prune old entries if enabled and interval has passed
      let observations = data.observations || [];
      if (this.config.autoPrune && this.shouldPruneNow()) {
        const beforeCount = observations.length;
        observations = await this.pruneOldEntries(observations, data);
        if (observations.length < beforeCount) {
          // Save pruned file
          data.observations = observations;
          data.updatedAt = new Date().toISOString();
          await fs.writeJson(this.config.filePath, data, { spaces: 2 });
          logger.debug(`[ObservationLoader] Auto-pruned ${beforeCount - observations.length} old observations`);
        }
        this.lastPruneTime = Date.now();
      }

      // Filter observations
      const filtered = this.filterObservations(observations);

      logger.debug(`[ObservationLoader] Loaded ${filtered.length} observations (from ${observations.length} total after pruning)`);
      return filtered;
    } catch (error) {
      logger.error(`[ObservationLoader] Failed to load observations: ${error}`);
      return [];
    }
  }

  /**
   * Filter observations based on filter options
   */
  private filterObservations(observations: ObservationEntry[]): ObservationEntry[] {
    const now = new Date();
    const filterOpts = this.config.filterOptions;

    return observations.filter(observation => {
      // Filter by expiration
      if (filterOpts.excludeExpired && observation.expiresAt) {
        const expiresAt = new Date(observation.expiresAt);
        if (expiresAt < now) {
          return false; // Expired
        }
      }

      // Filter by relevance score
      if (observation.relevanceScore < filterOpts.relevanceThreshold) {
        return false; // Below threshold
      }

      // Filter by createdAt (only load recent observations)
      const createdAt = new Date(observation.createdAt);
      const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation > filterOpts.retentionDays) {
        return false; // Too old
      }

      // Filter by prdId if specified
      if (filterOpts.prdId && observation.prdId !== filterOpts.prdId) {
        return false; // Different PRD
      }

      // Filter by phaseId if specified
      if (filterOpts.phaseId !== undefined && observation.phaseId !== undefined && observation.phaseId !== filterOpts.phaseId) {
        return false; // Different phase
      }

      // Filter by category if specified
      if (filterOpts.category && observation.category !== filterOpts.category) {
        return false; // Different category
      }

      return true;
    });
  }

  /**
   * Prune old entries (remove observations older than retentionDays)
   */
  private async pruneOldEntries(observations: ObservationEntry[], data: ObservationsFile): Promise<ObservationEntry[]> {
    const now = new Date();
    const retentionDays = this.config.filterOptions.retentionDays;

    return observations.filter(observation => {
      const createdAt = new Date(observation.createdAt);
      const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      
      return daysSinceCreation <= retentionDays;
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
