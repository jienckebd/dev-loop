/**
 * Codebase Analyzer
 *
 * Analyzes codebase for PRD building context.
 * Leverages existing SemanticFileDiscovery, CodeContextProvider, and FrameworkLoader.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import fg from 'fast-glob';
import { SemanticFileDiscovery, DiscoveryQuery } from './code/semantic-file-discovery';
import { CodeContextProvider, FileContext } from './code/context-provider';
import { FrameworkLoader, FrameworkPlugin } from '../../frameworks';
import { logger } from '../utils/logger';
import { BuildMode } from '../conversation/types';
import { PatternLibraryManager } from './pattern-library-manager';

/**
 * Codebase Analysis Result
 */
export interface CodebaseAnalysisResult {
  projectRoot: string;
  framework?: string;
  frameworkPlugin?: FrameworkPlugin;
  featureTypes?: string[];
  relevantFiles: string[];
  fileContexts: Map<string, FileContext>;
  codebaseContext: string; // Summarized context
  patterns?: Array<{
    type: string;
    signature: string;
    files: string[];
    occurrences: number;
  }>;
  schemaPatterns?: Array<{
    type: string;
    pattern: string;
    examples: string[];
  }>;
  testPatterns?: Array<{
    framework: string;
    structure: string;
    examples: string[];
  }>;
}

/**
 * Cached Analysis Interface
 */
interface CachedAnalysis {
  hash: string;
  result: CodebaseAnalysisResult;
  timestamp: number;
}

/**
 * Codebase Analyzer Configuration
 */
export interface CodebaseAnalyzerConfig {
  projectRoot: string;
  skipAnalysis?: boolean; // Skip analysis for faster execution
  maxFiles?: number; // Maximum files to analyze
  maxContextChars?: number; // Maximum characters for context
  includePatterns?: string[]; // File patterns to include
  excludePatterns?: string[]; // File patterns to exclude
  // NEW: Project configuration (optional - will load from devloop.config.js if not provided)
  projectConfig?: {
    framework?: {
      type?: string;
    };
    codebase?: {
      documentationPaths?: string[];
      editablePaths?: string[];
      protectedPaths?: string[];
      searchDirs?: string[];
      excludeDirs?: string[];
      extensions?: string[];
      ignoreGlobs?: string[];
    };
    testGeneration?: {
      framework?: string;
      testDir?: string;
      helperMethodSignatures?: Record<string, string>;
      isolationRules?: string[];
    };
  };
  useSemanticDiscovery?: boolean; // Use semantic discovery when available
  debug?: boolean;
}

/**
 * Analyzes codebase for PRD building context
 */
export class CodebaseAnalyzer {
  private config: {
    projectRoot: string;
    skipAnalysis: boolean;
    maxFiles: number;
    maxContextChars: number;
    includePatterns: string[];
    excludePatterns: string[];
    debug: boolean;
    projectConfig?: CodebaseAnalyzerConfig['projectConfig'];
    useSemanticDiscovery: boolean;
  };
  private semanticDiscovery?: SemanticFileDiscovery;
  private contextProvider: CodeContextProvider;
  private frameworkLoader: FrameworkLoader;
  private patternLibraryManager: PatternLibraryManager;
  private debug: boolean;
  private frameworkPlugin?: FrameworkPlugin; // Cached framework plugin for pattern persistence

  constructor(config: CodebaseAnalyzerConfig) {
    this.config = {
      projectRoot: config.projectRoot,
      skipAnalysis: config.skipAnalysis || false,
      maxFiles: config.maxFiles || 50,
      maxContextChars: config.maxContextChars || 50000,
      includePatterns: config.includePatterns || [],
      excludePatterns: config.excludePatterns || [],
      debug: config.debug || false,
      projectConfig: config.projectConfig,
      useSemanticDiscovery: config.useSemanticDiscovery !== false, // Default to true if available
    };
    this.debug = this.config.debug;
    this.contextProvider = new CodeContextProvider(this.debug);
    this.frameworkLoader = new FrameworkLoader(this.config.projectRoot, this.debug);
    this.patternLibraryManager = new PatternLibraryManager({
      projectRoot: this.config.projectRoot,
      debug: this.debug,
    });
  }

  /**
   * Analyze codebase for PRD building context (with caching)
   */
  async analyze(
    mode: BuildMode,
    query?: string, // Optional query for semantic search
    targetModule?: string // Optional target module for filtering
  ): Promise<CodebaseAnalysisResult> {
    if (this.config.skipAnalysis) {
      logger.debug('[CodebaseAnalyzer] Skipping analysis (skipAnalysis=true)');
      return this.getEmptyResult();
    }

    // Check cache first
    const cacheKey = `${mode}-${query || 'default'}-${targetModule || 'all'}`;
    const cached = await this.loadCache(cacheKey);
    if (cached && await this.isValidCache(cached)) {
      logger.info('[CodebaseAnalyzer] Using cached analysis');
      return cached.result;
    }

    logger.debug(`[CodebaseAnalyzer] Starting codebase analysis (mode: ${mode})`);

    // 1. Detect framework - prioritize configured framework type from project config
    let frameworkType: string | undefined;
    if (this.config.projectConfig?.framework?.type) {
      frameworkType = this.config.projectConfig.framework.type;
      logger.debug(`[CodebaseAnalyzer] CRITICAL: Using configured framework type from project config: ${frameworkType}`);
      logger.debug(`[CodebaseAnalyzer] Project config framework object: ${JSON.stringify({ type: frameworkType })}`);
    } else {
      logger.debug(`[CodebaseAnalyzer] No configured framework type found in project config, will auto-detect`);
      if (this.config.projectConfig) {
        logger.debug(`[CodebaseAnalyzer] Available project config keys: ${Object.keys(this.config.projectConfig).join(', ')}`);
      }
    }

    let frameworkPlugin = await this.frameworkLoader.loadFramework(frameworkType);
    let framework = frameworkPlugin?.name || 'generic';

    // CRITICAL: If configured framework type doesn't match loaded plugin, use configured framework's plugin
    // This ensures questions and analysis reference the configured framework (e.g., "drupal") instead of detected (e.g., "composite")
    if (frameworkType && frameworkType !== 'composite' && framework === 'composite') {
      logger.warn(
        `[CodebaseAnalyzer] WARNING: Framework type '${frameworkType}' was configured in devloop.config.js but ` +
        `CompositePlugin was loaded due to multiple frameworks detected. Extracting configured framework '${frameworkType}' ` +
        `from composite to ensure questions reference the correct framework.`
      );

      // Try to get the configured framework plugin from the composite
      const compositePlugin = frameworkPlugin as any;
      if (compositePlugin.hasFramework && typeof compositePlugin.hasFramework === 'function') {
        if (compositePlugin.hasFramework(frameworkType)) {
          if (compositePlugin.getChildPlugins && typeof compositePlugin.getChildPlugins === 'function') {
            const childPlugins = compositePlugin.getChildPlugins();
            const configuredPlugin = childPlugins.find((p: FrameworkPlugin) => p.name === frameworkType);
            if (configuredPlugin) {
              logger.debug(`[CodebaseAnalyzer] Found configured framework '${frameworkType}' in CompositePlugin, using that plugin for analysis`);
              frameworkPlugin = configuredPlugin;
              framework = frameworkType;
            }
          }
        }
      }

      // If we couldn't extract from composite, try loading the configured framework directly from built-in
      if (framework === 'composite' && frameworkType) {
        const builtinFramework = this.frameworkLoader.getBuiltinFramework(frameworkType);
        if (builtinFramework && builtinFramework.name === frameworkType) {
          logger.debug(`[CodebaseAnalyzer] Loaded configured framework '${frameworkType}' directly from built-in, using for analysis`);
          frameworkPlugin = builtinFramework;
          framework = frameworkType;
        } else {
          // Fallback: override framework name to use configured type for questions
          logger.warn(`[CodebaseAnalyzer] Could not load configured framework '${frameworkType}' plugin, using configured name for questions only`);
          framework = frameworkType;
        }
      }
    } else if (frameworkType && frameworkType !== framework && framework !== 'generic') {
      logger.warn(
        `[CodebaseAnalyzer] Framework mismatch: configured='${frameworkType}' but loaded='${framework}'. ` +
        `Using configured framework type '${frameworkType}' for consistency.`
      );
      // Try to load the configured framework directly from built-in
      const builtinFramework = this.frameworkLoader.getBuiltinFramework(frameworkType);
      if (builtinFramework && builtinFramework.name === frameworkType) {
        frameworkPlugin = builtinFramework;
        framework = frameworkType;
      } else {
        framework = frameworkType;
      }
    }

    logger.debug(`[CodebaseAnalyzer] Final framework: ${framework}${frameworkType ? ` (configured: ${frameworkType}, plugin: ${frameworkPlugin?.name || 'none'})` : ` (plugin: ${frameworkPlugin?.name || 'none'}, auto-detected)`}`);

    // Cache framework plugin for pattern persistence
    this.frameworkPlugin = frameworkPlugin;

    // 2. Discover relevant files
    const relevantFiles = await this.discoverRelevantFiles(query, frameworkPlugin, targetModule);

    logger.debug(`[CodebaseAnalyzer] Discovered ${relevantFiles.length} relevant files`);

    // 3. Extract file contexts
    const fileContexts = await this.extractFileContexts(relevantFiles);

    // 4. Build codebase context summary
    const codebaseContext = this.buildCodebaseContext(fileContexts, frameworkPlugin);

    // 5. Detect feature types (basic implementation - can be enhanced)
    const featureTypes = await this.detectFeatureTypes(fileContexts, frameworkPlugin);

    // 6. Extract patterns (basic implementation - can be enhanced)
    const patterns = this.extractPatterns(fileContexts);
    const schemaPatterns = this.extractSchemaPatterns(fileContexts, frameworkPlugin);
    const testPatterns = this.extractTestPatterns(fileContexts, frameworkPlugin);

    const result: CodebaseAnalysisResult = {
      projectRoot: this.config.projectRoot,
      framework,
      frameworkPlugin,
      featureTypes,
      relevantFiles,
      fileContexts,
      codebaseContext,
      patterns,
      schemaPatterns,
      testPatterns,
    };

    // Save to cache
    await this.saveCache(cacheKey, result);

    // Persist discovered patterns to pattern library
    await this.persistPatternsToLibrary(result);

    return result;
  }

  /**
   * Load cached analysis
   */
  private async loadCache(cacheKey: string): Promise<CachedAnalysis | null> {
    try {
      const cacheFile = path.join(this.config.projectRoot, '.devloop', 'cache', 'analysis.json');
      if (await fs.pathExists(cacheFile)) {
        const cacheData = await fs.readJson(cacheFile);
        const cached = cacheData[cacheKey];
        if (cached) {
          // Reconstruct Map from serialized array/object
          cached.result = this.deserializeAnalysisResult(cached.result);
          return cached;
        }
      }
    } catch (error) {
      logger.debug(`[CodebaseAnalyzer] Failed to load cache: ${error}`);
    }
    return null;
  }

  /**
   * Deserialize analysis result, reconstructing Map objects from JSON
   */
  private deserializeAnalysisResult(result: any): CodebaseAnalysisResult {
    // Reconstruct fileContexts Map from serialized data
    let fileContexts: Map<string, FileContext>;

    if (result.fileContexts instanceof Map) {
      // Already a Map (shouldn't happen from JSON, but handle it)
      fileContexts = result.fileContexts;
    } else if (Array.isArray(result.fileContexts)) {
      // Serialized as array of [key, value] pairs
      fileContexts = new Map(result.fileContexts);
    } else if (result.fileContexts && typeof result.fileContexts === 'object') {
      // Serialized as plain object
      fileContexts = new Map(Object.entries(result.fileContexts));
    } else {
      // Fallback to empty Map
      fileContexts = new Map();
    }

    return {
      ...result,
      fileContexts,
    };
  }

  /**
   * Serialize analysis result for JSON storage, converting Map to array
   */
  private serializeAnalysisResult(result: CodebaseAnalysisResult): any {
    return {
      ...result,
      // Convert Map to array of [key, value] pairs for JSON serialization
      fileContexts: Array.from(result.fileContexts.entries()),
    };
  }

  /**
   * Save analysis to cache
   */
  private async saveCache(cacheKey: string, result: CodebaseAnalysisResult): Promise<void> {
    try {
      const cacheFile = path.join(this.config.projectRoot, '.devloop', 'cache', 'analysis.json');
      await fs.ensureDir(path.dirname(cacheFile));

      const currentHash = await this.computeSourceHash();
      const cached: CachedAnalysis = {
        hash: currentHash,
        result: this.serializeAnalysisResult(result) as CodebaseAnalysisResult,
        timestamp: Date.now(),
      };

      // Load existing cache and update
      let cacheData: Record<string, CachedAnalysis> = {};
      if (await fs.pathExists(cacheFile)) {
        try {
          cacheData = await fs.readJson(cacheFile);
        } catch {
          // If cache file is corrupted, start fresh
          cacheData = {};
        }
      }

      cacheData[cacheKey] = cached;
      await fs.writeJson(cacheFile, cacheData, { spaces: 2 });
    } catch (error) {
      logger.debug(`[CodebaseAnalyzer] Failed to save cache: ${error}`);
      // Don't throw - caching is optional
    }
  }

  /**
   * Persist discovered patterns to the pattern library for cross-session learning
   */
  private async persistPatternsToLibrary(result: CodebaseAnalysisResult): Promise<void> {
    try {
      // Load existing pattern library
      await this.patternLibraryManager.load();

      // Convert discovered patterns to pattern library format
      const now = new Date().toISOString();
      let addedCodePatterns = 0;
      let addedSchemaPatterns = 0;
      let addedTestPatterns = 0;

      // Process code patterns
      if (result.patterns && result.patterns.length > 0) {
        for (const pattern of result.patterns) {
          this.patternLibraryManager.addCodePattern({
            id: `code-${pattern.type}-${pattern.signature.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '-')}`,
            type: pattern.type as 'schema' | 'plugin' | 'service' | 'test' | 'config',
            signature: pattern.signature,
            files: pattern.files,
            occurrences: pattern.occurrences,
            discoveredAt: now,
            lastUsedAt: now,
            frameworkHints: this.frameworkPlugin ? [this.frameworkPlugin.name] : undefined,
          });
          addedCodePatterns++;
        }
      }

      // Process schema patterns
      if (result.schemaPatterns && result.schemaPatterns.length > 0) {
        for (const pattern of result.schemaPatterns) {
          this.patternLibraryManager.addSchemaPattern({
            id: `schema-${pattern.type}-${pattern.pattern.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '-')}`,
            type: pattern.type,
            pattern: pattern.pattern,
            exampleFiles: pattern.examples, // Map from 'examples' to 'exampleFiles'
            framework: this.frameworkPlugin?.name || 'generic',
          });
          addedSchemaPatterns++;
        }
      }

      // Process test patterns
      if (result.testPatterns && result.testPatterns.length > 0) {
        for (const pattern of result.testPatterns) {
          this.patternLibraryManager.addTestPattern({
            id: `test-${pattern.framework}-${pattern.structure.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '-')}`,
            framework: pattern.framework,
            structure: pattern.structure,
            exampleFiles: pattern.examples, // Map from 'examples' to 'exampleFiles'
            successRate: undefined, // Will be populated by execution intelligence
          });
          addedTestPatterns++;
        }
      }

      // Save updated library
      await this.patternLibraryManager.save();

      if (addedCodePatterns + addedSchemaPatterns + addedTestPatterns > 0) {
        logger.debug(`[CodebaseAnalyzer] Persisted ${addedCodePatterns} code patterns, ${addedSchemaPatterns} schema patterns, ${addedTestPatterns} test patterns to library`);
      }
    } catch (error) {
      logger.debug(`[CodebaseAnalyzer] Failed to persist patterns to library: ${error}`);
      // Don't throw - pattern persistence is optional
    }
  }

  /**
   * Check if cached analysis is still valid
   */
  private async isValidCache(cached: CachedAnalysis): Promise<boolean> {
    // Cache valid for 1 hour or until source files change
    const age = Date.now() - cached.timestamp;
    if (age > 3600000) {
      return false; // Cache expired (1 hour)
    }

    const currentHash = await this.computeSourceHash();
    return currentHash === cached.hash;
  }

  /**
   * Compute hash of relevant source files for cache invalidation
   */
  private async computeSourceHash(): Promise<string> {
    try {
      // Hash key source files (config, package.json, etc.)
      const hashFiles = [
        path.join(this.config.projectRoot, 'devloop.config.js'),
        path.join(this.config.projectRoot, 'package.json'),
        path.join(this.config.projectRoot, 'tsconfig.json'),
      ];

      const hasher = crypto.createHash('sha256');

      for (const file of hashFiles) {
        if (await fs.pathExists(file)) {
          const content = await fs.readFile(file, 'utf-8');
          hasher.update(content);
        }
      }

      // Also include framework type from config
      const frameworkType = this.config.projectConfig?.framework?.type || '';
      hasher.update(frameworkType);

      return hasher.digest('hex');
    } catch (error) {
      logger.debug(`[CodebaseAnalyzer] Failed to compute source hash: ${error}`);
      // Return a default hash if computation fails
      return crypto.createHash('sha256').update('default').digest('hex');
    }
  }

  /**
   * Discover relevant files using semantic file discovery
   */
  private async discoverRelevantFiles(
    query?: string,
    frameworkPlugin?: FrameworkPlugin,
    targetModule?: string
  ): Promise<string[]> {
    // If we have semantic discovery, use it
    if (this.config.useSemanticDiscovery && this.semanticDiscovery && query) {
      const discoveryQuery: DiscoveryQuery = {
        query: query,
        maxResults: this.config.maxFiles,
        minScore: 0.3,
        includeRelated: true,
        includePatterns: this.config.includePatterns.length > 0 ? this.config.includePatterns : undefined,
        excludePatterns: this.config.excludePatterns.length > 0 ? this.config.excludePatterns : undefined,
      };

      // Add framework-specific patterns
      if (frameworkPlugin) {
        discoveryQuery.includePatterns = [
          ...(discoveryQuery.includePatterns || []),
          ...frameworkPlugin.getFileExtensions().map(ext => `**/*.${ext}`),
        ];
      }

      // Filter by target module if specified
      if (targetModule && frameworkPlugin?.getTargetModulePaths) {
        const modulePaths = frameworkPlugin.getTargetModulePaths(targetModule);
        if (modulePaths.length > 0) {
          discoveryQuery.seedFiles = modulePaths;
        }
      }

      try {
        const results = await this.semanticDiscovery.discoverFiles(discoveryQuery);
        return results.map(r => r.filePath);
      } catch (error) {
        logger.warn(`[CodebaseAnalyzer] Semantic discovery failed: ${error}, falling back to file system scan`);
      }
    }

    // Fallback to file system scan using framework patterns
    return await this.scanFileSystem(frameworkPlugin, targetModule);
  }

  /**
   * Scan file system for relevant files
   */
  private async scanFileSystem(
    frameworkPlugin?: FrameworkPlugin,
    targetModule?: string
  ): Promise<string[]> {
    const files: string[] = [];

    // Combine framework-specific and project config paths
    const codebaseConfig = this.config.projectConfig?.codebase || {};
    const frameworkSearchDirs = frameworkPlugin?.getSearchDirs() || [];
    const frameworkExtensions = frameworkPlugin?.getFileExtensions() || [];
    const frameworkExcludeDirs = frameworkPlugin?.getExcludeDirs() || [];

    // Merge search directories (framework + project config editablePaths + searchDirs)
    const searchDirs = [
      ...frameworkSearchDirs,
      ...(codebaseConfig.searchDirs || []),
      ...(codebaseConfig.editablePaths || []), // Include editable paths for discovery
    ].filter((dir, index, self) => self.indexOf(dir) === index); // Remove duplicates

    // Merge extensions (framework + project config)
    const extensions = [
      ...frameworkExtensions,
      ...(codebaseConfig.extensions || []),
    ].filter((ext, index, self) => self.indexOf(ext) === index); // Remove duplicates

    // Merge exclude directories (framework + project config excludeDirs + protectedPaths)
    const excludeDirs = [
      ...frameworkExcludeDirs,
      ...(codebaseConfig.excludeDirs || []),
      ...(codebaseConfig.protectedPaths || []), // Exclude protected paths
    ].filter((dir, index, self) => self.indexOf(dir) === index); // Remove duplicates

    // Filter by target module if specified
    let patterns: string[] = [];
    if (targetModule && frameworkPlugin?.getTargetModulePaths) {
      const modulePaths = frameworkPlugin.getTargetModulePaths(targetModule);
      for (const modulePath of modulePaths) {
        for (const ext of extensions) {
          patterns.push(`${modulePath}/**/*.${ext}`);
        }
      }
    } else {
      // Scan all search directories
      for (const dir of searchDirs) {
        for (const ext of extensions) {
          patterns.push(`${dir}/**/*.${ext}`);
        }
      }
    }

    // Limit results
    const maxResults = this.config.maxFiles;

    // Use fast-glob with ignore patterns
    const ignorePatterns = [
      ...excludeDirs.map(d => `**/${d}/**`),
      ...(codebaseConfig.ignoreGlobs || []),
    ];

    try {
      const allMatches = await fg(patterns.slice(0, 10), {
        cwd: this.config.projectRoot,
        absolute: true,
        ignore: ignorePatterns,
        onlyFiles: true,
      });

      // Filter discovered files to only include editable paths (unless querying for documentation)
      let filteredFiles = allMatches;
      if (codebaseConfig.editablePaths && codebaseConfig.editablePaths.length > 0) {
        filteredFiles = allMatches.filter(file =>
          codebaseConfig.editablePaths!.some(editablePath => {
            const normalizedPath = path.resolve(this.config.projectRoot, editablePath);
            const normalizedFile = path.resolve(file);
            return normalizedFile.startsWith(normalizedPath + path.sep) || normalizedFile === normalizedPath;
          })
        );
      }

      files.push(...filteredFiles.slice(0, maxResults));
    } catch (error) {
      logger.warn(`[CodebaseAnalyzer] Failed to scan file system: ${error}`);
    }

    return files.slice(0, maxResults);
  }

  /**
   * Find documentation files using documentationPaths from config
   */
  async findDocumentationFiles(query?: string): Promise<string[]> {
    const codebaseConfig = this.config.projectConfig?.codebase || {};
    const docPaths = codebaseConfig.documentationPaths || [];

    if (docPaths.length === 0) {
      logger.debug('[CodebaseAnalyzer] No documentationPaths configured, skipping documentation search');
      return [];
    }

    // Search documentation paths for relevant files
    const patterns = docPaths.map(docPath => {
      const normalizedPath = docPath.endsWith('/') ? docPath : `${docPath}/`;
      return `${normalizedPath}**/*.{md,yml,yaml,txt}`;
    });

    try {
      const files = await fg(patterns, {
        cwd: this.config.projectRoot,
        absolute: true,
        onlyFiles: true,
        ignore: [
          '**/node_modules/**',
          '**/vendor/**',
          '**/.git/**',
        ],
      });

      // Optionally filter by query using semantic discovery if enabled
      if (query && this.config.useSemanticDiscovery && this.semanticDiscovery) {
        await this.semanticDiscovery.initialize();
        const discoveryQuery: DiscoveryQuery = {
          query: query,
          seedFiles: files.slice(0, 20), // Use first 20 as seed files
          maxResults: this.config.maxFiles,
          minScore: 0.5, // Lower threshold for documentation
        };

        try {
          const results = await this.semanticDiscovery.discoverFiles(discoveryQuery);
          return results.map(r => r.filePath);
        } catch (error) {
          logger.warn(`[CodebaseAnalyzer] Semantic discovery failed for documentation: ${error}, returning all files`);
        }
      }

      return files.slice(0, this.config.maxFiles);
    } catch (error) {
      logger.warn(`[CodebaseAnalyzer] Failed to find documentation files: ${error}`);
      return [];
    }
  }

  /**
   * Extract file contexts using CodeContextProvider
   */
  private async extractFileContexts(filePaths: string[]): Promise<Map<string, FileContext>> {
    const contexts = new Map<string, FileContext>();

    for (const filePath of filePaths.slice(0, this.config.maxFiles)) {
      try {
        const context = await this.contextProvider.getFileContext(filePath);
        if (context) {
          contexts.set(filePath, context);
        }
      } catch (error) {
        logger.debug(`[CodebaseAnalyzer] Failed to extract context from ${filePath}: ${error}`);
      }
    }

    return contexts;
  }

  /**
   * Build codebase context summary
   */
  private buildCodebaseContext(
    fileContexts: Map<string, FileContext>,
    frameworkPlugin?: FrameworkPlugin
  ): string {
    const contextParts: string[] = [];

    // Framework information
    if (frameworkPlugin) {
      contextParts.push(`Framework: ${frameworkPlugin.name}`);
      contextParts.push(`Description: ${frameworkPlugin.description}`);
    }

    // File count
    contextParts.push(`\nAnalyzed ${fileContexts.size} files`);

    // Extract common patterns
    const allImports = new Set<string>();
    const allSignatures = new Set<string>();

    for (const context of fileContexts.values()) {
      context.imports.forEach(imp => allImports.add(imp));
      context.helperSignatures.forEach(sig => allSignatures.add(sig));
    }

    // Add imports summary
    if (allImports.size > 0) {
      contextParts.push(`\nCommon imports (${allImports.size}):`);
      Array.from(allImports).slice(0, 10).forEach(imp => {
        contextParts.push(`  - ${imp}`);
      });
      if (allImports.size > 10) {
        contextParts.push(`  ... and ${allImports.size - 10} more`);
      }
    }

    // Add signatures summary
    if (allSignatures.size > 0) {
      contextParts.push(`\nAvailable functions/classes (${allSignatures.size}):`);
      Array.from(allSignatures).slice(0, 15).forEach(sig => {
        contextParts.push(`  - ${sig}`);
      });
      if (allSignatures.size > 15) {
        contextParts.push(`  ... and ${allSignatures.size - 15} more`);
      }
    }

    // Limit total context size
    const context = contextParts.join('\n');
    if (context.length > this.config.maxContextChars) {
      return context.substring(0, this.config.maxContextChars - 100) + '\n... (truncated)';
    }

    return context;
  }

  /**
   * Detect feature types from file contexts (basic implementation)
   */
  private async detectFeatureTypes(
    fileContexts: Map<string, FileContext>,
    frameworkPlugin?: FrameworkPlugin
  ): Promise<string[]> {
    const featureTypes = new Set<string>();

    // Basic feature type detection based on file names and paths
    for (const [filePath, context] of fileContexts.entries()) {
      const fileName = path.basename(filePath);
      const dirName = path.dirname(filePath);

      // Detect based on file names
      if (fileName.includes('entity') || fileName.includes('Entity')) {
        featureTypes.add('entity');
      }
      if (fileName.includes('form') || fileName.includes('Form')) {
        featureTypes.add('form');
      }
      if (fileName.includes('plugin') || fileName.includes('Plugin')) {
        featureTypes.add('plugin');
      }
      if (fileName.includes('service') || fileName.includes('Service')) {
        featureTypes.add('service');
      }
      if (fileName.includes('controller') || fileName.includes('Controller')) {
        featureTypes.add('controller');
      }
      if (fileName.includes('validator') || fileName.includes('Validator')) {
        featureTypes.add('validator');
      }
      if (fileName.includes('schema') || dirName.includes('schema')) {
        featureTypes.add('schema');
      }
      if (fileName.includes('config') || dirName.includes('config')) {
        featureTypes.add('config');
      }

      // Detect based on file extensions
      if (filePath.endsWith('.test.ts') || filePath.endsWith('.spec.ts')) {
        featureTypes.add('test');
      }
    }

    return Array.from(featureTypes);
  }

  /**
   * Extract code patterns from file contexts
   */
  private extractPatterns(
    fileContexts: Map<string, FileContext>
  ): Array<{ type: string; signature: string; files: string[]; occurrences: number }> {
    const patterns = new Map<string, { signature: string; files: Set<string> }>();

    for (const [filePath, context] of fileContexts.entries()) {
      for (const signature of context.helperSignatures) {
        const key = signature.toLowerCase();
        if (!patterns.has(key)) {
          patterns.set(key, { signature, files: new Set() });
        }
        patterns.get(key)!.files.add(filePath);
      }
    }

    return Array.from(patterns.entries()).map(([key, pattern]) => ({
      type: 'function',
      signature: pattern.signature,
      files: Array.from(pattern.files),
      occurrences: pattern.files.size,
    }));
  }

  /**
   * Extract schema patterns from file contexts
   */
  private extractSchemaPatterns(
    fileContexts: Map<string, FileContext>,
    frameworkPlugin?: FrameworkPlugin
  ): Array<{ type: string; pattern: string; examples: string[] }> {
    const schemaPatterns: Array<{ type: string; pattern: string; examples: string[] }> = [];

    // Look for schema files (YAML config schemas, etc.)
    for (const filePath of fileContexts.keys()) {
      if (filePath.includes('schema') || filePath.endsWith('.schema.yml')) {
        schemaPatterns.push({
          type: 'config-schema',
          pattern: 'YAML schema definition',
          examples: [filePath],
        });
      }
    }

    return schemaPatterns;
  }

  /**
   * Extract test patterns from file contexts
   */
  private extractTestPatterns(
    fileContexts: Map<string, FileContext>,
    frameworkPlugin?: FrameworkPlugin
  ): Array<{ framework: string; structure: string; examples: string[] }> {
    const testPatterns: Array<{ framework: string; structure: string; examples: string[] }> = [];

    for (const [filePath, context] of fileContexts.entries()) {
      if (context.testPatterns && context.testPatterns.length > 0) {
        testPatterns.push({
          framework: frameworkPlugin?.name || 'generic',
          structure: context.testPatterns.map(t => t.structure).join('; '),
          examples: [filePath],
        });
      }
    }

    return testPatterns;
  }

  /**
   * Get empty result for skip analysis case
   */
  private getEmptyResult(): CodebaseAnalysisResult {
    return {
      projectRoot: this.config.projectRoot,
      relevantFiles: [],
      fileContexts: new Map(),
      codebaseContext: 'Analysis skipped',
      framework: undefined,
      frameworkPlugin: undefined,
      featureTypes: [],
    };
  }

  /**
   * Set semantic file discovery (optional, for better semantic search)
   */
  setSemanticDiscovery(discovery: SemanticFileDiscovery): void {
    this.semanticDiscovery = discovery;
  }

  /**
   * Generate research findings for a specific task
   * Uses existing pattern detection but structures output for spec-kit
   */
  async generateResearchForTask(task: {
    id: string;
    title: string;
    description: string;
    files?: string[];
  }): Promise<Array<{ topic: string; findings: string; relevantFiles?: string[] }>> {
    const findings: Array<{ topic: string; findings: string; relevantFiles?: string[] }> = [];

    try {
      // 1. Find relevant files using semantic discovery if available
      let relevantFiles: string[] = [];
      if (this.semanticDiscovery && this.config.useSemanticDiscovery) {
        const discovered = await this.semanticDiscovery.discoverFiles({
          query: `${task.title} ${task.description}`,
          maxResults: 10,
        });
        relevantFiles = discovered.map(f => f.filePath);
      } else if (task.files?.length) {
        relevantFiles = task.files;
      }

      // 2. Detect patterns in those files
      if (relevantFiles.length > 0) {
        const fileContexts = new Map<string, FileContext>();
        for (const filePath of relevantFiles.slice(0, 5)) {
          try {
            const fullPath = path.resolve(this.config.projectRoot, filePath);
            if (await fs.pathExists(fullPath)) {
              const context = await this.contextProvider.getFileContext(fullPath);
              fileContexts.set(filePath, context);
            }
          } catch {
            // Skip files that can't be read
          }
        }

        // Extract patterns from file contexts
        const patterns = this.extractPatterns(fileContexts);
        for (const pattern of patterns) {
          findings.push({
            topic: `${pattern.type} pattern`,
            findings: pattern.signature,
            relevantFiles: pattern.files.slice(0, 3),
          });
        }
      }

      // 3. Add framework-specific patterns if framework detected
      const frameworkPlugin = await this.frameworkLoader.loadFramework();
      if (frameworkPlugin) {
        const frameworkPatterns = frameworkPlugin.getPatterns?.() || [];
        for (const fp of frameworkPatterns) {
          // Check if this pattern is relevant to the task
          const descLower = task.description.toLowerCase();
          const patternLower = fp.pattern.toLowerCase();
          if (descLower.includes(patternLower) || descLower.includes(fp.when.toLowerCase())) {
            findings.push({
              topic: `${fp.pattern} pattern`,
              findings: `Use ${fp.pattern} when ${fp.when}`,
              relevantFiles: fp.reference ? [fp.reference] : [],
            });
          }
        }
      }
    } catch (error) {
      logger.debug(`[CodebaseAnalyzer] Error generating research for task ${task.id}: ${error}`);
    }

    return findings;
  }

  /**
   * Detect tech stack from codebase
   * Uses existing framework detection but adds patterns
   */
  async detectTechStack(): Promise<{
    framework?: string;
    patterns?: string[];
    constraints?: string[];
  }> {
    try {
      // Use existing framework detection
      const frameworkPlugin = await this.frameworkLoader.loadFramework();
      const framework = frameworkPlugin?.name || 'generic';

      // Get patterns from cached analysis if available
      const patterns: string[] = [];

      // Extract constraints from framework plugin
      const constraints = frameworkPlugin?.getConstraints?.() || [];

      return {
        framework,
        patterns: [...new Set(patterns)],
        constraints,
      };
    } catch (error) {
      logger.debug(`[CodebaseAnalyzer] Error detecting tech stack: ${error}`);
      return {
        framework: 'generic',
        patterns: [],
        constraints: [],
      };
    }
  }
}
