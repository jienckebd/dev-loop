/**
 * Constitution Analyzer
 *
 * Analyzes parsed constitution rules to extract config hints for dev-loop.
 * Extracts editable/protected paths, framework hints, test patterns, and coding conventions.
 */

import * as path from 'path';
import { ConstitutionRules } from '../../core/prd/parser/planning-doc-parser';

/**
 * Result of analyzing constitution for config generation
 */
export interface ConstitutionAnalysis {
  /** Paths that can be modified (custom code locations) */
  editablePaths: string[];
  /** Paths that should not be modified (core/contrib code) */
  protectedPaths: string[];
  /** Hints about the framework being used */
  frameworkHints: string[];
  /** Detected test-related patterns */
  testPatterns: string[];
  /** Coding conventions extracted from constraints */
  codingConventions: string[];
  /** Tool requirements (e.g., "use DDEV", "use Drush") */
  toolRequirements: string[];
  /** Architecture patterns (e.g., "plugin-based", "config-driven") */
  architecturePatterns: string[];
  /** Documentation paths */
  documentationPaths: string[];
}

/**
 * Configuration for constitution analysis
 */
export interface ConstitutionAnalyzerConfig {
  /** Project root directory */
  projectRoot: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Keywords that indicate editable (custom) code locations
 */
const EDITABLE_PATH_KEYWORDS = [
  '/share/',
  '/custom/',
  '/modules/custom/',
  '/themes/custom/',
  '/profiles/custom/',
  '/src/',
  '/lib/',
  '/app/',
  '/components/',
];

/**
 * Keywords that indicate protected (core/contrib) code locations
 */
const PROTECTED_PATH_KEYWORDS = [
  '/core/',
  '/contrib/',
  '/modules/contrib/',
  '/vendor/',
  '/node_modules/',
  '/drupal/core/',
];

/**
 * Keywords that indicate documentation paths
 */
const DOCUMENTATION_KEYWORDS = [
  '/docs/',
  '/documentation/',
  'README',
  'CLAUDE.md',
  '.md',
];

/**
 * Framework indicator keywords
 */
const FRAMEWORK_INDICATORS: Record<string, string[]> = {
  drupal: ['drupal', 'drush', 'ddev', 'docroot', 'modules/share', 'modules/contrib'],
  laravel: ['laravel', 'artisan', 'eloquent', 'blade'],
  rails: ['rails', 'rake', 'ruby', 'activerecord'],
  react: ['react', 'jsx', 'tsx', 'component', 'hook'],
  nextjs: ['next.js', 'nextjs', 'next', 'pages/', 'app/'],
  django: ['django', 'python', 'manage.py', 'settings.py'],
};

/**
 * Tool indicator keywords
 */
const TOOL_INDICATORS: Record<string, string[]> = {
  ddev: ['ddev', 'ddev exec'],
  docker: ['docker', 'docker-compose', 'container'],
  lando: ['lando'],
  vagrant: ['vagrant'],
  composer: ['composer'],
  npm: ['npm', 'yarn', 'pnpm'],
  drush: ['drush'],
};

/**
 * Analyze constitution rules to extract configuration hints
 *
 * @param constitution - Parsed constitution rules
 * @param config - Analyzer configuration
 * @returns Analysis results for config generation
 *
 * @example
 * ```typescript
 * const parser = new ConstitutionParser({ projectRoot: '/path/to/project' });
 * const constitution = await parser.parse();
 * const analysis = analyzeConstitutionForConfig(constitution, { projectRoot: '/path/to/project' });
 *
 * console.log('Editable paths:', analysis.editablePaths);
 * console.log('Protected paths:', analysis.protectedPaths);
 * ```
 */
export function analyzeConstitutionForConfig(
  constitution: ConstitutionRules,
  config: ConstitutionAnalyzerConfig
): ConstitutionAnalysis {
  const analysis: ConstitutionAnalysis = {
    editablePaths: [],
    protectedPaths: [],
    frameworkHints: [],
    testPatterns: [],
    codingConventions: [],
    toolRequirements: [],
    architecturePatterns: [],
    documentationPaths: [],
  };

  // Analyze code locations for editable/protected paths
  analyzeCodeLocations(constitution.codeLocations, analysis);

  // Analyze constraints for conventions, tools, and framework hints
  analyzeConstraints(constitution.constraints, analysis);

  // Analyze patterns for test and architecture patterns
  analyzePatterns(constitution.patterns, analysis);

  // Analyze avoid rules for additional insights
  analyzeAvoidRules(constitution.avoid, analysis);

  // Deduplicate all arrays
  deduplicateAnalysis(analysis);

  return analysis;
}

/**
 * Analyze code locations to extract editable and protected paths
 */
function analyzeCodeLocations(
  locations: string[],
  analysis: ConstitutionAnalysis
): void {
  for (const location of locations) {
    const normalizedLocation = location.toLowerCase();

    // Check for editable paths
    if (EDITABLE_PATH_KEYWORDS.some(keyword => normalizedLocation.includes(keyword.toLowerCase()))) {
      const dir = extractDirectory(location);
      if (dir && !analysis.editablePaths.includes(dir)) {
        analysis.editablePaths.push(dir);
      }
    }

    // Check for protected paths
    if (PROTECTED_PATH_KEYWORDS.some(keyword => normalizedLocation.includes(keyword.toLowerCase()))) {
      const dir = extractDirectory(location);
      if (dir && !analysis.protectedPaths.includes(dir)) {
        analysis.protectedPaths.push(dir);
      }
    }

    // Check for documentation paths
    if (DOCUMENTATION_KEYWORDS.some(keyword => normalizedLocation.includes(keyword.toLowerCase()))) {
      const dir = extractDirectory(location);
      if (dir && !analysis.documentationPaths.includes(dir)) {
        analysis.documentationPaths.push(dir);
      }
    }
  }
}

/**
 * Analyze constraints to extract conventions, tools, and framework hints
 */
function analyzeConstraints(
  constraints: string[],
  analysis: ConstitutionAnalysis
): void {
  for (const constraint of constraints) {
    const lowerConstraint = constraint.toLowerCase();

    // Check for framework hints
    for (const [framework, indicators] of Object.entries(FRAMEWORK_INDICATORS)) {
      if (indicators.some(ind => lowerConstraint.includes(ind))) {
        if (!analysis.frameworkHints.includes(framework)) {
          analysis.frameworkHints.push(framework);
        }
      }
    }

    // Check for tool requirements
    for (const [tool, indicators] of Object.entries(TOOL_INDICATORS)) {
      if (indicators.some(ind => lowerConstraint.includes(ind))) {
        if (!analysis.toolRequirements.includes(tool)) {
          analysis.toolRequirements.push(tool);
        }
      }
    }

    // Extract coding conventions
    if (lowerConstraint.includes('always use') ||
        lowerConstraint.includes('must use') ||
        lowerConstraint.includes('prefer')) {
      analysis.codingConventions.push(constraint);
    }

    // Check for protected path hints in constraints
    if ((lowerConstraint.includes('never') || lowerConstraint.includes('do not')) &&
        (lowerConstraint.includes('modify') || lowerConstraint.includes('edit') || lowerConstraint.includes('change'))) {
      // Extract path mentions
      const pathMatch = constraint.match(/(?:core|contrib|vendor|node_modules)[\w/-]*/gi);
      if (pathMatch) {
        for (const match of pathMatch) {
          if (!analysis.protectedPaths.includes(match)) {
            analysis.protectedPaths.push(match);
          }
        }
      }

      // Special case for Drupal core
      if (lowerConstraint.includes('drupal core') || lowerConstraint.includes('core')) {
        if (!analysis.protectedPaths.includes('docroot/core/')) {
          analysis.protectedPaths.push('docroot/core/');
        }
      }
    }

    // Extract editable path hints from constraints
    if (lowerConstraint.includes('custom changes') ||
        lowerConstraint.includes('live under') ||
        lowerConstraint.includes('must live')) {
      const pathMatch = constraint.match(/`([^`]+)`/);
      if (pathMatch) {
        analysis.editablePaths.push(pathMatch[1]);
      }
    }

    // Check for architecture patterns
    if (lowerConstraint.includes('plugin') || lowerConstraint.includes('extend')) {
      if (!analysis.architecturePatterns.includes('plugin-based')) {
        analysis.architecturePatterns.push('plugin-based');
      }
    }
    if (lowerConstraint.includes('config') || lowerConstraint.includes('configuration')) {
      if (!analysis.architecturePatterns.includes('config-driven')) {
        analysis.architecturePatterns.push('config-driven');
      }
    }
    if (lowerConstraint.includes('dependency injection') || lowerConstraint.includes('inject')) {
      if (!analysis.architecturePatterns.includes('dependency-injection')) {
        analysis.architecturePatterns.push('dependency-injection');
      }
    }
  }
}

/**
 * Analyze patterns for test and architecture patterns
 */
function analyzePatterns(
  patterns: Array<{ pattern: string; when: string }>,
  analysis: ConstitutionAnalysis
): void {
  for (const patternRule of patterns) {
    const lowerWhen = patternRule.when.toLowerCase();
    const lowerPattern = patternRule.pattern.toLowerCase();

    // Check for test patterns
    if (lowerWhen.includes('test') || lowerPattern.includes('test')) {
      analysis.testPatterns.push(`${patternRule.pattern}: ${patternRule.when}`);
    }

    // Check for architecture patterns in patterns
    if (lowerPattern.includes('extend') || lowerPattern.includes('plugin')) {
      if (!analysis.architecturePatterns.includes('plugin-based')) {
        analysis.architecturePatterns.push('plugin-based');
      }
    }
  }
}

/**
 * Analyze avoid rules for additional insights
 */
function analyzeAvoidRules(
  avoidRules: string[],
  analysis: ConstitutionAnalysis
): void {
  for (const rule of avoidRules) {
    const lowerRule = rule.toLowerCase();

    // Check for protected paths in avoid rules
    if (lowerRule.includes('modify') || lowerRule.includes('edit') || lowerRule.includes('change')) {
      const pathMatch = rule.match(/(?:core|contrib|vendor)[\w/-]*/gi);
      if (pathMatch) {
        for (const match of pathMatch) {
          if (!analysis.protectedPaths.includes(match)) {
            analysis.protectedPaths.push(match);
          }
        }
      }
    }

    // Add to coding conventions if it's a style/approach rule
    if (lowerRule.includes('avoid') || lowerRule.includes("don't") || lowerRule.includes('do not')) {
      analysis.codingConventions.push(rule);
    }
  }
}

/**
 * Extract directory from a file path
 */
function extractDirectory(location: string): string {
  // If it looks like a file (has extension), get parent directory
  if (path.extname(location)) {
    return path.dirname(location);
  }
  // Otherwise treat as directory
  return location.replace(/\/$/, '');
}

/**
 * Deduplicate all arrays in analysis
 */
function deduplicateAnalysis(analysis: ConstitutionAnalysis): void {
  for (const key of Object.keys(analysis) as (keyof ConstitutionAnalysis)[]) {
    if (Array.isArray(analysis[key])) {
      (analysis as any)[key] = [...new Set(analysis[key])];
    }
  }
}

/**
 * Convert constitution analysis to config suggestions
 *
 * @param analysis - Constitution analysis results
 * @returns Partial config object with suggested values
 */
export function analysisToConfigSuggestions(
  analysis: ConstitutionAnalysis
): Record<string, any> {
  const suggestions: Record<string, any> = {};

  // Codebase config
  if (analysis.editablePaths.length > 0 || analysis.protectedPaths.length > 0) {
    suggestions.codebase = {};

    if (analysis.editablePaths.length > 0) {
      suggestions.codebase.editablePaths = analysis.editablePaths;
    }

    if (analysis.protectedPaths.length > 0) {
      suggestions.codebase.protectedPaths = analysis.protectedPaths;
    }

    if (analysis.documentationPaths.length > 0) {
      suggestions.codebase.documentationPaths = analysis.documentationPaths;
    }
  }

  // Framework config
  if (analysis.frameworkHints.length > 0) {
    const primaryFramework = analysis.frameworkHints[0];
    suggestions.framework = {
      type: primaryFramework,
    };

    // Add framework-specific rules from conventions
    if (analysis.codingConventions.length > 0) {
      suggestions.framework.rules = analysis.codingConventions.slice(0, 10); // Limit to 10
    }
  }

  // Hooks config based on tool requirements
  if (analysis.toolRequirements.length > 0) {
    const hooks: string[] = [];

    // Drupal/DDEV specific
    if (analysis.toolRequirements.includes('ddev') && analysis.toolRequirements.includes('drush')) {
      hooks.push('ddev exec drush cr');
    } else if (analysis.toolRequirements.includes('drush')) {
      hooks.push('drush cr');
    }

    if (hooks.length > 0) {
      suggestions.hooks = {
        preTest: hooks,
        postApply: hooks,
      };
    }
  }

  // Context config based on architecture
  if (analysis.architecturePatterns.includes('plugin-based')) {
    suggestions.context = {
      includeSkeleton: true,
      includeImports: true,
      maxHelperSignatures: 10,
    };
  }

  return suggestions;
}

/**
 * Format constitution analysis for display
 */
export function formatConstitutionAnalysis(analysis: ConstitutionAnalysis): string {
  const sections: string[] = [];

  if (analysis.frameworkHints.length > 0) {
    sections.push(`Framework: ${analysis.frameworkHints.join(', ')}`);
  }

  if (analysis.editablePaths.length > 0) {
    sections.push(`Editable paths:\n${analysis.editablePaths.map(p => `  - ${p}`).join('\n')}`);
  }

  if (analysis.protectedPaths.length > 0) {
    sections.push(`Protected paths:\n${analysis.protectedPaths.map(p => `  - ${p}`).join('\n')}`);
  }

  if (analysis.toolRequirements.length > 0) {
    sections.push(`Tools: ${analysis.toolRequirements.join(', ')}`);
  }

  if (analysis.architecturePatterns.length > 0) {
    sections.push(`Architecture: ${analysis.architecturePatterns.join(', ')}`);
  }

  return sections.join('\n\n');
}
