import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CodeChanges, CodePatch } from '../types';
import { emitEvent } from './event-stream';

const execAsync = promisify(exec);

/**
 * Error categories for better classification and recovery
 */
export type ValidationErrorCategory =
  | 'syntax'           // Code syntax errors
  | 'missing_function' // Referenced function doesn't exist
  | 'missing_import'   // Required import missing
  | 'patch_not_found'  // Patch search string not found
  | 'file_not_found'   // Target file doesn't exist
  | 'boundary'         // File outside allowed boundaries
  | 'destructive'      // Destructive update detected
  | 'dependency';      // Missing dependency

export interface RecoverySuggestion {
  action: 'fix' | 'retry' | 'skip' | 'manual';
  description: string;
  code?: string; // Code snippet to fix the issue
  reference?: string; // Reference to documentation or pattern
}

export interface ValidationError {
  type: ValidationErrorCategory;
  category: 'recoverable' | 'blocking' | 'warning';
  file: string;
  message: string;
  suggestion?: string;
  patchIndex?: number;
  recovery?: RecoverySuggestion;
  context?: {
    lineNumber?: number;
    searchString?: string;
    expectedPattern?: string;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  recoveryPossible: boolean;
  recoverySuggestions: RecoverySuggestion[];
}

/**
 * Validation pattern tracking for learning
 */
export interface ValidationPattern {
  errorType: ValidationErrorCategory;
  count: number;
  lastSeen: string;
  commonFixes: string[];
}

/**
 * Validation patterns storage
 */
let validationPatterns: Map<string, ValidationPattern> = new Map();

/**
 * ValidationGate validates code changes before they are applied to the filesystem.
 * This prevents wasted iterations where invalid code is applied and tests fail.
 *
 * Validations performed:
 * 1. Patch search strings exist in target files
 * 2. TypeScript syntax is valid (for .ts files)
 * 3. Referenced functions exist (optional, more expensive)
 */
export class ValidationGate {
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
  }

  /**
   * Validate all code changes before applying.
   * @param changes The code changes to validate
   * @param allowedPaths Optional list of file paths that are allowed to be modified
   */
  async validate(changes: CodeChanges, allowedPaths?: string[]): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // If allowedPaths is provided, validate that all changed files are in the allowed list
    if (allowedPaths && allowedPaths.length > 0) {
      for (const file of changes.files) {
        // Check if this file path is in the allowed list (or is a new file being created)
        const isAllowed = file.operation === 'create' ||
          allowedPaths.some(allowed => {
            // Exact match or file is under an allowed directory
            return file.path === allowed ||
              file.path.startsWith(allowed.replace(/[^/]+$/, '')) ||
              allowed.includes(path.basename(file.path));
          });

        if (!isAllowed) {
          errors.push({
            type: 'boundary',
            category: 'blocking',
            file: file.path,
            message: `File "${file.path}" is not in the task's target files and should not be modified`,
            suggestion: `Only modify files explicitly mentioned in the task. Target files: ${allowedPaths.slice(0, 5).join(', ')}`,
          });
        }
      }
    }

    for (const file of changes.files) {
      const filePath = path.resolve(process.cwd(), file.path);

      // Warn about update operations on test files (should use patch instead)
      if (file.operation === 'update' && await fs.pathExists(filePath)) {
        if (file.path.includes('.spec.ts') || file.path.includes('.test.ts')) {
          errors.push({
            type: 'destructive',
            category: 'recoverable',
            file: file.path,
            message: 'Test files should use operation "patch" not "update" to avoid replacing existing code',
            suggestion: 'Change operation to "patch" and use search/replace to add new test scenarios.',
          });
          continue;
        }

        // CRITICAL: Prevent destructive updates that significantly shrink files
        // This catches AI agents that rewrite entire files instead of patching
        const existingContent = await fs.readFile(filePath, 'utf-8');
        const existingLines = existingContent.split('\n').length;
        const newLines = file.content ? file.content.split('\n').length : 0;

        // If the new content is less than 50% of the original size, reject it
        if (newLines < existingLines * 0.5 && existingLines > 100) {
          errors.push({
            type: 'destructive',
            category: 'blocking',
            file: file.path,
            message: `Destructive update detected: new content (${newLines} lines) is much smaller than existing (${existingLines} lines)`,
            suggestion: 'Use operation "patch" with search/replace instead of replacing the entire file. Only modify the specific lines that need to change.',
          });
          continue;
        }

        // Also warn if the file is large and using update operation
        if (existingLines > 500) {
          warnings.push(`Large file ${file.path} (${existingLines} lines) using "update" operation. Consider using "patch" for targeted changes.`);
        }
      }

      // Validate file exists for patch/update operations
      if (file.operation === 'patch' || file.operation === 'update') {
        if (!await fs.pathExists(filePath)) {
          if (file.operation === 'patch') {
          errors.push({
            type: 'file_not_found',
            category: 'recoverable',
            file: file.path,
            message: `Cannot patch non-existent file: ${file.path}`,
            suggestion: 'Use operation "create" to create a new file, or check the file path.',
          });
          continue;
          }
          // For update, we'll create the file if it doesn't exist
        }
      }

      // Validate patches
      if (file.operation === 'patch' && file.patches) {
        const patchErrors = await this.validatePatches(filePath, file.patches);
        errors.push(...patchErrors);
      }

      // Validate syntax for TypeScript files
      if ((file.operation === 'create' || file.operation === 'update') && file.content) {
        if (file.path.endsWith('.ts') || file.path.endsWith('.tsx')) {
          const syntaxErrors = await this.validateTypeScriptSyntax(file.content, file.path);
          errors.push(...syntaxErrors);
        }
      }
    }

    // Categorize errors and generate recovery suggestions
    const recoverySuggestions: RecoverySuggestion[] = [];
    let recoveryPossible = true;

    for (const error of errors) {
      // Add recovery suggestions based on error type
      const recovery = this.generateRecoverySuggestion(error);
      error.recovery = recovery;
      recoverySuggestions.push(recovery);

      // Check if recovery is possible
      if (error.category === 'blocking') {
        recoveryPossible = false;
      }

      // Track validation pattern
      this.trackValidationPattern(error);
    }

    // Emit validation event with detailed info
    if (errors.length > 0) {
      emitEvent('validation:error_with_suggestion', {
        errorCount: errors.length,
        errorTypes: [...new Set(errors.map(e => e.type))],
        recoveryPossible,
        suggestions: recoverySuggestions.slice(0, 3).map(s => s.description),
      }, { severity: errors.some(e => e.category === 'blocking') ? 'error' : 'warn' });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      recoveryPossible,
      recoverySuggestions,
    };
  }

  /**
   * Generate recovery suggestion based on error type and context
   */
  private generateRecoverySuggestion(error: ValidationError): RecoverySuggestion {
    switch (error.type) {
      case 'patch_not_found':
        return {
          action: 'fix',
          description: 'Update patch search string to match current file content',
          code: error.suggestion?.includes('Similar content')
            ? `Use this content instead:\n${error.suggestion.split('\n').slice(1).join('\n')}`
            : undefined,
          reference: 'Ensure search string matches exactly including whitespace',
        };

      case 'file_not_found':
        return {
          action: 'fix',
          description: 'Change operation from "patch" to "create" for new files',
          code: `{ "operation": "create", "content": "..." }`,
          reference: 'Use "create" operation for files that do not exist',
        };

      case 'syntax':
        return {
          action: 'fix',
          description: error.suggestion || 'Fix syntax error in generated code',
          reference: 'Run TypeScript compiler to verify syntax before applying',
        };

      case 'destructive':
        return {
          action: 'fix',
          description: 'Use "patch" operation instead of "update" for targeted changes',
          code: `{ "operation": "patch", "patches": [{ "search": "...", "replace": "..." }] }`,
          reference: 'Patch operations preserve existing code and only modify specific sections',
        };

      case 'boundary':
        return {
          action: 'skip',
          description: 'File is outside allowed target module - it will be skipped',
          reference: 'Only modify files within the target module directory',
        };

      case 'missing_import':
        return {
          action: 'fix',
          description: 'Add missing import statement',
          code: `import { MissingType } from './path/to/module';`,
          reference: 'Check existing imports in similar files for reference',
        };

      case 'missing_function':
        return {
          action: 'fix',
          description: 'Define the missing function or import it from another module',
          reference: 'Search codebase for existing implementations',
        };

      case 'dependency':
        return {
          action: 'manual',
          description: 'Install missing dependency or use existing alternative',
          reference: 'Run npm install or check package.json for available packages',
        };

      default:
        return {
          action: 'manual',
          description: error.suggestion || 'Review and fix manually',
        };
    }
  }

  /**
   * Track validation patterns for learning
   */
  private trackValidationPattern(error: ValidationError): void {
    const key = `${error.type}:${path.extname(error.file)}`;

    const existing = validationPatterns.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeen = new Date().toISOString();
      if (error.suggestion && !existing.commonFixes.includes(error.suggestion)) {
        existing.commonFixes.push(error.suggestion);
        if (existing.commonFixes.length > 5) {
          existing.commonFixes = existing.commonFixes.slice(-5);
        }
      }
    } else {
      validationPatterns.set(key, {
        errorType: error.type,
        count: 1,
        lastSeen: new Date().toISOString(),
        commonFixes: error.suggestion ? [error.suggestion] : [],
      });
    }
  }

  /**
   * Get validation patterns for analysis
   */
  getValidationPatterns(): ValidationPattern[] {
    return Array.from(validationPatterns.values())
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Export validation patterns to file
   */
  async exportValidationPatterns(filePath: string = '.devloop/reports/validation-patterns.json'): Promise<void> {
    const patterns = this.getValidationPatterns();
    const reportPath = path.resolve(process.cwd(), filePath);
    await fs.ensureDir(path.dirname(reportPath));
    await fs.writeJson(reportPath, {
      exportedAt: new Date().toISOString(),
      patterns,
    }, { spaces: 2 });
  }

  /**
   * Validate that patch search strings exist in the target file.
   * Tries exact match first, then fuzzy matching with whitespace normalization.
   */
  async validatePatches(filePath: string, patches: CodePatch[]): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    if (!await fs.pathExists(filePath)) {
      return []; // Already handled in main validate
    }

    const content = await fs.readFile(filePath, 'utf-8');

    for (let i = 0; i < patches.length; i++) {
      const patch = patches[i];

      // Try exact match first
      if (content.includes(patch.search)) {
        continue; // Exact match found, patch is valid
      }

      // Try fuzzy match with whitespace normalization
      const correctedSearch = this.tryFuzzyMatch(content, patch.search);
      if (correctedSearch) {
        // Auto-correct the patch search string
        patch.search = correctedSearch;
        if (this.debug) {
          console.log(`[ValidationGate] Patch ${i + 1}: Auto-corrected whitespace differences`);
        }
        continue; // Fuzzy match found and corrected
      }

      // No match found - report error
      const suggestion = this.findSimilarContent(content, patch.search);

      // Log the failed search string for debugging (first 200 chars)
      const searchPreview = patch.search.length > 200
        ? patch.search.substring(0, 200) + '...'
        : patch.search;
      if (this.debug) {
        console.log(`[ValidationGate] Patch ${i + 1} FAILED search string (first 200 chars):`);
        console.log(`  "${searchPreview.replace(/\n/g, '\\n')}"`);
      }

      errors.push({
        type: 'patch_not_found',
        category: 'recoverable',
        file: path.relative(process.cwd(), filePath),
        patchIndex: i + 1,
        message: `Patch ${i + 1}: Search string not found in file`,
        suggestion: suggestion || 'Ensure the search string matches EXACTLY, including whitespace and line endings.',
        context: {
          searchString: patch.search.substring(0, 200),
        },
      });
    }

    return errors;
  }

  /**
   * Try to find a matching section in the file with whitespace normalization.
   * Returns the corrected search string if found, null otherwise.
   */
  private tryFuzzyMatch(content: string, search: string): string | null {
    // Normalize the search string for comparison
    const normalizedSearch = this.normalizeWhitespace(search);

    // Find all meaningful code lines in search (non-empty, not just whitespace/braces)
    const searchLines = search.split('\n');
    const meaningfulSearchLines = searchLines
      .map(l => l.trim())
      .filter(l => l.length > 5 && !l.match(/^[{}\s]*$/));

    if (meaningfulSearchLines.length === 0) {
      return null;
    }

    // Find the first meaningful line in the content
    const firstLine = meaningfulSearchLines[0];
    const contentLines = content.split('\n');

    for (let i = 0; i < contentLines.length; i++) {
      const contentLine = contentLines[i].trim();

      // Check if this line matches the first meaningful line
      if (contentLine === firstLine || this.similarity(contentLine, firstLine) > 0.9) {
        // Found a potential match - try to extract the same number of lines
        const extractStart = Math.max(0, i - 3); // Look a bit before for context

        // Try different window sizes around the match
        for (let windowStart = extractStart; windowStart <= i; windowStart++) {
          for (let windowSize = searchLines.length; windowSize <= searchLines.length + 5; windowSize++) {
            const windowEnd = Math.min(contentLines.length, windowStart + windowSize);
            const extractedContent = contentLines.slice(windowStart, windowEnd).join('\n');

            // Check if this section semantically matches
            if (this.normalizeWhitespace(extractedContent) === normalizedSearch) {
              if (this.debug) {
                console.log(`[ValidationGate] Fuzzy match found at lines ${windowStart + 1}-${windowEnd}`);
              }
              return extractedContent;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Normalize whitespace for comparison: collapse multiple spaces/newlines,
   * trim lines, remove trailing whitespace.
   */
  private normalizeWhitespace(text: string): string {
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Try to find similar content in file to help debug failed patches.
   */
  private findSimilarContent(content: string, search: string): string | undefined {
    // Get first meaningful line of search string
    const firstLine = search.split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 10)[0];

    if (!firstLine) {
      return undefined;
    }

    // Search for similar lines
    const lines = content.split('\n');
    const threshold = 0.6; // 60% similarity

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (this.similarity(line, firstLine) > threshold) {
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(lines.length, i + 3);
        const context = lines.slice(contextStart, contextEnd).join('\n');
        return `Similar content found at line ${i + 1}:\n${context}`;
      }
    }

    return undefined;
  }

  /**
   * Simple string similarity using Jaccard index of character bigrams.
   */
  private similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;

    const getBigrams = (s: string): Set<string> => {
      const bigrams = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) {
        bigrams.add(s.substring(i, i + 2));
      }
      return bigrams;
    };

    const aBigrams = getBigrams(a.toLowerCase());
    const bBigrams = getBigrams(b.toLowerCase());

    let intersection = 0;
    for (const bigram of aBigrams) {
      if (bBigrams.has(bigram)) {
        intersection++;
      }
    }

    return intersection / (aBigrams.size + bBigrams.size - intersection);
  }

  /**
   * Validate TypeScript syntax using tsc or a simple regex check.
   */
  async validateTypeScriptSyntax(content: string, filePath: string): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Quick regex-based checks for common syntax errors
    const syntaxChecks = [
      {
        pattern: /\bfunction\s+\(/,
        message: 'Anonymous function declared with "function" keyword but no name',
        suggestion: 'Add a function name or use arrow function syntax',
      },
      {
        pattern: /\}\s*\}\s*\}\s*$/,
        message: 'Possible extra closing braces at end of file',
        suggestion: 'Check brace matching',
      },
      {
        pattern: /^\s*}\s*;?\s*$/m,
        check: (content: string) => {
          // Count opening and closing braces
          const opens = (content.match(/\{/g) || []).length;
          const closes = (content.match(/\}/g) || []).length;
          return opens !== closes;
        },
        message: 'Mismatched braces detected',
        suggestion: 'Check that all opening braces have matching closing braces',
      },
    ];

    for (const check of syntaxChecks) {
      if ('check' in check && check.check) {
        if (check.check(content)) {
          errors.push({
            type: 'syntax',
            category: 'recoverable',
            file: filePath,
            message: check.message,
            suggestion: check.suggestion,
          });
        }
      } else if (check.pattern.test(content)) {
        errors.push({
          type: 'syntax',
          category: 'recoverable',
          file: filePath,
          message: check.message,
          suggestion: check.suggestion,
        });
      }
    }

    // Try to use tsc for real syntax validation if available
    try {
      // Write content to temp file in the same directory as the original
      // This ensures relative imports resolve correctly
      const originalDir = path.dirname(path.resolve(process.cwd(), filePath));
      const tempFileName = `.temp-validate-${Date.now()}.ts`;
      const tempFile = path.join(originalDir, tempFileName);
      await fs.ensureDir(path.dirname(tempFile));
      await fs.writeFile(tempFile, content, 'utf-8');

      try {
        // Run tsc --noEmit to check syntax
        // Use --isolatedModules to skip import resolution which may fail for temp files
        await execAsync(`npx tsc --noEmit --skipLibCheck --isolatedModules "${tempFile}"`, {
          cwd: process.cwd(),
          timeout: 10000,
        });
      } catch (error: any) {
        // Parse tsc error output
        if (error.stderr || error.stdout) {
          const output = error.stderr || error.stdout;
          // Filter to only syntax errors, ignore import resolution errors
          const errorLines = output.split('\n').filter((l: string) => {
            const hasError = l.includes('error TS');
            // Skip import resolution errors (TS2307, TS2305) - imports may not resolve in temp file
            const isImportError = l.includes('TS2307') || l.includes('TS2305');
            return hasError && !isImportError;
          });

          if (errorLines.length > 0) {
            errors.push({
              type: 'syntax',
              category: 'blocking',
              file: filePath,
              message: `TypeScript compilation errors: ${errorLines.slice(0, 3).join('; ')}`,
              suggestion: 'Fix TypeScript syntax errors before applying',
            });
          }
        }
      } finally {
        // Clean up temp file
        await fs.remove(tempFile).catch(() => {});
      }
    } catch {
      // tsc not available or failed, rely on regex checks only
      if (this.debug) {
        console.log('[ValidationGate] tsc validation skipped (not available)');
      }
    }

    return errors;
  }

  /**
   * Format validation errors for AI consumption.
   */
  formatErrorsForAI(result: ValidationResult): string {
    if (result.valid) {
      return '';
    }

    const sections: string[] = [
      '## VALIDATION FAILED - Fix these errors before proceeding:',
      '',
    ];

    for (const error of result.errors) {
      sections.push(`### ${error.type.toUpperCase()}: ${error.file}`);
      sections.push(`- **Error**: ${error.message}`);
      if (error.patchIndex) {
        sections.push(`- **Patch Index**: ${error.patchIndex}`);
      }
      if (error.suggestion) {
        sections.push(`- **Suggestion**: ${error.suggestion}`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }
}
