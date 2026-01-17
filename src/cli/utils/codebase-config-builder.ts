/**
 * Codebase Config Builder
 *
 * Helper functions for building complete dev-loop config from codebase analysis.
 * Detects paths, patterns, extensions, and other configuration values from analysis results.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { CodebaseAnalysisResult } from '../../core/analysis/codebase-analyzer';
import { FrameworkPlugin } from '../../frameworks';
import { ConstitutionAnalysis } from './constitution-analyzer';
import { Config } from '../../config/schema/core';

/**
 * Options for building config from analysis
 */
export interface ConfigBuildOptions {
  codebaseAnalysis: CodebaseAnalysisResult;
  framework?: FrameworkPlugin | null;
  constitution?: ConstitutionAnalysis | null;
  projectRoot: string;
}

/**
 * Build complete config suggestions from codebase analysis
 *
 * @param options - Build options with analysis results
 * @returns Partial config with suggested values
 */
export function buildCompleteConfigFromAnalysis(options: ConfigBuildOptions): Partial<Config> {
  const { codebaseAnalysis, framework, constitution, projectRoot } = options;
  const suggestions: Partial<Config> = {};

  // 1. Build codebase config
  suggestions.codebase = buildCodebaseConfig(codebaseAnalysis, framework, constitution);

  // 2. Build validation config from test patterns
  const validationConfig = buildValidationConfig(codebaseAnalysis, framework, projectRoot);
  if (validationConfig) {
    suggestions.validation = validationConfig;
  }

  // 3. Build hooks config from framework
  const hooksConfig = buildHooksConfig(framework, constitution);
  if (hooksConfig) {
    suggestions.hooks = hooksConfig;
  }

  // 4. Build context config
  suggestions.context = buildContextConfig(codebaseAnalysis, framework);

  // 5. Build testing config from test patterns
  const testingConfig = buildTestingConfig(codebaseAnalysis, framework);
  if (testingConfig) {
    suggestions.testing = testingConfig as Config['testing'];
  }

  // 6. Build logs config from framework
  const logsConfig = buildLogsConfig(framework, constitution);
  if (logsConfig) {
    suggestions.logs = logsConfig as Config['logs'];
  }

  // 7. Build rules config
  const rulesConfig = buildRulesConfig(projectRoot);
  if (rulesConfig) {
    suggestions.rules = rulesConfig;
  }

  // 8. Build framework config
  if (framework && framework.name !== 'generic') {
    suggestions.framework = {
      type: framework.name,
      rules: framework.getConstraints?.() || [],
    };
  }

  return suggestions;
}

/**
 * Build codebase config section
 */
function buildCodebaseConfig(
  analysis: CodebaseAnalysisResult,
  framework?: FrameworkPlugin | null,
  constitution?: ConstitutionAnalysis | null
): Config['codebase'] {
  const config: Config['codebase'] = {};

  // Extensions from relevant files
  const extensions = detectExtensions(analysis.relevantFiles);
  if (extensions.length > 0) {
    config.extensions = extensions;
  }

  // Search directories
  const searchDirs = framework?.getSearchDirs?.() || detectSearchDirs(analysis);
  if (searchDirs.length > 0) {
    config.searchDirs = searchDirs;
  }

  // Exclude directories
  const excludeDirs = framework?.getExcludeDirs?.() || detectExcludeDirs(analysis);
  if (excludeDirs.length > 0) {
    config.excludeDirs = excludeDirs;
  }

  // Ignore patterns
  const ignoreGlobs = detectIgnorePatterns(analysis, framework);
  if (ignoreGlobs.length > 0) {
    config.ignoreGlobs = ignoreGlobs;
  }

  // Editable paths (from constitution or detection)
  const editablePaths = constitution?.editablePaths || detectEditablePaths(analysis, framework);
  if (editablePaths.length > 0) {
    config.editablePaths = editablePaths;
  }

  // Protected paths (from constitution or detection)
  const protectedPaths = constitution?.protectedPaths || detectProtectedPaths(analysis, framework);
  if (protectedPaths.length > 0) {
    config.protectedPaths = protectedPaths;
  }

  // File path patterns from framework (convert RegExp to string)
  const filePathPatterns = framework?.getErrorPathPatterns?.();
  if (filePathPatterns && filePathPatterns.length > 0) {
    config.filePathPatterns = filePathPatterns.map(p => p.source);
  }

  // Identifier stopwords
  const stopwords = detectCommonStopwords(analysis);
  if (stopwords.length > 0) {
    config.identifierStopwords = stopwords;
  }

  // Documentation paths
  const docPaths = constitution?.documentationPaths || detectDocumentationPaths(analysis);
  if (docPaths.length > 0) {
    config.documentationPaths = docPaths;
  }

  return config;
}

/**
 * Detect file extensions from relevant files
 */
function detectExtensions(files: string[]): string[] {
  const extCounts = new Map<string, number>();

  for (const file of files) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (ext && ext.length > 0 && ext.length <= 10) {
      extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
    }
  }

  // Sort by count and return top extensions
  return Array.from(extCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([ext]) => ext);
}

/**
 * Detect search directories from file paths
 */
function detectSearchDirs(analysis: CodebaseAnalysisResult): string[] {
  const dirCounts = new Map<string, number>();

  for (const file of analysis.relevantFiles) {
    const parts = file.split(path.sep);
    // Take first 2-3 directory parts
    if (parts.length >= 2) {
      const topDir = parts.slice(0, 2).join('/');
      dirCounts.set(topDir, (dirCounts.get(topDir) || 0) + 1);
    }
  }

  // Return top directories with most files
  return Array.from(dirCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([dir]) => dir);
}

/**
 * Detect exclude directories
 */
function detectExcludeDirs(analysis: CodebaseAnalysisResult): string[] {
  const commonExcludes = [
    'node_modules',
    'vendor',
    '.git',
    '.devloop',
    'dist',
    'build',
    'coverage',
    'test-results',
  ];

  // Add framework-specific excludes based on detected framework
  if (analysis.framework === 'drupal') {
    commonExcludes.push('docroot/core', 'docroot/modules/contrib', 'docroot/themes/contrib');
  }

  return commonExcludes;
}

/**
 * Detect ignore patterns from codebase structure
 */
function detectIgnorePatterns(
  analysis: CodebaseAnalysisResult,
  framework?: FrameworkPlugin | null
): string[] {
  const patterns: string[] = [
    '**/*.min.js',
    '**/*.min.css',
    '**/*.map',
    '**/package-lock.json',
    '**/composer.lock',
    '**/.cache/**',
  ];

  // Add test-related patterns based on detected test framework
  if (analysis.testPatterns && analysis.testPatterns.length > 0) {
    for (const testPattern of analysis.testPatterns) {
      if (testPattern.framework === 'playwright') {
        patterns.push('**/playwright-report/**');
        patterns.push('**/test-results/**');
      } else if (testPattern.framework === 'jest') {
        patterns.push('**/__snapshots__/**');
        patterns.push('**/coverage/**');
      }
    }
  }

  // Add framework-specific patterns
  if (framework?.name === 'drupal') {
    patterns.push('**/files/**', '**/private/**', '**/simpletest/**');
  }

  return [...new Set(patterns)];
}

/**
 * Detect editable paths based on analysis and framework
 */
function detectEditablePaths(
  analysis: CodebaseAnalysisResult,
  framework?: FrameworkPlugin | null
): string[] {
  const editablePaths: string[] = [];

  // Get from framework
  const codeLocationRules = framework?.getCodeLocationRules?.();
  if (codeLocationRules) {
    Object.entries(codeLocationRules).forEach(([key, path]) => {
      if (key.toLowerCase().includes('custom') || key.toLowerCase().includes('share')) {
        editablePaths.push(path);
      }
    });
  }

  // Detect from file patterns
  for (const file of analysis.relevantFiles) {
    if (file.includes('/share/') || file.includes('/custom/') || file.includes('/src/')) {
      const dir = path.dirname(file).split('/').slice(0, 3).join('/');
      if (!editablePaths.includes(dir)) {
        editablePaths.push(dir);
      }
    }
  }

  return [...new Set(editablePaths)];
}

/**
 * Detect protected paths based on analysis and framework
 */
function detectProtectedPaths(
  analysis: CodebaseAnalysisResult,
  framework?: FrameworkPlugin | null
): string[] {
  const protectedPaths: string[] = ['node_modules', 'vendor', '.git'];

  // Get from framework
  const codeLocationRules = framework?.getCodeLocationRules?.();
  if (codeLocationRules) {
    Object.entries(codeLocationRules).forEach(([key, pathValue]) => {
      if (key.toLowerCase().includes('core') || key.toLowerCase().includes('contrib')) {
        protectedPaths.push(pathValue);
      }
    });
  }

  // Drupal-specific
  if (analysis.framework === 'drupal') {
    protectedPaths.push('docroot/core', 'docroot/modules/contrib', 'docroot/themes/contrib');
  }

  return [...new Set(protectedPaths)];
}

/**
 * Detect common stopwords in identifiers
 */
function detectCommonStopwords(analysis: CodebaseAnalysisResult): string[] {
  // Framework-agnostic common stopwords
  const stopwords = ['get', 'set', 'is', 'has', 'can', 'do', 'on', 'the', 'a', 'an'];

  // Add framework-specific stopwords
  if (analysis.framework === 'drupal') {
    stopwords.push('drupal', 'module', 'theme', 'plugin', 'entity', 'field', 'config');
  } else if (analysis.framework === 'react') {
    stopwords.push('component', 'hook', 'use', 'render', 'handle', 'props');
  }

  return stopwords;
}

/**
 * Detect documentation paths from analysis
 */
function detectDocumentationPaths(analysis: CodebaseAnalysisResult): string[] {
  const docPaths: string[] = [];
  const docIndicators = ['docs', 'documentation', 'README', 'CLAUDE.md', '.md'];

  for (const file of analysis.relevantFiles) {
    const lowerFile = file.toLowerCase();
    if (docIndicators.some(ind => lowerFile.includes(ind.toLowerCase()))) {
      const dir = path.dirname(file);
      if (dir !== '.' && !docPaths.includes(dir)) {
        docPaths.push(dir);
      }
    }
  }

  // Add common documentation directories
  if (!docPaths.includes('docs')) {
    docPaths.push('docs');
  }

  return [...new Set(docPaths)];
}

/**
 * Build validation config from test patterns
 */
function buildValidationConfig(
  analysis: CodebaseAnalysisResult,
  framework?: FrameworkPlugin | null,
  projectRoot?: string
): Config['validation'] | null {
  if (!analysis.testPatterns || analysis.testPatterns.length === 0) {
    return null;
  }

  const playwrightTest = analysis.testPatterns.find(t => t.framework === 'playwright');
  if (!playwrightTest) {
    return null;
  }

  return {
    enabled: true,
    baseUrl: detectBaseUrl(projectRoot || '', framework),
    urls: detectImportantUrls(analysis),
    timeout: 15000,
    authCommand: (framework as any)?.getAuthCommand?.() || undefined,
  };
}

/**
 * Detect base URL for validation
 */
function detectBaseUrl(projectRoot: string, framework?: FrameworkPlugin | null): string {
  // Framework-specific defaults
  if (framework?.name === 'drupal') {
    return 'https://sysf.ddev.site'; // DDEV default
  } else if (framework?.name === 'react' || framework?.name === 'nextjs') {
    return 'http://localhost:3000';
  }

  return 'http://localhost:8080';
}

/**
 * Detect important URLs from test patterns
 */
function detectImportantUrls(analysis: CodebaseAnalysisResult): string[] {
  const urls: string[] = ['/'];

  // Add common validation URLs based on framework
  if (analysis.framework === 'drupal') {
    urls.push('/admin', '/node', '/user');
  } else if (analysis.framework === 'react') {
    urls.push('/app', '/login');
  }

  return urls;
}

/**
 * Build hooks config from framework
 */
function buildHooksConfig(
  framework?: FrameworkPlugin | null,
  constitution?: ConstitutionAnalysis | null
): Config['hooks'] | null {
  const hooks: string[] = [];

  // Get cache command from framework
  const cacheCommand = framework?.getCacheCommand?.();
  if (cacheCommand) {
    hooks.push(cacheCommand);
  }

  // Get from constitution tool requirements
  if (constitution?.toolRequirements?.includes('ddev') && constitution?.toolRequirements?.includes('drush')) {
    if (!hooks.includes('ddev exec drush cr')) {
      hooks.push('ddev exec drush cr');
    }
  }

  if (hooks.length === 0) {
    return null;
  }

  return {
    preTest: hooks,
    postApply: hooks,
  };
}

/**
 * Build context config
 */
function buildContextConfig(
  analysis: CodebaseAnalysisResult,
  framework?: FrameworkPlugin | null
): Config['context'] {
  return {
    includeSkeleton: true,
    includeImports: true,
    maxHelperSignatures: 10,
  };
}

/**
 * Build testing config from test patterns
 */
function buildTestingConfig(
  analysis: CodebaseAnalysisResult,
  framework?: FrameworkPlugin | null
): Partial<Config['testing']> | null {
  const testPatterns = analysis.testPatterns;

  if (!testPatterns || testPatterns.length === 0) {
    // Default based on framework
    return {
      runner: 'playwright',
      command: framework?.name === 'drupal'
        ? 'cd tests/playwright && npx playwright test'
        : 'npx playwright test',
      timeout: 300000,
      artifactsDir: 'test-results',
    };
  }

  const hasPlaywright = testPatterns.some(t => t.framework === 'playwright');
  const hasCypress = testPatterns.some(t => t.framework === 'cypress');

  return {
    runner: hasPlaywright ? 'playwright' : hasCypress ? 'cypress' : 'playwright',
    command: hasPlaywright
      ? 'npx playwright test'
      : hasCypress
      ? 'npx cypress run'
      : 'npm test',
    timeout: 300000,
    artifactsDir: 'test-results',
  };
}

/**
 * Build logs config from framework
 */
function buildLogsConfig(
  framework?: FrameworkPlugin | null,
  constitution?: ConstitutionAnalysis | null
): Partial<Config['logs']> | null {
  const sources: Array<{ type: 'file' | 'command'; path?: string; command?: string }> = [];

  // Framework-specific log sources
  if (framework?.name === 'drupal') {
    // Check if DDEV is used
    if (constitution?.toolRequirements?.includes('ddev')) {
      sources.push({ type: 'command', command: 'ddev logs -s web' });
    } else {
      sources.push({ type: 'command', command: 'tail -f /var/log/apache2/error.log' });
    }
  } else if (framework?.name === 'nextjs' || framework?.name === 'react') {
    sources.push({ type: 'command', command: 'npm run dev 2>&1' });
  }

  if (sources.length === 0) {
    return null;
  }

  return {
    sources,
    patterns: {
      error: /Error|Exception|Fatal/i,
      warning: /Warning|Deprecated/i,
    },
    useAI: true,
  };
}

/**
 * Build rules config
 */
function buildRulesConfig(projectRoot: string): Config['rules'] | null {
  const cursorRulesPath = detectCursorRulesPath(projectRoot);
  if (cursorRulesPath) {
    return { cursorRulesPath };
  }
  return null;
}

/**
 * Detect .cursorrules file path
 */
function detectCursorRulesPath(projectRoot: string): string | null {
  const possiblePaths = ['.cursorrules', '.cursor/rules', 'CLAUDE.md'];

  for (const relPath of possiblePaths) {
    const fullPath = path.join(projectRoot, relPath);
    if (fs.pathExistsSync(fullPath)) {
      return relPath;
    }
  }

  return null;
}

/**
 * Merge config suggestions with user-provided config
 */
export function mergeConfigSuggestions(
  suggestions: Partial<Config>,
  userConfig: Partial<Config>
): Partial<Config> {
  const merged = { ...suggestions };

  // Deep merge each section
  for (const [key, value] of Object.entries(userConfig)) {
    if (value !== undefined && value !== null) {
      if (typeof value === 'object' && !Array.isArray(value)) {
        (merged as any)[key] = {
          ...(merged as any)[key],
          ...value,
        };
      } else {
        (merged as any)[key] = value;
      }
    }
  }

  return merged;
}
