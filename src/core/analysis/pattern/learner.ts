import * as fs from 'fs-extra';
import * as path from 'path';
import { Task } from '../../../types';
import { emitEvent } from '../../utils/event-stream';
import { PatternLibraryManager } from '../pattern-library-manager';
import { ErrorPattern } from '../../../config/schema/pattern-library';

export interface LearnedPattern {
  id: string;
  pattern: string;           // What went wrong (error signature)
  guidance: string;          // What to do instead
  occurrences: number;       // How many times seen
  lastSeen: string;          // ISO timestamp
  files?: string[];          // Files where this pattern was seen
  projectTypes?: string[];   // Project types where this pattern was seen (e.g., "drupal", "react")
  // Pattern usage tracking
  injectionCount?: number;   // Times this pattern was injected into prompts
  preventionCount?: number;  // Times this pattern helped prevent an error
  lastInjected?: string;     // ISO timestamp of last injection
}

export interface PatternMatch {
  pattern: LearnedPattern;
  relevance: number;         // 0-1 score of how relevant this pattern is
}

/**
 * PatternLearningSystem remembers common failure patterns and injects
 * guidance into AI prompts to prevent repeating the same mistakes.
 *
 * Patterns are learned from:
 * 1. Validation failures (patch not found, syntax errors)
 * 2. Test failures (repeated error messages)
 * 3. Manual marking (built-in patterns for common issues)
 */
export class PatternLearningSystem {
  private patternsPath: string;
  private patterns: Map<string, LearnedPattern> = new Map();
  private debug: boolean;
  private loaded = false;
  private patternLibraryManager: PatternLibraryManager;

  // Built-in patterns for common AI errors
  private static readonly BUILTIN_PATTERNS: LearnedPattern[] = [
    {
      id: 'preserve-helpers',
      pattern: 'Removed existing helper functions|removed drush|removed waitFor|removed click|removed take',
      guidance: 'NEVER remove or modify existing helper functions. Only ADD new code after existing code.',
      occurrences: 0,
      lastSeen: '',
    },
    {
      id: 'wrong-function-name',
      pattern: 'is not a function|Cannot find name|not defined|undefined is not a function',
      guidance: 'Use ONLY function names that exist in the file skeleton. Check the "Available Functions" section.',
      occurrences: 0,
      lastSeen: '',
    },
    {
      id: 'wrong-import-path',
      pattern: 'Cannot find module|Module not found|Unable to resolve|import.*from.*not found',
      guidance: 'Copy import paths EXACTLY from the imports section in the file context. Do not modify import paths.',
      occurrences: 0,
      lastSeen: '',
    },
    {
      id: 'patch-not-found',
      pattern: 'Search string not found|PATCH_FAILED|patch.*not found',
      guidance: 'Ensure patch search strings match EXACTLY including whitespace, newlines, and indentation. Copy-paste from the existing code context.',
      occurrences: 0,
      lastSeen: '',
    },
    {
      id: 'replaced-file-content',
      pattern: 'entire file content|replaced entire|overwrote file|used.*content.*instead of.*patch|Destructive update detected',
      guidance: 'Use PATCH operations for existing files over 500 lines. Never replace entire file contents. Only add or modify specific sections using search/replace patches.',
      occurrences: 0,
      lastSeen: '',
    },
    {
      id: 'large-file-patch-required',
      pattern: 'schema\\.yml|bd\\.schema\\.yml|9\\d{3} lines|large file|over 500 lines',
      guidance: 'For files over 500 lines (like bd.schema.yml with 9000+ lines), you MUST use operation "patch" with search/replace. Copy the EXACT search string from the file context provided. To append to a YAML file, use the last few lines of the file as your search string and add your new content after them in the replace string.',
      occurrences: 0,
      lastSeen: '',
    },
    {
      id: 'test-structure-broken',
      pattern: 'test\\.describe.*not closed|missing closing|test structure|describe block',
      guidance: 'Preserve existing test.describe() blocks. Add new test() calls inside the existing describe block, do not create new describe blocks.',
      occurrences: 0,
      lastSeen: '',
    },
    {
      id: 'typescript-syntax',
      pattern: 'SyntaxError|Unexpected token|Parse error|TS\\d{4}',
      guidance: 'Ensure TypeScript syntax is valid. Check for matching braces, proper async/await usage, and correct type annotations.',
      occurrences: 0,
      lastSeen: '',
    },
  ];

  constructor(patternsPath?: string, debug = false) {
    this.patternsPath = patternsPath || path.join(process.cwd(), '.devloop', 'patterns.json');
    this.debug = debug;
    // Initialize PatternLibraryManager for unified storage
    this.patternLibraryManager = new PatternLibraryManager({
      projectRoot: process.cwd(),
      debug,
    });
  }

  /**
   * Load patterns from disk using PatternLibraryManager.
   * Also migrates from old patterns.json format if it exists.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    // Load built-in patterns first
    for (const pattern of PatternLearningSystem.BUILTIN_PATTERNS) {
      this.patterns.set(pattern.id, { ...pattern });
    }

    // Load error patterns from PatternLibraryManager (unified storage)
    await this.patternLibraryManager.load();
    const errorPatterns = this.patternLibraryManager.getErrorPatterns();

    for (const errorPattern of errorPatterns) {
      // Convert ErrorPattern to LearnedPattern format
      const learnedPattern: LearnedPattern = {
        id: errorPattern.id,
        pattern: errorPattern.pattern,
        guidance: errorPattern.guidance,
        occurrences: errorPattern.occurrences,
        lastSeen: errorPattern.lastSeen,
        files: errorPattern.files,
        projectTypes: errorPattern.projectTypes,
        injectionCount: errorPattern.injectionCount,
        preventionCount: errorPattern.preventionCount,
        lastInjected: errorPattern.lastInjected,
      };

      // Merge with existing (saved patterns take precedence)
      const existing = this.patterns.get(learnedPattern.id);
      if (existing) {
        existing.occurrences = Math.max(existing.occurrences, learnedPattern.occurrences);
        existing.lastSeen = learnedPattern.lastSeen || existing.lastSeen;
        existing.files = [...new Set([...(existing.files || []), ...(learnedPattern.files || [])])];
      } else {
        this.patterns.set(learnedPattern.id, learnedPattern);
      }
    }

    // Migrate from old patterns.json if it exists (backward compatibility)
    if (await fs.pathExists(this.patternsPath)) {
      try {
        const data = await fs.readJson(this.patternsPath);
        if (Array.isArray(data.patterns)) {
          for (const pattern of data.patterns) {
            // Convert old format to ErrorPattern and save to PatternLibraryManager
            const errorPattern: ErrorPattern = {
              id: pattern.id,
              pattern: pattern.pattern,
              guidance: pattern.guidance,
              occurrences: pattern.occurrences || 0,
              lastSeen: pattern.lastSeen || new Date().toISOString(),
              files: pattern.files,
              projectTypes: pattern.projectTypes,
              injectionCount: pattern.injectionCount,
              preventionCount: pattern.preventionCount,
              lastInjected: pattern.lastInjected,
            };
            this.patternLibraryManager.addErrorPattern(errorPattern);

            // Also add to in-memory map
            const learnedPattern: LearnedPattern = {
              id: pattern.id,
              pattern: pattern.pattern,
              guidance: pattern.guidance,
              occurrences: pattern.occurrences || 0,
              lastSeen: pattern.lastSeen || new Date().toISOString(),
              files: pattern.files,
              projectTypes: pattern.projectTypes,
              injectionCount: pattern.injectionCount,
              preventionCount: pattern.preventionCount,
              lastInjected: pattern.lastInjected,
            };
            this.patterns.set(learnedPattern.id, learnedPattern);
          }
          // Save migrated patterns to PatternLibraryManager
          await this.patternLibraryManager.save();
        }
      } catch (error) {
        if (this.debug) {
          console.warn('[PatternLearner] Failed to migrate old patterns:', error);
        }
      }
    }

    this.loaded = true;
    if (this.debug) {
      console.log(`[PatternLearner] Loaded ${this.patterns.size} patterns`);
    }
  }

  /**
   * Save patterns to disk using PatternLibraryManager.
   * This delegates storage to the unified PatternLibraryManager.
   */
  async save(): Promise<void> {
    await this.load(); // Ensure patterns are loaded first

    // Convert all LearnedPattern instances to ErrorPattern and save to PatternLibraryManager
    for (const learnedPattern of this.patterns.values()) {
      const errorPattern: ErrorPattern = {
        id: learnedPattern.id,
        pattern: learnedPattern.pattern,
        guidance: learnedPattern.guidance,
        occurrences: learnedPattern.occurrences,
        lastSeen: learnedPattern.lastSeen,
        files: learnedPattern.files,
        projectTypes: learnedPattern.projectTypes,
        injectionCount: learnedPattern.injectionCount,
        preventionCount: learnedPattern.preventionCount,
        lastInjected: learnedPattern.lastInjected,
      };
      this.patternLibraryManager.addErrorPattern(errorPattern);
    }

    // Save to unified storage
    await this.patternLibraryManager.save();
  }

  /**
   * Record a new pattern or update an existing one.
   */
  async recordPattern(
    errorText: string,
    file?: string,
    customGuidance?: string,
    projectType?: string
  ): Promise<void> {
    await this.load();

    // Check if this matches an existing pattern
    for (const [id, pattern] of this.patterns) {
      const regex = new RegExp(pattern.pattern, 'i');
      if (regex.test(errorText)) {
        // Update existing pattern
        pattern.occurrences++;
        pattern.lastSeen = new Date().toISOString();
        if (file && !pattern.files?.includes(file)) {
          pattern.files = [...(pattern.files || []), file];
        }
        if (projectType && !pattern.projectTypes?.includes(projectType)) {
          pattern.projectTypes = [...(pattern.projectTypes || []), projectType];
        }
        await this.save();
        if (this.debug) {
          console.log(`[PatternLearner] Updated pattern "${id}" (${pattern.occurrences} occurrences)`);
        }
        return;
      }
    }

    // Create new pattern if no match and custom guidance provided
    if (customGuidance) {
      const id = `custom-${Date.now()}`;
      const pattern: LearnedPattern = {
        id,
        pattern: errorText.substring(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        guidance: customGuidance,
        occurrences: 1,
        lastSeen: new Date().toISOString(),
        files: file ? [file] : [],
        projectTypes: projectType ? [projectType] : [],
      };
      this.patterns.set(id, pattern);
      await this.save();
      if (this.debug) {
        console.log(`[PatternLearner] Created new pattern "${id}"`);
      }
    }
  }

  /**
   * Get patterns filtered by project type.
   */
  async getPatternsByProjectType(projectType: string): Promise<LearnedPattern[]> {
    await this.load();
    return Array.from(this.patterns.values()).filter(pattern => {
      // Include patterns that match this project type or have no project type (generic)
      return !pattern.projectTypes || pattern.projectTypes.length === 0 || pattern.projectTypes.includes(projectType);
    });
  }

  /**
   * Get patterns relevant to a task and target files.
   * Now also includes codebase patterns from PatternLibraryManager for richer guidance.
   */
  async getRelevantPatterns(
    task: Task,
    targetFiles?: string[],
    projectType?: string
  ): Promise<PatternMatch[]> {
    await this.load();

    const matches: PatternMatch[] = [];
    const taskText = `${task.title} ${task.description || ''} ${(task as any).details || ''}`.toLowerCase();

    // Also check PatternLibraryManager for codebase patterns that might be relevant
    await this.patternLibraryManager.load();
    const codePatterns = this.patternLibraryManager.getCodePatterns();
    const schemaPatterns = this.patternLibraryManager.getSchemaPatterns();
    const testPatterns = this.patternLibraryManager.getTestPatterns();

    for (const pattern of this.patterns.values()) {
      let relevance = 0;

      // Higher relevance for patterns with more occurrences
      if (pattern.occurrences > 0) {
        relevance += Math.min(0.3, pattern.occurrences * 0.1);
      }

      // Higher relevance for patterns seen in similar files
      if (targetFiles && pattern.files) {
        for (const file of targetFiles) {
          if (pattern.files.some(f => f.includes(path.basename(file)))) {
            relevance += 0.3;
            break;
          }
        }
      }

      // Higher relevance for patterns matching current project type
      if (projectType && pattern.projectTypes) {
        if (pattern.projectTypes.includes(projectType)) {
          relevance += 0.2;
        } else if (pattern.projectTypes.length > 0) {
          // Lower relevance for project-specific patterns from other project types
          relevance *= 0.5;
        }
      }

      // Higher relevance for test-related patterns on test tasks
      if (taskText.includes('test') || taskText.includes('playwright')) {
        if (pattern.id.includes('test') || pattern.id === 'preserve-helpers') {
          relevance += 0.2;
        }
      }

      // Higher relevance for patch patterns when doing patches
      if (taskText.includes('patch') || taskText.includes('modify')) {
        if (pattern.id === 'patch-not-found' || pattern.id === 'replaced-file-content') {
          relevance += 0.2;
        }
      }

      // Include patterns with any relevance, or all builtin patterns
      if (relevance > 0 || PatternLearningSystem.BUILTIN_PATTERNS.some(b => b.id === pattern.id)) {
        matches.push({ pattern, relevance: Math.min(1, relevance) });
      }
    }

    // Add codebase patterns from PatternLibraryManager that match task context
    for (const codePattern of codePatterns) {
      // Check if pattern matches task context
      const patternMatches = codePattern.signature.toLowerCase().includes(taskText) ||
        (targetFiles && codePattern.files.some(f => targetFiles.some(tf => tf.includes(f))));

      if (patternMatches) {
        // Convert code pattern to learned pattern format for guidance
        const learnedPattern: LearnedPattern = {
          id: `codebase-${codePattern.id}`,
          pattern: codePattern.signature,
          guidance: `Follow existing pattern: ${codePattern.signature}. See examples in: ${codePattern.files.slice(0, 3).join(', ')}`,
          occurrences: codePattern.occurrences,
          lastSeen: codePattern.lastUsedAt || codePattern.discoveredAt,
          files: codePattern.files,
          projectTypes: codePattern.frameworkHints,
        };

        // Calculate relevance based on occurrences and file matches
        let relevance = 0.3; // Base relevance for codebase patterns
        if (codePattern.occurrences > 5) {
          relevance += 0.2;
        }
        if (targetFiles && codePattern.files.some(f => targetFiles.some(tf => tf.includes(f)))) {
          relevance += 0.3;
        }

        matches.push({ pattern: learnedPattern, relevance: Math.min(1, relevance) });
      }
    }

    // Add schema patterns for schema-related tasks
    if (taskText.includes('schema') || taskText.includes('entity') || taskText.includes('config')) {
      for (const schemaPattern of schemaPatterns.slice(0, 5)) {
        const learnedPattern: LearnedPattern = {
          id: `schema-${schemaPattern.id}`,
          pattern: schemaPattern.pattern,
          guidance: `Use schema pattern: ${schemaPattern.type}. Examples: ${schemaPattern.exampleFiles.slice(0, 2).join(', ')}`,
          occurrences: 1,
          lastSeen: new Date().toISOString(),
          files: schemaPattern.exampleFiles,
        };
        matches.push({ pattern: learnedPattern, relevance: 0.4 });
      }
    }

    // Add test patterns for test-related tasks
    if (taskText.includes('test') || taskText.includes('playwright') || taskText.includes('spec')) {
      for (const testPattern of testPatterns.slice(0, 3)) {
        const learnedPattern: LearnedPattern = {
          id: `test-${testPattern.id}`,
          pattern: testPattern.structure,
          guidance: `Follow test pattern structure: ${testPattern.structure}. Framework: ${testPattern.framework}`,
          occurrences: 1,
          lastSeen: new Date().toISOString(),
          files: testPattern.exampleFiles,
        };
        matches.push({ pattern: learnedPattern, relevance: 0.5 });
      }
    }

    // Sort by relevance
    matches.sort((a, b) => b.relevance - a.relevance);

    return matches;
  }

  /**
   * Generate guidance prompt from relevant patterns.
   * Automatically tracks pattern injections for usage analytics.
   */
  async generateGuidancePrompt(
    task: Task,
    targetFiles?: string[],
    projectType?: string,
    trackUsage: boolean = true
  ): Promise<string> {
    const matches = await this.getRelevantPatterns(task, targetFiles, projectType);

    if (matches.length === 0) {
      return '';
    }

    const sections: string[] = [
      '## LEARNED PATTERNS - Avoid These Mistakes:',
      '',
    ];

    // Include top 5 most relevant patterns
    const injectedPatternIds: string[] = [];
    for (const match of matches.slice(0, 5)) {
      const { pattern } = match;
      sections.push(`### ${pattern.id.toUpperCase()}`);
      sections.push(`- **Guidance**: ${pattern.guidance}`);
      if (pattern.occurrences > 0) {
        sections.push(`- *(Seen ${pattern.occurrences} time${pattern.occurrences > 1 ? 's' : ''})*`);
      }
      sections.push('');
      injectedPatternIds.push(pattern.id);
    }

    // Track pattern injections for usage analytics
    if (trackUsage && injectedPatternIds.length > 0) {
      await this.trackPatternInjection(injectedPatternIds);
    }

    return sections.join('\n');
  }

  /**
   * Get all patterns (for debugging/inspection).
   */
  async getAllPatterns(): Promise<LearnedPattern[]> {
    await this.load();
    return Array.from(this.patterns.values());
  }

  /**
   * Clear all learned patterns (keep built-ins).
   */
  async clearLearned(): Promise<void> {
    this.patterns.clear();
    for (const pattern of PatternLearningSystem.BUILTIN_PATTERNS) {
      this.patterns.set(pattern.id, { ...pattern });
    }
    await this.save();
  }

  /**
   * Track when patterns are injected into prompts.
   * Call this when generateGuidancePrompt is used.
   */
  async trackPatternInjection(patternIds: string[]): Promise<void> {
    await this.load();
    const now = new Date().toISOString();

    for (const id of patternIds) {
      const pattern = this.patterns.get(id);
      if (pattern) {
        pattern.injectionCount = (pattern.injectionCount || 0) + 1;
        pattern.lastInjected = now;
      }
    }

    // Save using PatternLibraryManager (delegated)
    await this.save();

    // Emit event for observability
    emitEvent('pattern:injected', {
      patternIds,
      count: patternIds.length,
    }, { severity: 'info' });

    if (this.debug) {
      console.log(`[PatternLearner] Tracked injection of ${patternIds.length} patterns`);
    }
  }

  /**
   * Track when a pattern helps prevent an error.
   * Call this when a task succeeds after pattern guidance was injected.
   */
  async trackPatternPrevention(patternIds: string[]): Promise<void> {
    await this.load();

    for (const id of patternIds) {
      const pattern = this.patterns.get(id);
      if (pattern) {
        pattern.preventionCount = (pattern.preventionCount || 0) + 1;
      }
    }

    // Save using PatternLibraryManager (delegated)
    await this.save();

    // Emit event for observability
    emitEvent('pattern:prevented', {
      patternIds,
      count: patternIds.length,
    }, { severity: 'info' });

    if (this.debug) {
      console.log(`[PatternLearner] Tracked prevention by ${patternIds.length} patterns`);
    }
  }

  /**
   * Get pattern usage statistics.
   */
  async getPatternUsageStats(): Promise<{
    totalPatterns: number;
    totalInjections: number;
    totalPreventions: number;
    preventionRate: number;
    topPreventionPatterns: { id: string; preventionCount: number; injectionCount: number }[];
    unusedPatterns: string[];
  }> {
    await this.load();

    let totalInjections = 0;
    let totalPreventions = 0;
    const patternStats: { id: string; preventionCount: number; injectionCount: number }[] = [];
    const unusedPatterns: string[] = [];

    for (const [id, pattern] of this.patterns) {
      const injections = pattern.injectionCount || 0;
      const preventions = pattern.preventionCount || 0;

      totalInjections += injections;
      totalPreventions += preventions;

      if (injections > 0 || preventions > 0) {
        patternStats.push({ id, preventionCount: preventions, injectionCount: injections });
      } else {
        unusedPatterns.push(id);
      }
    }

    // Sort by prevention count
    patternStats.sort((a, b) => b.preventionCount - a.preventionCount);

    return {
      totalPatterns: this.patterns.size,
      totalInjections,
      totalPreventions,
      preventionRate: totalInjections > 0 ? totalPreventions / totalInjections : 0,
      topPreventionPatterns: patternStats.slice(0, 5),
      unusedPatterns,
    };
  }
}
