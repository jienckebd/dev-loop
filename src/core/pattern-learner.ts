import * as fs from 'fs-extra';
import * as path from 'path';
import { Task } from '../types';

export interface LearnedPattern {
  id: string;
  pattern: string;           // What went wrong (error signature)
  guidance: string;          // What to do instead
  occurrences: number;       // How many times seen
  lastSeen: string;          // ISO timestamp
  files?: string[];          // Files where this pattern was seen
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
  }

  /**
   * Load patterns from disk.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    // Load built-in patterns first
    for (const pattern of PatternLearningSystem.BUILTIN_PATTERNS) {
      this.patterns.set(pattern.id, { ...pattern });
    }

    // Load saved patterns from disk
    if (await fs.pathExists(this.patternsPath)) {
      try {
        const data = await fs.readJson(this.patternsPath);
        if (Array.isArray(data.patterns)) {
          for (const pattern of data.patterns) {
            // Merge with existing (saved patterns take precedence for occurrence counts)
            const existing = this.patterns.get(pattern.id);
            if (existing) {
              existing.occurrences = pattern.occurrences || existing.occurrences;
              existing.lastSeen = pattern.lastSeen || existing.lastSeen;
              existing.files = [...(existing.files || []), ...(pattern.files || [])];
            } else {
              this.patterns.set(pattern.id, pattern);
            }
          }
        }
      } catch (error) {
        if (this.debug) {
          console.warn('[PatternLearner] Failed to load patterns:', error);
        }
      }
    }

    this.loaded = true;
    if (this.debug) {
      console.log(`[PatternLearner] Loaded ${this.patterns.size} patterns`);
    }
  }

  /**
   * Save patterns to disk.
   */
  async save(): Promise<void> {
    await fs.ensureDir(path.dirname(this.patternsPath));

    const data = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      patterns: Array.from(this.patterns.values()),
    };

    await fs.writeJson(this.patternsPath, data, { spaces: 2 });
  }

  /**
   * Record a new pattern or update an existing one.
   */
  async recordPattern(
    errorText: string,
    file?: string,
    customGuidance?: string
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
      };
      this.patterns.set(id, pattern);
      await this.save();
      if (this.debug) {
        console.log(`[PatternLearner] Created new pattern "${id}"`);
      }
    }
  }

  /**
   * Get patterns relevant to a task and target files.
   */
  async getRelevantPatterns(
    task: Task,
    targetFiles?: string[]
  ): Promise<PatternMatch[]> {
    await this.load();

    const matches: PatternMatch[] = [];
    const taskText = `${task.title} ${task.description || ''} ${(task as any).details || ''}`.toLowerCase();

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

    // Sort by relevance
    matches.sort((a, b) => b.relevance - a.relevance);

    return matches;
  }

  /**
   * Generate guidance prompt from relevant patterns.
   */
  async generateGuidancePrompt(
    task: Task,
    targetFiles?: string[]
  ): Promise<string> {
    const matches = await this.getRelevantPatterns(task, targetFiles);

    if (matches.length === 0) {
      return '';
    }

    const sections: string[] = [
      '## LEARNED PATTERNS - Avoid These Mistakes:',
      '',
    ];

    // Include top 5 most relevant patterns
    for (const match of matches.slice(0, 5)) {
      const { pattern } = match;
      sections.push(`### ${pattern.id.toUpperCase()}`);
      sections.push(`- **Guidance**: ${pattern.guidance}`);
      if (pattern.occurrences > 0) {
        sections.push(`- *(Seen ${pattern.occurrences} time${pattern.occurrences > 1 ? 's' : ''})*`);
      }
      sections.push('');
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
}
