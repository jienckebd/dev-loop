import { LogAnalyzer } from './interface';
import { LogSource, LogAnalysis } from '../../types';
import * as fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class PatternMatcher implements LogAnalyzer {
  public name = 'pattern-matcher';

  constructor(
    private errorPattern: RegExp | string,
    private warningPattern: RegExp | string
  ) {}

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

      // Match patterns
      for (const line of lines) {
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

