/**
 * Pattern Library Manager
 *
 * Manages persistent storage of discovered patterns.
 * Provides save/load functionality for pattern library JSON files.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  PatternLibrary,
  CodePattern,
  TestPattern,
  SchemaPattern,
  ErrorPattern,
  PrdPattern,
  validatePatternLibrary,
  createEmptyPatternLibrary,
} from '../../config/schema/pattern-library';
import { logger } from '../utils/logger';

/**
 * Pattern Library Manager Configuration
 */
export interface PatternLibraryManagerConfig {
  projectRoot: string;
  libraryPath?: string; // Defaults to .devloop/pattern-library.json
  debug?: boolean;
}

/**
 * Manages persistent storage of discovered patterns
 */
export class PatternLibraryManager {
  private projectRoot: string;
  private libraryPath: string;
  private debug: boolean;
  private library: PatternLibrary | null = null;

  constructor(config: PatternLibraryManagerConfig) {
    this.projectRoot = config.projectRoot;
    this.libraryPath = config.libraryPath || path.join(config.projectRoot, '.devloop', 'pattern-library.json');
    this.debug = config.debug || false;
  }

  /**
   * Load pattern library from disk.
   *
   * @returns The loaded pattern library, or an empty library if file doesn't exist
   * @throws Error if file exists but is invalid JSON
   */
  async load(): Promise<PatternLibrary> {
    if (this.library) {
      return this.library;
    }

    try {
      if (await fs.pathExists(this.libraryPath)) {
        const data = await fs.readJson(this.libraryPath);
        this.library = validatePatternLibrary(data);

        if (this.debug) {
          logger.debug(`[PatternLibraryManager] Loaded ${this.getPatternCount()} patterns from ${this.libraryPath}`);
        }

        return this.library;
      }
    } catch (error) {
      logger.warn(`[PatternLibraryManager] Failed to load pattern library: ${error}`);
    }

    // Return empty library if load fails
    this.library = createEmptyPatternLibrary();
    return this.library;
  }

  /**
   * Save pattern library to disk.
   *
   * Updates metadata (lastAnalyzed, totalPatterns, frameworkDistribution) before saving.
   *
   * @throws Error if save operation fails
   */
  async save(): Promise<void> {
    if (!this.library) {
      this.library = createEmptyPatternLibrary();
    }

    try {
      // Update metadata
      this.library.metadata = {
        ...this.library.metadata,
        lastAnalyzed: new Date().toISOString(),
        totalPatterns: this.getPatternCount(),
        frameworkDistribution: this.getFrameworkDistribution(),
      };

      // Ensure directory exists
      await fs.ensureDir(path.dirname(this.libraryPath));

      // Write library to disk
      await fs.writeJson(this.libraryPath, this.library, { spaces: 2 });

      if (this.debug) {
        logger.debug(`[PatternLibraryManager] Saved ${this.getPatternCount()} patterns to ${this.libraryPath}`);
      }
    } catch (error) {
      logger.error(`[PatternLibraryManager] Failed to save pattern library: ${error}`);
      throw error;
    }
  }

  /**
   * Add or update a code pattern.
   *
   * If pattern with same ID exists, updates it and increments occurrence count.
   * Otherwise, adds as new pattern.
   *
   * @param pattern - Code pattern to add/update (discoveredAt is optional, defaults to now)
   */
  addCodePattern(pattern: Omit<CodePattern, 'discoveredAt'> & { discoveredAt?: string }): void {
    if (!this.library) {
      this.library = createEmptyPatternLibrary();
    }

    if (!this.library.codePatterns) {
      this.library.codePatterns = [];
    }

    // Check if pattern exists
    const existingIndex = this.library.codePatterns.findIndex(p => p.id === pattern.id);

    const fullPattern: CodePattern = {
      ...pattern,
      discoveredAt: pattern.discoveredAt || new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      // Update existing pattern
      this.library.codePatterns[existingIndex] = {
        ...this.library.codePatterns[existingIndex],
        ...fullPattern,
        occurrences: (this.library.codePatterns[existingIndex].occurrences || 0) + 1,
        lastUsedAt: new Date().toISOString(),
      };
    } else {
      // Add new pattern
      this.library.codePatterns.push(fullPattern);
    }
  }

  /**
   * Add or update a test pattern.
   *
   * If pattern with same ID exists, replaces it. Otherwise, adds as new pattern.
   *
   * @param pattern - Test pattern to add/update
   */
  addTestPattern(pattern: TestPattern): void {
    if (!this.library) {
      this.library = createEmptyPatternLibrary();
    }

    if (!this.library.testPatterns) {
      this.library.testPatterns = [];
    }

    const existingIndex = this.library.testPatterns.findIndex(p => p.id === pattern.id);

    if (existingIndex >= 0) {
      this.library.testPatterns[existingIndex] = pattern;
    } else {
      this.library.testPatterns.push(pattern);
    }
  }

  /**
   * Add or update a schema pattern.
   *
   * If pattern with same ID exists, replaces it. Otherwise, adds as new pattern.
   *
   * @param pattern - Schema pattern to add/update
   */
  addSchemaPattern(pattern: SchemaPattern): void {
    if (!this.library) {
      this.library = createEmptyPatternLibrary();
    }

    if (!this.library.schemaPatterns) {
      this.library.schemaPatterns = [];
    }

    const existingIndex = this.library.schemaPatterns.findIndex(p => p.id === pattern.id);

    if (existingIndex >= 0) {
      this.library.schemaPatterns[existingIndex] = pattern;
    } else {
      this.library.schemaPatterns.push(pattern);
    }
  }

  /**
   * Add or update an error pattern.
   *
   * If pattern with same ID exists, merges occurrence counts and updates metadata.
   * Otherwise, adds as new pattern.
   *
   * @param pattern - Error pattern to add/update
   */
  addErrorPattern(pattern: ErrorPattern): void {
    if (!this.library) {
      this.library = createEmptyPatternLibrary();
    }

    if (!this.library.errorPatterns) {
      this.library.errorPatterns = [];
    }

    const existingIndex = this.library.errorPatterns.findIndex(p => p.id === pattern.id);

    if (existingIndex >= 0) {
      // Update existing pattern (merge occurrence counts)
      this.library.errorPatterns[existingIndex] = {
        ...this.library.errorPatterns[existingIndex],
        ...pattern,
        occurrences: (this.library.errorPatterns[existingIndex].occurrences || 0) + (pattern.occurrences || 0),
      };
    } else {
      this.library.errorPatterns.push(pattern);
    }
  }

  /**
   * Add or update a PRD pattern.
   *
   * If pattern with same ID exists, updates it and sets lastUsedAt to now.
   * Otherwise, adds as new pattern.
   *
   * @param pattern - PRD pattern to add/update
   */
  addPrdPattern(pattern: PrdPattern): void {
    if (!this.library) {
      this.library = createEmptyPatternLibrary();
    }

    if (!this.library.prdPatterns) {
      this.library.prdPatterns = [];
    }

    const existingIndex = this.library.prdPatterns.findIndex(p => p.id === pattern.id);

    if (existingIndex >= 0) {
      // Update existing pattern
      this.library.prdPatterns[existingIndex] = {
        ...this.library.prdPatterns[existingIndex],
        ...pattern,
        lastUsedAt: new Date().toISOString(),
      };
    } else {
      this.library.prdPatterns.push(pattern);
    }
  }

  /**
   * Get all code patterns
   */
  getCodePatterns(): CodePattern[] {
    return this.library?.codePatterns || [];
  }

  /**
   * Get all test patterns
   */
  getTestPatterns(): TestPattern[] {
    return this.library?.testPatterns || [];
  }

  /**
   * Get all schema patterns
   */
  getSchemaPatterns(): SchemaPattern[] {
    return this.library?.schemaPatterns || [];
  }

  /**
   * Get all error patterns
   */
  getErrorPatterns(): ErrorPattern[] {
    return this.library?.errorPatterns || [];
  }

  /**
   * Get all PRD patterns
   */
  getPrdPatterns(): PrdPattern[] {
    return this.library?.prdPatterns || [];
  }

  /**
   * Get patterns by framework.
   *
   * Returns all pattern types (code, test, schema) filtered by framework.
   *
   * @param framework - Framework name to filter by
   * @returns Object with codePatterns, testPatterns, and schemaPatterns for the framework
   */
  getPatternsByFramework(framework: string): {
    codePatterns: CodePattern[];
    testPatterns: TestPattern[];
    schemaPatterns: SchemaPattern[];
  } {
    return {
      codePatterns: (this.library?.codePatterns || []).filter(
        p => p.frameworkHints?.includes(framework)
      ),
      testPatterns: (this.library?.testPatterns || []).filter(
        p => p.framework === framework
      ),
      schemaPatterns: (this.library?.schemaPatterns || []).filter(
        p => p.framework === framework
      ),
    };
  }

  /**
   * Get total pattern count across all pattern types.
   *
   * @returns Total number of patterns (code + test + schema + error + PRD)
   */
  getPatternCount(): number {
    return (
      (this.library?.codePatterns?.length || 0) +
      (this.library?.testPatterns?.length || 0) +
      (this.library?.schemaPatterns?.length || 0) +
      (this.library?.errorPatterns?.length || 0) +
      (this.library?.prdPatterns?.length || 0)
    );
  }

  /**
   * Get framework distribution
   */
  private getFrameworkDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};

    for (const pattern of this.library?.schemaPatterns || []) {
      distribution[pattern.framework] = (distribution[pattern.framework] || 0) + 1;
    }

    for (const pattern of this.library?.testPatterns || []) {
      distribution[pattern.framework] = (distribution[pattern.framework] || 0) + 1;
    }

    return distribution;
  }

  /**
   * Merge patterns from another library.
   *
   * Adds all patterns from the other library to this one, handling duplicates appropriately.
   *
   * @param other - Pattern library to merge from
   */
  async mergeFrom(other: PatternLibrary): Promise<void> {
    await this.load();

    // Merge code patterns
    for (const pattern of other.codePatterns || []) {
      this.addCodePattern(pattern);
    }

    // Merge test patterns
    for (const pattern of other.testPatterns || []) {
      this.addTestPattern(pattern);
    }

    // Merge schema patterns
    for (const pattern of other.schemaPatterns || []) {
      this.addSchemaPattern(pattern);
    }

    // Merge error patterns
    for (const pattern of other.errorPatterns || []) {
      this.addErrorPattern(pattern);
    }

    // Merge PRD patterns
    for (const pattern of other.prdPatterns || []) {
      this.addPrdPattern(pattern);
    }

    await this.save();
  }

  /**
   * Prune old patterns based on retention settings.
   *
   * Removes patterns that haven't been used recently (based on lastUsedAt or discoveredAt).
   *
   * @param retentionDays - Number of days to retain patterns (default: 180)
   * @returns Number of patterns pruned
   */
  async prune(retentionDays: number = 180): Promise<number> {
    await this.load();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffIso = cutoffDate.toISOString();

    let prunedCount = 0;

    // Prune code patterns
    if (this.library?.codePatterns) {
      const before = this.library.codePatterns.length;
      this.library.codePatterns = this.library.codePatterns.filter(
        p => p.lastUsedAt ? p.lastUsedAt > cutoffIso : p.discoveredAt > cutoffIso
      );
      prunedCount += before - this.library.codePatterns.length;
    }

    // Prune error patterns (based on lastSeen)
    if (this.library?.errorPatterns) {
      const before = this.library.errorPatterns.length;
      this.library.errorPatterns = this.library.errorPatterns.filter(
        p => p.lastSeen > cutoffIso
      );
      prunedCount += before - this.library.errorPatterns.length;
    }

    // Prune PRD patterns (based on lastUsedAt)
    if (this.library?.prdPatterns) {
      const before = this.library.prdPatterns.length;
      this.library.prdPatterns = this.library.prdPatterns.filter(
        p => p.lastUsedAt > cutoffIso
      );
      prunedCount += before - this.library.prdPatterns.length;
    }

    if (prunedCount > 0) {
      await this.save();

      if (this.debug) {
        logger.debug(`[PatternLibraryManager] Pruned ${prunedCount} old patterns`);
      }
    }

    return prunedCount;
  }

  /**
   * Clear all patterns from the library.
   *
   * Creates an empty library and saves it. Use with caution.
   */
  async clear(): Promise<void> {
    this.library = createEmptyPatternLibrary();
    await this.save();
  }

  /**
   * Check if pattern library file exists on disk.
   *
   * @returns True if file exists, false otherwise
   */
  async exists(): Promise<boolean> {
    return fs.pathExists(this.libraryPath);
  }

  /**
   * Get the library file path.
   *
   * @returns Absolute path to the pattern library JSON file
   */
  getLibraryPath(): string {
    return this.libraryPath;
  }

  /**
   * Filter PRD patterns based on filter options.
   *
   * This consolidates filtering logic from PatternLoader into PatternLibraryManager.
   * Filters by expiration, relevance score, lastUsedAt, retention days, prdId, framework, and category.
   *
   * @param filterOptions - Filtering criteria
   * @param filterOptions.retentionDays - Keep patterns from last N days (default: 180)
   * @param filterOptions.relevanceThreshold - Minimum relevance score 0-1 (default: 0.5)
   * @param filterOptions.lastUsedDays - Only load patterns used in last N days (default: 90)
   * @param filterOptions.prdId - Optional PRD ID filter
   * @param filterOptions.framework - Optional framework filter
   * @param filterOptions.category - Optional category filter
   * @param filterOptions.excludeExpired - Exclude expired patterns (default: true)
   * @returns Filtered PRD patterns matching criteria
   */
  async filterPrdPatterns(
    filterOptions: {
      retentionDays?: number;
      relevanceThreshold?: number;
      lastUsedDays?: number;
      prdId?: string;
      framework?: string;
      category?: string;
      excludeExpired?: boolean;
    }
  ): Promise<PrdPattern[]> {
    await this.load();
    const now = new Date();
    const patterns = this.library?.prdPatterns || [];

    return patterns.filter(pattern => {
      // Filter by expiration
      if (filterOptions.excludeExpired !== false && pattern.expiresAt) {
        const expiresAt = new Date(pattern.expiresAt);
        if (expiresAt < now) {
          return false; // Expired
        }
      }

      // Filter by relevance score
      if (pattern.relevanceScore < (filterOptions.relevanceThreshold ?? 0.5)) {
        return false; // Below threshold
      }

      // Filter by lastUsedAt (only load recently used patterns)
      const lastUsedAt = new Date(pattern.lastUsedAt);
      const daysSinceLastUse = (now.getTime() - lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastUse > (filterOptions.lastUsedDays ?? 90)) {
        return false; // Not used recently enough
      }

      // Filter by retention days (based on createdAt)
      const createdAt = new Date(pattern.createdAt);
      const daysSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation > (filterOptions.retentionDays ?? 180)) {
        return false; // Too old
      }

      // Filter by prdId if specified
      if (filterOptions.prdId && pattern.prdId && pattern.prdId !== filterOptions.prdId) {
        return false; // Different PRD
      }

      // Filter by framework if specified
      if (filterOptions.framework && pattern.framework && pattern.framework !== filterOptions.framework) {
        return false; // Different framework
      }

      // Filter by category if specified
      if (filterOptions.category && pattern.category !== filterOptions.category) {
        return false; // Different category
      }

      return true;
    });
  }

  /**
   * Update PRD pattern lastUsedAt timestamp (marks pattern as recently used).
   *
   * This helps with relevance scoring and retention filtering.
   *
   * @param patternId - ID of pattern to mark as used
   */
  async markPrdPatternUsed(patternId: string): Promise<void> {
    await this.load();

    if (!this.library?.prdPatterns) {
      return;
    }

    const pattern = this.library.prdPatterns.find(p => p.id === patternId);
    if (pattern) {
      pattern.lastUsedAt = new Date().toISOString();
      await this.save();

      if (this.debug) {
        logger.debug(`[PatternLibraryManager] Marked PRD pattern ${patternId} as used`);
      }
    }
  }
}
