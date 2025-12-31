import { z } from 'zod';

/**
 * Code changes returned by AI for applying to files
 */
export interface CodeChanges {
  files?: Array<{
    path: string;
    content?: string;
    patches?: Array<{ search: string; replace: string }>;
    operation: 'create' | 'update' | 'patch' | 'delete';
  }>;
  summary?: string;
}

/**
 * Framework Plugin Interface
 *
 * Defines the contract for framework-specific functionality in dev-loop.
 * Implementations provide templates, patterns, and configuration specific
 * to a framework (Drupal, Laravel, Next.js, etc.).
 */
export interface FrameworkPlugin {
  // ===== Metadata =====

  /** Unique framework identifier (e.g., 'drupal', 'laravel', 'nextjs') */
  readonly name: string;

  /** Plugin version */
  readonly version: string;

  /** Human-readable description */
  readonly description: string;

  // ===== Detection =====

  /**
   * Auto-detect if this framework is used in the project.
   * Called when framework.type is not specified in config.
   * @param projectRoot Absolute path to project root
   * @returns true if this framework is detected
   */
  detect(projectRoot: string): Promise<boolean>;

  // ===== Configuration =====

  /**
   * Get default configuration values for this framework.
   * These are merged with user config (user config takes precedence).
   */
  getDefaultConfig(): FrameworkDefaultConfig;

  /**
   * Get optional Zod schema extension for framework-specific config.
   * This allows frameworks to add custom config sections.
   */
  getSchemaExtension?(): z.ZodObject<any>;

  // ===== Templates =====

  /**
   * Get the task generation template for this framework.
   * Used when generating code from tasks.
   */
  getTaskTemplate(): string;

  /**
   * Get the test generation template (optional).
   * Used when generating tests for this framework.
   */
  getTestTemplate?(): string | undefined;

  /**
   * Get the PRD parsing template (optional).
   * Used when parsing PRD documents for this framework.
   */
  getPrdTemplate?(): string;

  // ===== File Discovery Context =====

  /**
   * Get file extensions to search when discovering relevant files.
   * @example ['php', 'module', 'yml'] for Drupal
   */
  getFileExtensions(): string[];

  /**
   * Get directories to search for source files.
   * Paths are relative to project root.
   * @example ['docroot/modules/custom', 'config/default'] for Drupal
   */
  getSearchDirs(): string[];

  /**
   * Get directories to exclude from file discovery.
   * @example ['node_modules', 'vendor'] for Drupal
   */
  getExcludeDirs(): string[];

  // ===== Error Handling =====

  /**
   * Get error pattern to guidance mapping.
   * Keys are substrings/patterns to match in error messages.
   * Values are helpful guidance to include in fix tasks.
   * @example { 'DRUPAL_ROOT': 'Use dirname(DRUPAL_ROOT) for project root' }
   */
  getErrorPatterns(): Record<string, string>;

  /**
   * Get regex patterns for extracting identifiers (function/class names).
   * Used for searching the codebase for relevant code.
   */
  getIdentifierPatterns(): RegExp[];

  /**
   * Get regex patterns for extracting file paths from error messages.
   */
  getErrorPathPatterns?(): RegExp[];

  // ===== Lifecycle Hooks (Optional) =====

  /**
   * Called before applying code changes.
   * Can modify changes before they're written.
   */
  onBeforeApply?(changes: CodeChanges): Promise<CodeChanges>;

  /**
   * Called after applying code changes successfully.
   * Useful for cache clearing, compilation, etc.
   */
  onAfterApply?(changes: CodeChanges): Promise<void>;

  /**
   * Called when a test fails.
   * Can provide additional context for the fix task.
   * @param error The error message from the test
   * @returns Additional context to include in the fix task
   */
  onTestFailure?(error: string): Promise<string>;

  // ===== Cache/Build Commands (Optional) =====

  /**
   * Get command to clear framework cache after changes.
   * @example 'ddev exec drush cr' for Drupal
   */
  getCacheCommand?(): string | undefined;

  /**
   * Get command to run framework-specific build.
   * @example 'npm run build' for Next.js
   */
  getBuildCommand?(): string | undefined;
}

/**
 * Default configuration provided by a framework plugin.
 * These values are used when not overridden in devloop.config.js.
 */
export interface FrameworkDefaultConfig {
  /** Cache clear command */
  cacheCommand?: string;

  /** Directories to search for source files */
  searchDirs?: string[];

  /** Directories to exclude from search */
  excludeDirs?: string[];

  /** File extensions to include */
  extensions?: string[];

  /** Glob patterns to ignore */
  ignoreGlobs?: string[];

  /** Test runner to use */
  testRunner?: 'playwright' | 'cypress' | 'jest';

  /** Test command */
  testCommand?: string;

  /** Base URL for validation */
  validationBaseUrl?: string;

  /** Any additional framework-specific defaults */
  [key: string]: any;
}

/**
 * Plugin manifest for project-local plugins.
 * Stored in .devloop/frameworks/{name}/plugin.json
 */
export interface PluginManifest {
  name: string;
  version: string;
  description?: string;

  templates?: {
    task?: string;
    test?: string;
    prd?: string;
  };

  fileExtensions?: string[];
  searchDirs?: string[];
  excludeDirs?: string[];

  errorPatterns?: Record<string, string>;
  identifierPatterns?: string[];

  cacheCommand?: string;
  buildCommand?: string;
}
