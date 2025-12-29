import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

/**
 * Logger that writes to both console and a configurable log file.
 * Respects debug mode for verbose output.
 */
export class Logger {
  private static instance: Logger | null = null;
  private logPath: string | null = null;
  private debugMode = false;
  private buffer: LogEntry[] = [];
  private configured = false;

  private constructor() {}

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Configure the logger with a file path and debug mode.
   */
  configure(options: { logPath?: string; debug?: boolean }): void {
    if (this.configured && this.logPath === options.logPath) {
      return; // Already configured with same path
    }

    this.logPath = options.logPath || null;
    this.debugMode = options.debug || false;
    this.configured = true;

    if (this.logPath) {
      // Ensure directory exists
      const dir = path.dirname(this.logPath);
      if (dir !== '.' && dir !== '/' && dir !== '/tmp') {
        fs.ensureDirSync(dir);
      }
      // Write header on configure
      this.writeToFile(`\n${'='.repeat(80)}`);
      this.writeToFile(`Dev-loop session started: ${new Date().toISOString()}`);
      this.writeToFile(`Debug mode: ${this.debugMode}`);
      this.writeToFile(`${'='.repeat(80)}\n`);
    }
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    let formatted = `[${timestamp}] [${levelStr}] ${message}`;
    if (data !== undefined) {
      if (typeof data === 'object') {
        formatted += '\n' + JSON.stringify(data, null, 2);
      } else {
        formatted += ` ${data}`;
      }
    }
    return formatted;
  }

  private writeToFile(content: string): void {
    if (this.logPath) {
      try {
        fs.appendFileSync(this.logPath, content + '\n');
      } catch (error) {
        // Silently fail file writes to avoid breaking main flow
        console.error(chalk.red(`[Logger] Failed to write to ${this.logPath}: ${error}`));
      }
    }
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const formatted = this.formatMessage(level, message, data);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data,
    };
    this.buffer.push(entry);

    // Always write to file if configured
    this.writeToFile(formatted);

    // Console output based on level and debug mode
    switch (level) {
      case 'debug':
        if (this.debugMode) {
          console.log(chalk.gray(formatted));
        }
        break;
      case 'info':
        console.log(chalk.blue(`[INFO] ${message}`));
        break;
      case 'warn':
        console.log(chalk.yellow(`[WARN] ${message}`));
        break;
      case 'error':
        console.log(chalk.red(`[ERROR] ${message}`));
        break;
    }
  }

  /**
   * Log debug messages (only shown in debug mode, always written to file)
   */
  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  /**
   * Log info messages
   */
  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  /**
   * Log warning messages
   */
  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  /**
   * Log error messages
   */
  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  /**
   * Log AI request/response details (always written to file for debugging)
   */
  logAICall(direction: 'request' | 'response', data: {
    model?: string;
    systemPrompt?: string;
    userPrompt?: string;
    response?: string;
    inputTokens?: number;
    outputTokens?: number;
    duration?: number;
    error?: string;
  }): void {
    const marker = direction === 'request' ? '>>> AI REQUEST' : '<<< AI RESPONSE';
    this.writeToFile(`\n${'-'.repeat(40)}`);
    this.writeToFile(marker);
    this.writeToFile(`${'-'.repeat(40)}`);

    if (data.model) {
      this.writeToFile(`Model: ${data.model}`);
    }
    if (data.duration !== undefined) {
      this.writeToFile(`Duration: ${data.duration}ms`);
    }
    if (data.inputTokens !== undefined) {
      this.writeToFile(`Input tokens: ${data.inputTokens}`);
    }
    if (data.outputTokens !== undefined) {
      this.writeToFile(`Output tokens: ${data.outputTokens}`);
    }
    if (data.systemPrompt) {
      this.writeToFile(`\n--- System Prompt ---`);
      this.writeToFile(data.systemPrompt.substring(0, 5000) + (data.systemPrompt.length > 5000 ? '\n...[truncated]' : ''));
    }
    if (data.userPrompt) {
      this.writeToFile(`\n--- User Prompt ---`);
      this.writeToFile(data.userPrompt.substring(0, 10000) + (data.userPrompt.length > 10000 ? '\n...[truncated]' : ''));
    }
    if (data.response) {
      this.writeToFile(`\n--- Response ---`);
      this.writeToFile(data.response.substring(0, 20000) + (data.response.length > 20000 ? '\n...[truncated]' : ''));
    }
    if (data.error) {
      this.writeToFile(`\n--- Error ---`);
      this.writeToFile(data.error);
    }
    this.writeToFile(`${'-'.repeat(40)}\n`);

    // Console output for debug mode
    if (this.debugMode) {
      console.log(chalk.cyan(`[DEBUG] ${marker}`));
      if (data.model) console.log(chalk.gray(`  Model: ${data.model}`));
      if (data.duration) console.log(chalk.gray(`  Duration: ${data.duration}ms`));
      if (data.inputTokens) console.log(chalk.gray(`  Input tokens: ${data.inputTokens}`));
      if (data.outputTokens) console.log(chalk.gray(`  Output tokens: ${data.outputTokens}`));
    }
  }

  /**
   * Log workflow events
   */
  logWorkflow(event: string, data?: unknown): void {
    this.writeToFile(`\n[WORKFLOW] ${event}`);
    if (data) {
      this.writeToFile(JSON.stringify(data, null, 2));
    }
    if (this.debugMode) {
      console.log(chalk.magenta(`[WORKFLOW] ${event}`));
    }
  }

  /**
   * Get the log file path
   */
  getLogPath(): string | null {
    return this.logPath;
  }

  /**
   * Get buffered log entries
   */
  getBuffer(): LogEntry[] {
    return [...this.buffer];
  }

  /**
   * Clear the buffer
   */
  clearBuffer(): void {
    this.buffer = [];
  }
}

// Export singleton instance
export const logger = Logger.getInstance();
