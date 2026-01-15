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
   * Load pattern library from disk
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
   * Save pattern library to disk
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
   * Add or update a code pattern
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
   * Add or update a test pattern
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
   * Add or update a schema pattern
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
   * Get patterns by framework
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
   * Get total pattern count
   */
  getPatternCount(): number {
    return (
      (this.library?.codePatterns?.length || 0) +
      (this.library?.testPatterns?.length || 0) +
      (this.library?.schemaPatterns?.length || 0)
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
   * Merge patterns from another library
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

    await this.save();
  }

  /**
   * Prune old patterns based on retention settings
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

    if (prunedCount > 0) {
      await this.save();

      if (this.debug) {
        logger.debug(`[PatternLibraryManager] Pruned ${prunedCount} old patterns`);
      }
    }

    return prunedCount;
  }

  /**
   * Clear all patterns
   */
  async clear(): Promise<void> {
    this.library = createEmptyPatternLibrary();
    await this.save();
  }

  /**
   * Check if library exists on disk
   */
  async exists(): Promise<boolean> {
    return fs.pathExists(this.libraryPath);
  }

  /**
   * Get the library path
   */
  getLibraryPath(): string {
    return this.libraryPath;
  }
}
