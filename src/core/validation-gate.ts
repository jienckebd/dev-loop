import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { CodeChanges, CodePatch } from '../types';

const execAsync = promisify(exec);

export interface ValidationError {
  type: 'syntax' | 'missing_function' | 'missing_import' | 'patch_not_found' | 'file_not_found';
  file: string;
  message: string;
  suggestion?: string;
  patchIndex?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

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
   */
  async validate(changes: CodeChanges): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    for (const file of changes.files) {
      const filePath = path.resolve(process.cwd(), file.path);

      // Warn about update operations on test files (should use patch instead)
      if (file.operation === 'update' && await fs.pathExists(filePath)) {
        if (file.path.includes('.spec.ts') || file.path.includes('.test.ts')) {
          errors.push({
            type: 'syntax',
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
            type: 'syntax',
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

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
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
        file: path.relative(process.cwd(), filePath),
        patchIndex: i + 1,
        message: `Patch ${i + 1}: Search string not found in file`,
        suggestion: suggestion || 'Ensure the search string matches EXACTLY, including whitespace and line endings.',
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
            file: filePath,
            message: check.message,
            suggestion: check.suggestion,
          });
        }
      } else if (check.pattern.test(content)) {
        errors.push({
          type: 'syntax',
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
