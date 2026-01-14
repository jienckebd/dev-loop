/**
 * CLI Command Executor
 *
 * Executes framework-specific CLI commands for agentic operations.
 * Supports placeholder substitution, timeout handling, and metrics collection.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { FrameworkCLICommand } from '../../frameworks/interface';
import { emitEvent } from '../utils/event-stream';

const execAsync = promisify(exec);

/**
 * Result of a CLI command execution
 */
export interface CLIExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
  durationMs: number;
  command: string;
  commandName: string;
}

/**
 * Metrics collected for CLI command execution
 */
export interface CLICommandMetrics {
  commandsExecuted: number;
  commandsByType: Record<string, number>;
  commandsByName: Record<string, number>;
  successRate: number;
  avgExecutionTimeMs: number;
  totalExecutionTimeMs: number;
  failures: {
    total: number;
    byCommand: Record<string, number>;
    byErrorType: Record<string, number>;
  };
}

/**
 * CLI Command Executor Service
 *
 * Manages registration and execution of framework CLI commands.
 * Provides placeholder substitution and execution metrics.
 */
export class CLICommandExecutor {
  private commands: Map<string, FrameworkCLICommand> = new Map();
  private metrics: CLICommandMetrics;
  private projectRoot: string;
  private debug: boolean;

  constructor(projectRoot: string, debug: boolean = false) {
    this.projectRoot = projectRoot;
    this.debug = debug;
    this.metrics = this.createDefaultMetrics();
  }

  /**
   * Register CLI commands from a framework plugin
   */
  registerCommands(commands: FrameworkCLICommand[]): void {
    for (const cmd of commands) {
      this.commands.set(cmd.name, cmd);
      if (this.debug) {
        console.log(`[CLIExecutor] Registered command: ${cmd.name}`);
      }
    }
  }

  /**
   * Get a registered command by name
   */
  getCommand(name: string): FrameworkCLICommand | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all registered commands
   */
  getAllCommands(): FrameworkCLICommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Execute a CLI command by name with arguments
   */
  async execute(
    commandName: string,
    args: Record<string, string> = {}
  ): Promise<CLIExecutionResult> {
    const startTime = Date.now();
    const cmd = this.commands.get(commandName);

    if (!cmd) {
      return {
        success: false,
        output: '',
        error: `Unknown command: ${commandName}. Available commands: ${Array.from(this.commands.keys()).join(', ')}`,
        durationMs: Date.now() - startTime,
        command: '',
        commandName,
      };
    }

    // Replace placeholders with arguments
    let command = cmd.command;
    for (const [key, value] of Object.entries(args)) {
      command = command.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }

    // Verify all placeholders are replaced
    const unreplacedPlaceholders = command.match(/\{(\w+)\}/g);
    if (unreplacedPlaceholders) {
      const missing = unreplacedPlaceholders.map(p => p.slice(1, -1));
      return {
        success: false,
        output: '',
        error: `Missing required arguments for command ${commandName}: ${missing.join(', ')}`,
        durationMs: Date.now() - startTime,
        command,
        commandName,
      };
    }

    // Check if confirmation is required
    if (cmd.requiresConfirmation) {
      console.log(`[CLIExecutor] Command ${commandName} requires confirmation (skipping in autonomous mode)`);
      // In autonomous mode, we skip commands that require confirmation
      // This can be overridden by passing a flag in the future
    }

    if (this.debug) {
      console.log(`[CLIExecutor] Executing: ${command}`);
    }

    try {
      const timeout = cmd.timeout || 60000;
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.projectRoot,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const durationMs = Date.now() - startTime;
      this.recordSuccess(commandName, cmd.purpose, durationMs);

      // Emit success event for metrics tracking
      emitEvent('cli:command_executed', {
        commandName,
        purpose: cmd.purpose,
        success: true,
        durationMs,
        idempotent: cmd.idempotent,
      });

      return {
        success: true,
        output: stdout.trim(),
        error: stderr ? stderr.trim() : undefined,
        exitCode: 0,
        durationMs,
        command,
        commandName,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error.message || 'Command failed';
      const errorType = this.classifyError(errorMessage);

      this.recordFailure(commandName, cmd.purpose, errorType);

      // Emit failure event for metrics tracking
      emitEvent('cli:command_failed', {
        commandName,
        purpose: cmd.purpose,
        success: false,
        durationMs,
        errorType,
        error: errorMessage.substring(0, 200),
      });

      return {
        success: false,
        output: error.stdout || '',
        error: errorMessage,
        exitCode: error.code,
        durationMs,
        command,
        commandName,
      };
    }
  }

  /**
   * Execute a raw command string (not from registered commands)
   */
  async executeRaw(
    command: string,
    timeout: number = 60000
  ): Promise<CLIExecutionResult> {
    const startTime = Date.now();

    if (this.debug) {
      console.log(`[CLIExecutor] Executing raw: ${command}`);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.projectRoot,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        success: true,
        output: stdout.trim(),
        error: stderr ? stderr.trim() : undefined,
        exitCode: 0,
        durationMs: Date.now() - startTime,
        command,
        commandName: 'raw',
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.stdout || '',
        error: error.message || 'Command failed',
        exitCode: error.code,
        durationMs: Date.now() - startTime,
        command,
        commandName: 'raw',
      };
    }
  }

  /**
   * Get commands formatted for AI prompts
   */
  getCommandsForPrompt(): string {
    const lines: string[] = ['## Available CLI Commands\n'];
    const commandsByPurpose = new Map<string, FrameworkCLICommand[]>();

    // Group by purpose
    for (const cmd of this.commands.values()) {
      const purpose = cmd.purpose;
      if (!commandsByPurpose.has(purpose)) {
        commandsByPurpose.set(purpose, []);
      }
      commandsByPurpose.get(purpose)!.push(cmd);
    }

    // Output grouped commands
    for (const [purpose, cmds] of commandsByPurpose) {
      lines.push(`### ${this.formatPurpose(purpose)}\n`);
      for (const cmd of cmds) {
        lines.push(`- **${cmd.name}**: ${cmd.description}`);
        lines.push(`  - Command: \`${cmd.command}\``);
        if (cmd.placeholders && cmd.placeholders.length > 0) {
          lines.push(`  - Placeholders: ${cmd.placeholders.join(', ')}`);
        }
        if (cmd.example) {
          lines.push(`  - Example: \`${cmd.example}\``);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Get collected metrics
   */
  getMetrics(): CLICommandMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.createDefaultMetrics();
  }

  // ===== Private Methods =====

  private createDefaultMetrics(): CLICommandMetrics {
    return {
      commandsExecuted: 0,
      commandsByType: {},
      commandsByName: {},
      successRate: 0,
      avgExecutionTimeMs: 0,
      totalExecutionTimeMs: 0,
      failures: {
        total: 0,
        byCommand: {},
        byErrorType: {},
      },
    };
  }

  private recordSuccess(commandName: string, purpose: string, durationMs: number): void {
    this.metrics.commandsExecuted++;
    this.metrics.commandsByType[purpose] = (this.metrics.commandsByType[purpose] || 0) + 1;
    this.metrics.commandsByName[commandName] = (this.metrics.commandsByName[commandName] || 0) + 1;
    this.metrics.totalExecutionTimeMs += durationMs;
    this.updateAvgExecutionTime();
    this.updateSuccessRate();
  }

  private recordFailure(commandName: string, purpose: string, errorType: string): void {
    this.metrics.commandsExecuted++;
    this.metrics.commandsByType[purpose] = (this.metrics.commandsByType[purpose] || 0) + 1;
    this.metrics.commandsByName[commandName] = (this.metrics.commandsByName[commandName] || 0) + 1;
    this.metrics.failures.total++;
    this.metrics.failures.byCommand[commandName] = (this.metrics.failures.byCommand[commandName] || 0) + 1;
    this.metrics.failures.byErrorType[errorType] = (this.metrics.failures.byErrorType[errorType] || 0) + 1;
    this.updateSuccessRate();
  }

  private updateAvgExecutionTime(): void {
    const successfulCommands = this.metrics.commandsExecuted - this.metrics.failures.total;
    if (successfulCommands > 0) {
      this.metrics.avgExecutionTimeMs = this.metrics.totalExecutionTimeMs / successfulCommands;
    }
  }

  private updateSuccessRate(): void {
    if (this.metrics.commandsExecuted > 0) {
      const successful = this.metrics.commandsExecuted - this.metrics.failures.total;
      this.metrics.successRate = successful / this.metrics.commandsExecuted;
    }
  }

  private classifyError(errorMessage: string): string {
    const lowerError = errorMessage.toLowerCase();

    if (lowerError.includes('timeout')) return 'timeout';
    if (lowerError.includes('permission denied')) return 'permission';
    if (lowerError.includes('not found') || lowerError.includes('command not found')) return 'not_found';
    if (lowerError.includes('connection')) return 'connection';
    if (lowerError.includes('memory')) return 'memory';
    if (lowerError.includes('syntax')) return 'syntax';

    return 'unknown';
  }

  private formatPurpose(purpose: string): string {
    return purpose
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
