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
 * Code quality tool definition for framework-specific scanning
 */
export interface CodeQualityTool {
  /** Tool name (e.g., 'phpstan', 'eslint', 'mypy') */
  name: string;
  /** Purpose of the tool */
  purpose: 'static-analysis' | 'duplicate-detection' | 'security' |
           'complexity' | 'tech-debt' | 'dependency-audit';
  /** Command to run the tool */
  command: string;
  /** Output format expected from the tool */
  outputFormat: 'json' | 'xml' | 'text' | 'sarif';
  /** Command to install the tool (optional) */
  installCommand?: string;
  /** Path to tool configuration file (optional) */
  configPath?: string;
  /** Human-readable description of the tool */
  description: string;
}

/**
 * Tech debt indicator pattern for regex-based detection
 */
export interface TechDebtIndicator {
  /** Regex pattern to match in code */
  pattern: string;
  /** Severity level */
  severity: 'low' | 'medium' | 'high';
  /** Category of tech debt */
  category: 'deprecated-api' | 'todo' | 'fixme' | 'hack' |
            'obsolete-pattern' | 'missing-test' | 'security' | 'tech-debt';
  /** Description of the issue */
  description: string;
  /** Suggested remediation (optional) */
  remediation?: string;
}

/**
 * Abstraction pattern detected in codebase
 */
export interface AbstractionPattern {
  /** Unique identifier for this pattern */
  id: string;
  /** Type of pattern */
  type: 'code-block' | 'config-structure' | 'class-pattern' | 'function-pattern' | 'plugin-pattern';
  /** Signature/identifier of the pattern */
  signature: string;
  /** Files containing this pattern */
  files: string[];
  /** Specific locations in files */
  locations: Array<{ file: string; startLine: number; endLine: number }>;
  /** Similarity score (0-1) */
  similarity: number;
  /** Number of occurrences */
  occurrences: number;
  /** Suggested abstraction type */
  suggestedAbstraction: 'plugin' | 'config-schema' | 'base-class' | 'service' | 'utility' | 'entity-type' | 'field';
  /** Suggested name for the abstraction */
  suggestedName?: string;
  /** Evidence supporting this pattern */
  evidence: string[];
}

/**
 * Plugin recommendation for new patterns/config schemas
 */
export interface PluginRecommendation {
  /** Type of recommendation */
  type: 'error-pattern' | 'config-schema' | 'new-plugin' | 'abstraction-pattern';
  /** What triggered this recommendation */
  trigger: string;
  /** Suggested improvement */
  suggestion: string;
  /** Evidence supporting the recommendation */
  evidence: string[];
  /** Priority level */
  priority: 'low' | 'medium' | 'high';
}

/**
 * Abstraction recommendation extending PluginRecommendation
 */
export interface AbstractionRecommendation extends PluginRecommendation {
  type: 'abstraction-pattern';
  /** The detected pattern */
  pattern: AbstractionPattern;
  /** Implementation details */
  implementation: {
    type: 'plugin' | 'config-schema' | 'base-class' | 'service' | 'utility' | 'entity-type' | 'field';
    name: string;
    description: string;
    example?: string;
  };
  /** Impact assessment */
  impact: {
    codeReduction: number;
    filesAffected: number;
    maintenanceBenefit: 'low' | 'medium' | 'high';
  };
}

/**
 * Pattern for generating recommendations
 */
export interface RecommendationPattern {
  /** Pattern identifier */
  id: string;
  /** Regex pattern to match */
  pattern: string;
  /** Type of recommendation this pattern generates */
  recommendationType: 'error-pattern' | 'config-schema' | 'new-plugin';
  /** Description of what this pattern detects */
  description: string;
  /** Priority when matched */
  priority: 'low' | 'medium' | 'high';
}

/**
 * PRD Concept Definition
 * Defines a framework-specific concept that can be extracted from PRD content.
 * Each framework has its own concepts (e.g., Drupal: entity_type, React: component).
 */
export interface PrdConcept {
  /** Internal identifier (e.g., 'entity_type', 'component', 'model') */
  name: string;
  /** Human-readable label (e.g., 'Entity Types', 'React Components') */
  label: string;
  /** Regex pattern to extract from PRD content */
  extractPattern: RegExp;
  /** Optional pattern to match in target file paths */
  filePattern?: RegExp;
  /** Question to ask about generating schemas for these (supports {count} placeholder) */
  schemaQuestion?: string;
  /** Question to ask about prioritization */
  priorityQuestion?: string;
}

/**
 * Inferred concept from PRD content
 */
export interface InferredConcept {
  /** Matches PrdConcept.name */
  type: string;
  /** Extracted items (e.g., ['node', 'media', 'user']) */
  items: string[];
  /** Items to prioritize (typically first few) */
  priorities: string[];
  /** 0-1 confidence score based on extraction clarity */
  confidence: number;
}

/**
 * PRD Inference Result
 * Returned by FrameworkPlugin.inferFromPrd()
 */
export interface PrdInferenceResult {
  /** Inferred concepts from PRD */
  concepts: InferredConcept[];
  /** Optional schema type inference (framework-specific) */
  schemaType?: {
    value: string;       // e.g., 'config', 'entity', 'both' for Drupal
    confidence: number;
  };
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

  // ===== Code Quality Scanning (Optional) =====

  /**
   * Get framework-specific code quality tools.
   * Returns array of tools that can be run for static analysis, security scanning, etc.
   * @returns Array of code quality tool definitions
   */
  getCodeQualityTools?(): CodeQualityTool[];

  /**
   * Get tech debt indicators for regex-based pattern matching.
   * These patterns are scanned across the codebase to detect deprecated APIs, TODOs, etc.
   * @returns Array of tech debt indicator patterns
   */
  getTechDebtIndicators?(): TechDebtIndicator[];

  /**
   * Get recommendation patterns for suggesting new plugins/config schemas.
   * These patterns analyze codebase to suggest improvements.
   * @returns Array of recommendation patterns
   */
  getRecommendationPatterns?(): RecommendationPattern[];

  // ===== Target Module Operations (For Contribution Mode) =====

  /**
   * Get valid paths for a target module.
   * Used for boundary enforcement and file filtering in contribution mode.
   * @param targetModule The module name (e.g., 'bd', 'design_system')
   * @returns Array of valid path patterns for the module
   * @example For Drupal: ['docroot/modules/share/bd/', 'docroot/modules/custom/bd/']
   */
  getTargetModulePaths?(targetModule: string): string[];

  /**
   * Get framework-specific guidance for working within a target module.
   * Used in AI prompts to provide context-specific instructions.
   * @param targetModule The module name
   * @returns Guidance text for the AI agent
   * @example 'In Drupal, all custom module code must be under docroot/modules/share/{module}/'
   */
  getTargetModuleGuidance?(targetModule: string): string;

  /**
   * Generate a module boundary warning for AI prompts.
   * Used to provide prominent boundary warnings in contribution mode.
   * @param targetModule The module name
   * @returns Formatted warning text with allowed/forbidden paths
   */
  generateModuleBoundaryWarning?(targetModule: string): string;

  // ===== Constitution Support (For Spec-Kit Integration) =====

  /**
   * Get framework-specific constraints for constitution merging.
   * These are injected into AI prompts as MUST/NEVER rules.
   * @returns Array of constraint strings
   * @example ['NEVER modify Drupal core', 'MUST use dependency injection']
   */
  getConstraints?(): string[];

  /**
   * Get framework-specific patterns for constitution merging.
   * These guide AI on which patterns to use when.
   * @returns Array of pattern rules
   */
  getPatterns?(): Array<{ pattern: string; when: string; reference?: string }>;

  /**
   * Get code location rules for constitution.
   * Specifies where different types of code should live.
   * @returns Record of code type to path patterns
   * @example { 'custom_modules': 'docroot/modules/share/*' }
   */
  getCodeLocationRules?(): Record<string, string>;

  // ===== PRD Content Analysis (For Spec-Kit Integration) =====

  /**
   * Get framework-specific concepts that can be inferred from PRDs.
   * These are used to generate relevant questions during refinement.
   * Each framework defines its own concepts (e.g., Drupal: entity_type, React: component).
   * @returns Array of concept definitions with extraction patterns
   * @example For Drupal: [{ name: 'entity_type', label: 'Entity Types', extractPattern: /entity.type/ }]
   */
  getPrdConcepts?(): PrdConcept[];

  /**
   * Infer framework-specific decisions from PRD content.
   * Called by RefinementQuestionGenerator to generate high-confidence answers.
   * @param prd The parsed planning document
   * @returns Framework-specific inference results with confidence scores
   */
  inferFromPrd?(prd: any): PrdInferenceResult;

  // ===== CLI Commands (For Agentic Execution) =====

  /**
   * Get framework-specific CLI commands available for agentic execution.
   * These commands enable dev-loop to execute framework operations like
   * cache clearing, module enabling, service verification, etc.
   * @returns Array of CLI command definitions
   * @example For Drupal: [{ name: 'cache-rebuild', command: 'ddev exec drush cr', purpose: 'cache-clear' }]
   */
  getCLICommands?(): FrameworkCLICommand[];
}

/**
 * Framework CLI Command Definition
 *
 * Defines a CLI command that can be executed by dev-loop for framework-specific operations.
 * Commands support placeholders (e.g., {module}) that are replaced at execution time.
 */
export interface FrameworkCLICommand {
  /** Command identifier (e.g., 'module-enable', 'cache-rebuild') */
  name: string;

  /** Full command template with {placeholders} for variable substitution */
  command: string;

  /** Purpose category for the command */
  purpose: 'cache-clear' | 'module-enable' | 'module-disable' |
           'service-check' | 'config-export' | 'config-import' |
           'database-query' | 'code-check' | 'test-run' | 'scaffold' |
           'entity-check' | 'health-check';

  /** Human-readable description */
  description: string;

  /** Required placeholder names (e.g., ['module', 'service']) */
  placeholders?: string[];

  /** Example usage with filled placeholders */
  example?: string;

  /** Whether the command is safe to run multiple times (idempotent) */
  idempotent?: boolean;

  /** Whether the command requires human confirmation before execution */
  requiresConfirmation?: boolean;

  /** Expected output format for parsing results */
  outputFormat?: 'json' | 'text' | 'boolean' | 'yaml';

  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
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
