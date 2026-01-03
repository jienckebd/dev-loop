import * as fs from 'fs-extra';
import * as path from 'path';
import { FrameworkPlugin, PluginRecommendation, RecommendationPattern } from '../frameworks/interface';
import { PatternLearningSystem, LearnedPattern } from './pattern-learner';
import { ObservationTracker, Observation } from './observation-tracker';

/**
 * Plugin Recommender
 *
 * Analyzes patterns to recommend new plugins, config schemas, or error patterns.
 * Integrates with PatternLearningSystem and ObservationTracker.
 */
export class PluginRecommender {
  private patternLearner: PatternLearningSystem;
  private observationTracker: ObservationTracker;
  private framework: FrameworkPlugin;
  private projectRoot: string;
  private debug: boolean;

  constructor(
    patternLearner: PatternLearningSystem,
    observationTracker: ObservationTracker,
    framework: FrameworkPlugin,
    projectRoot: string,
    debug: boolean = false
  ) {
    this.patternLearner = patternLearner;
    this.observationTracker = observationTracker;
    this.framework = framework;
    this.projectRoot = projectRoot;
    this.debug = debug;
  }

  /**
   * Generate recommendations from all sources
   */
  async generateRecommendations(): Promise<PluginRecommendation[]> {
    const recommendations: PluginRecommendation[] = [];

    // Analyze uncovered error patterns
    recommendations.push(...await this.analyzeUncoveredPatterns());

    // Analyze codebase patterns
    recommendations.push(...await this.analyzeCodebasePatterns());

    // Use framework-specific recommendation patterns
    if (this.framework.getRecommendationPatterns) {
      const frameworkPatterns = this.framework.getRecommendationPatterns();
      recommendations.push(...await this.analyzeFrameworkPatterns(frameworkPatterns));
    }

    // Deduplicate and sort by priority
    return this.deduplicateAndSort(recommendations);
  }

  /**
   * Analyze recurring error patterns not covered by errorGuidance
   */
  async analyzeUncoveredPatterns(): Promise<PluginRecommendation[]> {
    const recommendations: PluginRecommendation[] = [];

    // Load patterns and observations
    await this.patternLearner.load();

    // Get all learned patterns
    const allPatterns = await this.patternLearner.getAllPatterns();

    // Get error patterns from framework
    const frameworkErrorPatterns = this.framework.getErrorPatterns();
    const frameworkPatternKeys = new Set(Object.keys(frameworkErrorPatterns));

    // Find patterns that occur frequently but aren't in framework error patterns
    const uncoveredPatterns = allPatterns.filter((pattern: LearnedPattern) => {
      // Check if pattern matches any framework error pattern
      const matchesFramework = Array.from(frameworkPatternKeys).some(key => {
        return pattern.pattern.toLowerCase().includes(key.toLowerCase()) ||
               key.toLowerCase().includes(pattern.pattern.toLowerCase());
      });

      return !matchesFramework && pattern.occurrences >= 3;
    });

    for (const pattern of uncoveredPatterns) {
      recommendations.push({
        type: 'error-pattern',
        trigger: `Error pattern occurred ${pattern.occurrences} times`,
        suggestion: `Add error pattern to framework errorGuidance: "${pattern.pattern}"`,
        evidence: [
          `Pattern: ${pattern.pattern}`,
          `Occurrences: ${pattern.occurrences}`,
          `Last seen: ${pattern.lastSeen}`,
          `Files: ${pattern.files?.slice(0, 3).join(', ') || 'N/A'}`,
        ],
        priority: pattern.occurrences >= 5 ? 'high' : pattern.occurrences >= 3 ? 'medium' : 'low',
      });
    }

    return recommendations;
  }

  /**
   * Scan codebase for patterns suggesting new config schemas
   */
  async analyzeCodebasePatterns(): Promise<PluginRecommendation[]> {
    const recommendations: PluginRecommendation[] = [];

    // Get framework-specific patterns if available
    const recommendationPatterns = this.framework.getRecommendationPatterns?.() || [];

    // Scan source files for patterns
    const sourceFiles = await this.getSourceFiles();
    const codePatterns = new Map<string, { count: number; files: string[] }>();

    for (const file of sourceFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');

        // Check against framework recommendation patterns
        for (const pattern of recommendationPatterns) {
          const regex = new RegExp(pattern.pattern, 'g');
          const matches = content.match(regex);

          if (matches && matches.length > 0) {
            const key = pattern.id;
            if (!codePatterns.has(key)) {
              codePatterns.set(key, { count: 0, files: [] });
            }
            const entry = codePatterns.get(key)!;
            entry.count += matches.length;
            if (!entry.files.includes(file)) {
              entry.files.push(file);
            }
          }
        }

        // Look for common patterns that suggest config schemas
        // Example: Repeated configuration patterns, plugin definitions, etc.
        const configPatterns = [
          {
            pattern: /(?:interface|type|class)\s+(\w+Config)\s*[={]/g,
            type: 'config-schema' as const,
            description: 'Config interface/type definitions',
          },
          {
            pattern: /(?:export\s+)?(?:const|let)\s+(\w+Config)\s*=/g,
            type: 'config-schema' as const,
            description: 'Config constant definitions',
          },
        ];

        for (const configPattern of configPatterns) {
          const matches = Array.from(content.matchAll(configPattern.pattern));
          if (matches.length >= 3) {
            const key = `config-${configPattern.type}-${file}`;
            if (!codePatterns.has(key)) {
              codePatterns.set(key, { count: 0, files: [] });
            }
            const entry = codePatterns.get(key)!;
            entry.count += matches.length;
            if (!entry.files.includes(file)) {
              entry.files.push(file);
            }
          }
        }
      } catch (error) {
        if (this.debug) {
          console.warn(`[PluginRecommender] Failed to analyze ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Generate recommendations from code patterns
    for (const [key, data] of codePatterns.entries()) {
      if (data.count >= 3) {
        const matchingPattern = recommendationPatterns.find(p => p.id === key);
        recommendations.push({
          type: matchingPattern?.recommendationType || 'config-schema',
          trigger: `Found ${data.count} occurrences in ${data.files.length} file(s)`,
          suggestion: `Consider creating a config schema for: ${key}`,
          evidence: [
            `Occurrences: ${data.count}`,
            `Files: ${data.files.slice(0, 3).join(', ')}${data.files.length > 3 ? '...' : ''}`,
          ],
          priority: data.count >= 10 ? 'high' : data.count >= 5 ? 'medium' : 'low',
        });
      }
    }

    return recommendations;
  }

  /**
   * Analyze framework-specific recommendation patterns
   */
  private async analyzeFrameworkPatterns(patterns: RecommendationPattern[]): Promise<PluginRecommendation[]> {
    const recommendations: PluginRecommendation[] = [];
    const sourceFiles = await this.getSourceFiles();

    for (const pattern of patterns) {
      const matches: { file: string; count: number }[] = [];

      for (const file of sourceFiles) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const regex = new RegExp(pattern.pattern, 'g');
          const matchCount = (content.match(regex) || []).length;

          if (matchCount > 0) {
            matches.push({ file, count: matchCount });
          }
        } catch (error) {
          // Ignore read errors
        }
      }

      const totalMatches = matches.reduce((sum, m) => sum + m.count, 0);

      if (totalMatches >= 3) {
        recommendations.push({
          type: pattern.recommendationType,
          trigger: pattern.description,
          suggestion: pattern.description,
          evidence: [
            `Total matches: ${totalMatches}`,
            `Files: ${matches.slice(0, 3).map(m => `${path.relative(this.projectRoot, m.file)} (${m.count})`).join(', ')}${matches.length > 3 ? '...' : ''}`,
          ],
          priority: pattern.priority,
        });
      }
    }

    return recommendations;
  }

  /**
   * Get all source files in project
   */
  private async getSourceFiles(): Promise<string[]> {
    const files: string[] = [];
    const excludeDirs = ['node_modules', 'vendor', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv'];
    const projectRoot = this.projectRoot;
    const framework = this.framework;

    const searchDirs = framework.getSearchDirs();
    const excludeDirsList = framework.getExcludeDirs();

    const walkDir = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(projectRoot, fullPath);

          if (entry.isDirectory()) {
            const shouldExclude = excludeDirs.includes(entry.name) ||
                                 excludeDirsList.some(exclude => relativePath.includes(exclude));
            if (!shouldExclude && !entry.name.startsWith('.')) {
              await walkDir(fullPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name);
            const extensions = framework.getFileExtensions();
            if (extensions.includes(ext.replace('.', ''))) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        // Ignore permission errors
      }
    };

    // Start from search directories or project root
    if (searchDirs.length > 0) {
      for (const searchDir of searchDirs) {
        const fullPath = path.join(projectRoot, searchDir);
        if (await fs.pathExists(fullPath)) {
          await walkDir(fullPath);
        }
      }
    } else {
      await walkDir(projectRoot);
    }

    return files;
  }

  /**
   * Deduplicate recommendations and sort by priority
   */
  private deduplicateAndSort(recommendations: PluginRecommendation[]): PluginRecommendation[] {
    const seen = new Set<string>();
    const unique: PluginRecommendation[] = [];

    for (const rec of recommendations) {
      const key = `${rec.type}-${rec.trigger}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(rec);
      }
    }

    // Sort by priority
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return unique.sort((a, b) => priorityOrder[b.priority] - priorityOrder[a.priority]);
  }
}
