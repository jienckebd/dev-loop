import { LogAnalyzer } from './interface';
import { LogSource, LogAnalysis } from '../../types';
import * as fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class PatternMatcher implements LogAnalyzer {
  public name = 'pattern-matcher';
  private ignorePatterns: RegExp[] = [];

  constructor(
    private errorPattern: RegExp | string,
    private warningPattern: RegExp | string,
    ignorePatterns?: (RegExp | string)[]
  ) {
    // Convert ignore patterns to RegExp
    if (ignorePatterns) {
      this.ignorePatterns = ignorePatterns.map(p => 
        typeof p === 'string' ? new RegExp(p, 'i') : p
      );
    }
  }

  private shouldIgnore(line: string): boolean {
    return this.ignorePatterns.some(pattern => pattern.test(line));
  }

  async analyze(sources: LogSource[]): Promise<LogAnalysis> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const allLines: string[] = [];

    for (const source of sources) {
      let content = '';

      if (source.type === 'file' && source.path) {
        try {
          if (await fs.pathExists(source.path)) {
            content = await fs.readFile(source.path, 'utf-8');
          }
        } catch (error) {
          // Ignore file read errors
        }
      } else if (source.type === 'command' && source.command) {
        try {
          const { stdout, stderr } = await execAsync(source.command);
          content = stdout + stderr;
        } catch (error: any) {
          content = error.stdout || error.stderr || '';
        }
      }

      const lines = content.split('\n');
      allLines.push(...lines);

      // Convert patterns to RegExp if they're strings
      const errorRegex = typeof this.errorPattern === 'string'
        ? new RegExp(this.errorPattern, 'i')
        : this.errorPattern;
      const warningRegex = typeof this.warningPattern === 'string'
        ? new RegExp(this.warningPattern, 'i')
        : this.warningPattern;

      // Match patterns, excluding ignored lines
      for (const line of lines) {
        // Skip lines that match ignore patterns
        if (this.shouldIgnore(line)) {
          continue;
        }
        if (errorRegex.test(line)) {
          errors.push(line.trim());
        }
        if (warningRegex.test(line)) {
          warnings.push(line.trim());
        }
      }
    }

    // Remove duplicates
    const uniqueErrors = [...new Set(errors)];
    const uniqueWarnings = [...new Set(warnings)];

    return {
      errors: uniqueErrors,
      warnings: uniqueWarnings,
      summary: `Found ${uniqueErrors.length} error(s) and ${uniqueWarnings.length} warning(s) in logs`,
    };
  }
}

