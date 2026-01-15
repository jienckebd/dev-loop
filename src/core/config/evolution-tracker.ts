/**
 * Config Evolution Tracker
 *
 * Tracks changes to devloop.config.js over time.
 * Learns from manual edits to suggest better defaults.
 * Supports config version history and migration suggestions.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * A single config change
 */
export interface ConfigChange {
  path: string; // e.g., "ai.provider", "testing.timeout"
  from: any;
  to: any;
  reason?: string;
  source: 'manual' | 'init' | 'auto-optimization';
}

/**
 * A config version entry
 */
export interface ConfigVersion {
  version: string;
  changes: ConfigChange[];
  timestamp: string;
}

/**
 * Learned preferences from manual edits
 */
export interface LearnedPreferences {
  commonOverrides?: Record<string, any>; // Paths that are often manually overridden
  ignoredFeatures?: string[]; // Features that are consistently disabled
  alwaysEnabled?: string[]; // Features that are consistently enabled
}

/**
 * Migration suggestion
 */
export interface MigrationSuggestion {
  fromVersion: string;
  toVersion: string;
  changes: string[];
  automatic: boolean;
}

/**
 * Full config evolution data
 */
export interface ConfigEvolution {
  versions?: ConfigVersion[];
  learnedPreferences?: LearnedPreferences;
  migrations?: MigrationSuggestion[];
}

/**
 * Stored evolution data on disk
 */
interface EvolutionDataStore {
  versions: ConfigVersion[];
  learnedPreferences: LearnedPreferences;
  migrations: MigrationSuggestion[];
  lastConfigHash: string;
  lastUpdated: string;
  schemaVersion: string;
}

/**
 * Configuration for the tracker
 */
export interface ConfigEvolutionTrackerConfig {
  projectRoot: string;
  dataPath?: string; // Defaults to .devloop/config-evolution.json
  maxVersions?: number; // Max versions to keep
  debug?: boolean;
}

/**
 * Tracks config evolution and learns from changes
 */
export class ConfigEvolutionTracker {
  private projectRoot: string;
  private dataPath: string;
  private configPath: string;
  private maxVersions: number;
  private debug: boolean;
  private data: EvolutionDataStore | null = null;

  constructor(config: ConfigEvolutionTrackerConfig) {
    this.projectRoot = config.projectRoot;
    this.dataPath = config.dataPath || path.join(config.projectRoot, '.devloop', 'config-evolution.json');
    this.configPath = path.join(config.projectRoot, 'devloop.config.js');
    this.maxVersions = config.maxVersions || 50;
    this.debug = config.debug || false;
  }

  /**
   * Load evolution data from disk
   */
  async load(): Promise<EvolutionDataStore> {
    if (this.data) {
      return this.data;
    }

    try {
      if (await fs.pathExists(this.dataPath)) {
        this.data = await fs.readJson(this.dataPath);

        if (this.debug) {
          logger.debug(`[ConfigEvolutionTracker] Loaded ${this.data?.versions.length || 0} config versions`);
        }

        return this.data!;
      }
    } catch (error) {
      logger.warn(`[ConfigEvolutionTracker] Failed to load evolution data: ${error}`);
    }

    // Initialize empty data store
    this.data = {
      versions: [],
      learnedPreferences: {},
      migrations: [],
      lastConfigHash: '',
      lastUpdated: new Date().toISOString(),
      schemaVersion: '1.0.0',
    };

    return this.data;
  }

  /**
   * Save evolution data to disk
   */
  async save(): Promise<void> {
    if (!this.data) {
      return;
    }

    try {
      // Prune old versions if over limit
      if (this.data.versions.length > this.maxVersions) {
        this.data.versions = this.data.versions.slice(-this.maxVersions);
      }

      // Update timestamp
      this.data.lastUpdated = new Date().toISOString();

      // Ensure directory exists
      await fs.ensureDir(path.dirname(this.dataPath));

      // Write data to disk
      await fs.writeJson(this.dataPath, this.data, { spaces: 2 });

      if (this.debug) {
        logger.debug(`[ConfigEvolutionTracker] Saved evolution data to ${this.dataPath}`);
      }
    } catch (error) {
      logger.error(`[ConfigEvolutionTracker] Failed to save evolution data: ${error}`);
      throw error;
    }
  }

  /**
   * Record a new config version with changes
   */
  async recordVersion(
    changes: ConfigChange[],
    source: 'manual' | 'init' | 'auto-optimization'
  ): Promise<void> {
    await this.load();

    // Generate version number
    const versionNumber = (this.data!.versions.length + 1).toString();
    const version: ConfigVersion = {
      version: versionNumber,
      changes: changes.map(c => ({ ...c, source })),
      timestamp: new Date().toISOString(),
    };

    this.data!.versions.push(version);

    // Update learned preferences from changes
    await this.updateLearnedPreferences(changes, source);

    await this.save();

    if (this.debug) {
      logger.debug(`[ConfigEvolutionTracker] Recorded config version ${versionNumber} with ${changes.length} changes`);
    }
  }

  /**
   * Detect changes between two configs
   */
  detectChanges(oldConfig: Record<string, any>, newConfig: Record<string, any>): ConfigChange[] {
    const changes: ConfigChange[] = [];

    this.compareObjects(oldConfig, newConfig, '', changes);

    return changes;
  }

  /**
   * Recursively compare two objects and record differences
   */
  private compareObjects(
    oldObj: any,
    newObj: any,
    pathPrefix: string,
    changes: ConfigChange[]
  ): void {
    const allKeys = new Set([
      ...Object.keys(oldObj || {}),
      ...Object.keys(newObj || {}),
    ]);

    for (const key of allKeys) {
      const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      const oldValue = oldObj?.[key];
      const newValue = newObj?.[key];

      // Skip undefined/null comparisons for same meaning
      if (oldValue === undefined && newValue === undefined) continue;
      if (oldValue === null && newValue === null) continue;

      // If both are objects, recurse
      if (
        typeof oldValue === 'object' && oldValue !== null &&
        typeof newValue === 'object' && newValue !== null &&
        !Array.isArray(oldValue) && !Array.isArray(newValue)
      ) {
        this.compareObjects(oldValue, newValue, currentPath, changes);
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        // Value changed
        changes.push({
          path: currentPath,
          from: oldValue,
          to: newValue,
          source: 'manual', // Will be overwritten by caller
        });
      }
    }
  }

  /**
   * Update learned preferences based on changes
   */
  private async updateLearnedPreferences(
    changes: ConfigChange[],
    source: 'manual' | 'init' | 'auto-optimization'
  ): Promise<void> {
    if (source !== 'manual') {
      return; // Only learn from manual changes
    }

    if (!this.data!.learnedPreferences) {
      this.data!.learnedPreferences = {};
    }

    const prefs = this.data!.learnedPreferences;

    for (const change of changes) {
      // Track common overrides
      if (!prefs.commonOverrides) {
        prefs.commonOverrides = {};
      }

      // Count how often this path is changed
      const overrideKey = `${change.path}::count`;
      prefs.commonOverrides[overrideKey] = (prefs.commonOverrides[overrideKey] || 0) + 1;

      // Store the most recent value
      prefs.commonOverrides[change.path] = change.to;

      // Track ignored/enabled features
      if (change.path.endsWith('.enabled')) {
        const featurePath = change.path.replace('.enabled', '');

        if (change.to === false) {
          // Feature was disabled
          if (!prefs.ignoredFeatures) {
            prefs.ignoredFeatures = [];
          }
          if (!prefs.ignoredFeatures.includes(featurePath)) {
            prefs.ignoredFeatures.push(featurePath);
          }
          // Remove from always enabled if present
          if (prefs.alwaysEnabled) {
            prefs.alwaysEnabled = prefs.alwaysEnabled.filter(f => f !== featurePath);
          }
        } else if (change.to === true) {
          // Feature was enabled
          if (!prefs.alwaysEnabled) {
            prefs.alwaysEnabled = [];
          }
          if (!prefs.alwaysEnabled.includes(featurePath)) {
            prefs.alwaysEnabled.push(featurePath);
          }
          // Remove from ignored if present
          if (prefs.ignoredFeatures) {
            prefs.ignoredFeatures = prefs.ignoredFeatures.filter(f => f !== featurePath);
          }
        }
      }
    }
  }

  /**
   * Get learned preferences
   */
  async getLearnedPreferences(): Promise<LearnedPreferences> {
    await this.load();
    return this.data!.learnedPreferences || {};
  }

  /**
   * Get most common override for a config path
   */
  async getCommonOverride(configPath: string): Promise<any | undefined> {
    await this.load();
    return this.data!.learnedPreferences?.commonOverrides?.[configPath];
  }

  /**
   * Check if a feature is commonly ignored
   */
  async isFeatureIgnored(featurePath: string): Promise<boolean> {
    await this.load();
    return this.data!.learnedPreferences?.ignoredFeatures?.includes(featurePath) || false;
  }

  /**
   * Check if a feature is always enabled
   */
  async isFeatureAlwaysEnabled(featurePath: string): Promise<boolean> {
    await this.load();
    return this.data!.learnedPreferences?.alwaysEnabled?.includes(featurePath) || false;
  }

  /**
   * Add a migration suggestion
   */
  async addMigration(migration: MigrationSuggestion): Promise<void> {
    await this.load();

    // Check if migration already exists
    const exists = this.data!.migrations.some(
      m => m.fromVersion === migration.fromVersion && m.toVersion === migration.toVersion
    );

    if (!exists) {
      this.data!.migrations.push(migration);
      await this.save();
    }
  }

  /**
   * Get pending migrations
   */
  async getPendingMigrations(currentVersion: string): Promise<MigrationSuggestion[]> {
    await this.load();

    return this.data!.migrations.filter(
      m => m.fromVersion === currentVersion
    );
  }

  /**
   * Get config evolution summary
   */
  async getSummary(): Promise<ConfigEvolution> {
    await this.load();

    return {
      versions: this.data!.versions,
      learnedPreferences: this.data!.learnedPreferences,
      migrations: this.data!.migrations,
    };
  }

  /**
   * Get the most frequently changed config paths
   */
  async getMostChangedPaths(limit: number = 10): Promise<Array<{ path: string; count: number }>> {
    await this.load();

    const pathCounts: Record<string, number> = {};

    for (const version of this.data!.versions) {
      for (const change of version.changes) {
        pathCounts[change.path] = (pathCounts[change.path] || 0) + 1;
      }
    }

    return Object.entries(pathCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path, count]) => ({ path, count }));
  }

  /**
   * Apply learned preferences to a config
   */
  async applyLearnedPreferences(config: Record<string, any>): Promise<Record<string, any>> {
    await this.load();

    const prefs = this.data!.learnedPreferences;
    if (!prefs?.commonOverrides) {
      return config;
    }

    const result = JSON.parse(JSON.stringify(config)); // Deep clone

    // Apply common overrides (only those changed frequently - 3+ times)
    for (const [key, value] of Object.entries(prefs.commonOverrides)) {
      if (key.endsWith('::count')) continue;

      const countKey = `${key}::count`;
      const count = prefs.commonOverrides[countKey] || 0;

      if (count >= 3) {
        // Apply the override
        this.setNestedValue(result, key, value);

        if (this.debug) {
          logger.debug(`[ConfigEvolutionTracker] Applied learned preference: ${key} = ${JSON.stringify(value)}`);
        }
      }
    }

    return result;
  }

  /**
   * Set a nested value in an object using a dot-separated path
   */
  private setNestedValue(obj: Record<string, any>, path: string, value: any): void {
    const parts = path.split('.');
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Clear all evolution data
   */
  async clear(): Promise<void> {
    this.data = {
      versions: [],
      learnedPreferences: {},
      migrations: [],
      lastConfigHash: '',
      lastUpdated: new Date().toISOString(),
      schemaVersion: '1.0.0',
    };
    await this.save();
  }

  /**
   * Check if data file exists
   */
  async exists(): Promise<boolean> {
    return fs.pathExists(this.dataPath);
  }

  /**
   * Get the data file path
   */
  getDataPath(): string {
    return this.dataPath;
  }
}
