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
  private mcpMode = false;  // When true, use stderr instead of stdout

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
  configure(options: { logPath?: string; debug?: boolean; mcpMode?: boolean }): void {
    if (this.configured && this.logPath === options.logPath && this.mcpMode === options.mcpMode) {
      return; // Already configured with same options
    }

    this.logPath = options.logPath || null;
    this.debugMode = options.debug || false;
    this.mcpMode = options.mcpMode || false;
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

    // In MCP mode, suppress console output (use only file logging)
    // This prevents interference with the MCP JSON-RPC protocol
    if (this.mcpMode) {
      return;
    }

    // Console output based on level and debug mode
    switch (level) {
      case 'debug':
        if (this.debugMode) {
          console.error(chalk.gray(formatted));
        }
        break;
      case 'info':
        console.error(chalk.blue(`[INFO] ${message}`));
        break;
      case 'warn':
        console.error(chalk.yellow(`[WARN] ${message}`));
        break;
      case 'error':
        console.error(chalk.red(`[ERROR] ${message}`));
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

    // Console output for debug mode (use stderr to avoid MCP interference)
    if (this.debugMode && !this.mcpMode) {
      console.error(chalk.cyan(`[DEBUG] ${marker}`));
      if (data.model) console.error(chalk.gray(`  Model: ${data.model}`));
      if (data.duration) console.error(chalk.gray(`  Duration: ${data.duration}ms`));
      if (data.inputTokens) console.error(chalk.gray(`  Input tokens: ${data.inputTokens}`));
      if (data.outputTokens) console.error(chalk.gray(`  Output tokens: ${data.outputTokens}`));
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
    if (this.debugMode && !this.mcpMode) {
      console.error(chalk.magenta(`[WORKFLOW] ${event}`));
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
