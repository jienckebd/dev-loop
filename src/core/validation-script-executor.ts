import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';

const execAsync = promisify(exec);

export interface ScriptResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  jsonOutput?: any;
  error?: string;
}

/**
 * ValidationScriptExecutor executes custom validation scripts (PHP, shell, Node.js).
 *
 * Supports:
 * - Direct script execution
 * - Drupal-specific execution via DDEV
 * - JSON output parsing
 * - Error handling and reporting
 */
export class ValidationScriptExecutor {
  private debug: boolean;
  private ddevEnabled: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
    // Check if DDEV is available
    this.ddevEnabled = this.checkDdevAvailable();
  }

  /**
   * Check if DDEV is available.
   */
  private checkDdevAvailable(): boolean {
    try {
      // Try to run ddev version (non-blocking check)
      const { execSync } = require('child_process');
      execSync('ddev version', { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a script directly.
   */
  async executeScript(scriptPath: string, args: string[] = []): Promise<ScriptResult> {
    const fullPath = require('path').resolve(process.cwd(), scriptPath);
    const command = `php "${fullPath}" ${args.join(' ')}`;

    if (this.debug) {
      logger.debug(`[ValidationScriptExecutor] Executing script: ${command}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 300000, // 5 minutes
        cwd: process.cwd(),
      });

      const output = stdout + stderr;
      const jsonOutput = this.parseJsonOutput(output);

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        output,
        jsonOutput,
      };
    } catch (error: any) {
      const output = error.stdout || error.stderr || error.message || String(error);
      const exitCode = error.code || 1;

      return {
        success: false,
        exitCode,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        output,
        error: error.message,
      };
    }
  }

  /**
   * Execute a script with Drupal context (via DDEV).
   */
  async executeWithDrupal(scriptPath: string, args: string[] = []): Promise<ScriptResult> {
    if (!this.ddevEnabled) {
      // Fallback to direct execution if DDEV not available
      logger.warn('[ValidationScriptExecutor] DDEV not available, executing script directly');
      return this.executeScript(scriptPath, args);
    }

    const fullPath = require('path').resolve(process.cwd(), scriptPath);
    const command = `ddev exec bash -c "php ${fullPath} ${args.join(' ')}"`;

    if (this.debug) {
      logger.debug(`[ValidationScriptExecutor] Executing with DDEV: ${command}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 300000, // 5 minutes
        cwd: process.cwd(),
      });

      const output = stdout + stderr;
      const jsonOutput = this.parseJsonOutput(output);

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        output,
        jsonOutput,
      };
    } catch (error: any) {
      const output = error.stdout || error.stderr || error.message || String(error);
      const exitCode = error.code || 1;

      return {
        success: false,
        exitCode,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        output,
        error: error.message,
      };
    }
  }

  /**
   * Parse JSON output from script.
   * Tries to extract JSON from output (handles mixed text/JSON output).
   */
  parseJsonOutput(output: string): any {
    if (!output) {
      return null;
    }

    // Try to find JSON object in output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // JSON parse failed, continue to try array format
      }
    }

    // Try to find JSON array
    const arrayMatch = output.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        // JSON parse failed
      }
    }

    // Try parsing entire output as JSON
    try {
      return JSON.parse(output.trim());
    } catch {
      // Not valid JSON
      return null;
    }
  }

  /**
   * Execute a shell command.
   */
  async executeCommand(command: string, cwd?: string): Promise<ScriptResult> {
    if (this.debug) {
      logger.debug(`[ValidationScriptExecutor] Executing command: ${command}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 300000,
        cwd: cwd || process.cwd(),
      });

      return {
        success: true,
        exitCode: 0,
        stdout,
        stderr,
        output: stdout + stderr,
      };
    } catch (error: any) {
      const output = error.stdout || error.stderr || error.message || String(error);
      const exitCode = error.code || 1;

      return {
        success: false,
        exitCode,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message || '',
        output,
        error: error.message,
      };
    }
  }
}


