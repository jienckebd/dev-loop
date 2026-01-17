/**
 * Phase Hook Executor
 *
 * Executes lifecycle hooks defined in phase YAML files.
 * Supports cli_command, shell, and callback hook types.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CLICommandExecutor } from './cli-executor';
import { logger } from '../utils/logger';
import { emitEvent } from '../utils/event-stream';
import { DrupalPlugin } from '../../frameworks/drupal';

export interface PhaseHook {
  type: 'cli_command' | 'shell' | 'callback';
  command?: string;
  cliCommand?: string;
  args?: Record<string, string>;
  description?: string;
  continueOnError?: boolean;
}

export interface PhaseHooks {
  onPhaseStart?: PhaseHook[];
  onPhaseComplete?: PhaseHook[];
  onTaskComplete?: PhaseHook[];
}

export interface PhaseHookResult {
  success: boolean;
  hookType: string;
  hookIndex: number;
  description?: string;
  error?: string;
  durationMs: number;
}

export class PhaseHookExecutor {
  private cliExecutor: CLICommandExecutor;
  private debug: boolean;
  private projectRoot: string;

  constructor(config: any, debug: boolean = false) {
    this.debug = debug;
    this.projectRoot = config.projectRoot || process.cwd();
    this.cliExecutor = new CLICommandExecutor(this.projectRoot, debug);

    // Register Drupal CLI commands if Drupal framework is detected
    this.registerFrameworkCommands();
  }

  /**
   * Register framework-specific CLI commands
   */
  private registerFrameworkCommands(): void {
    try {
      // For now, always register Drupal commands for sysf project
      const drupalPlugin = new DrupalPlugin();
      const commands = drupalPlugin.getCLICommands();
      this.cliExecutor.registerCommands(commands);
      logger.debug(`[PhaseHookExecutor] Registered ${commands.length} Drupal CLI commands`);
    } catch (error) {
      logger.warn(`[PhaseHookExecutor] Failed to register framework commands: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Load hooks from a phase YAML file
   */
  async loadPhaseHooks(phaseFilePath: string): Promise<PhaseHooks | null> {
    try {
      if (!fs.existsSync(phaseFilePath)) {
        logger.debug(`[PhaseHookExecutor] Phase file not found: ${phaseFilePath}`);
        return null;
      }

      const content = fs.readFileSync(phaseFilePath, 'utf-8');

      // Extract YAML frontmatter between --- markers
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        logger.debug(`[PhaseHookExecutor] No YAML frontmatter found in: ${phaseFilePath}`);
        return null;
      }

      const frontmatter = yaml.load(frontmatterMatch[1]) as any;

      // Check for hooks section
      if (!frontmatter || !frontmatter.hooks) {
        logger.debug(`[PhaseHookExecutor] No hooks section in: ${phaseFilePath}`);
        return null;
      }

      const hooks: PhaseHooks = {};

      if (frontmatter.hooks.onPhaseStart) {
        hooks.onPhaseStart = frontmatter.hooks.onPhaseStart;
      }
      if (frontmatter.hooks.onPhaseComplete) {
        hooks.onPhaseComplete = frontmatter.hooks.onPhaseComplete;
      }
      if (frontmatter.hooks.onTaskComplete) {
        hooks.onTaskComplete = frontmatter.hooks.onTaskComplete;
      }

      logger.debug(`[PhaseHookExecutor] Loaded hooks from ${phaseFilePath}: onPhaseStart=${hooks.onPhaseStart?.length || 0}, onPhaseComplete=${hooks.onPhaseComplete?.length || 0}`);

      return hooks;
    } catch (error) {
      logger.warn(`[PhaseHookExecutor] Failed to load hooks from ${phaseFilePath}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Execute onPhaseComplete hooks
   */
  async executeOnPhaseComplete(phaseFilePath: string, context: {
    prdId?: string;
    phaseId?: number | string;
  }): Promise<PhaseHookResult[]> {
    const hooks = await this.loadPhaseHooks(phaseFilePath);
    if (!hooks?.onPhaseComplete?.length) {
      return [];
    }

    logger.info(`[PhaseHookExecutor] Executing ${hooks.onPhaseComplete.length} onPhaseComplete hooks for phase: ${phaseFilePath}`);

    const results: PhaseHookResult[] = [];

    for (let i = 0; i < hooks.onPhaseComplete.length; i++) {
      const hook = hooks.onPhaseComplete[i];
      const result = await this.executeHook(hook, i, 'onPhaseComplete', context);
      results.push(result);

      if (!result.success && !hook.continueOnError) {
        logger.error(`[PhaseHookExecutor] Hook failed and continueOnError=false, stopping hook execution`);
        break;
      }
    }

    return results;
  }

  /**
   * Execute onPhaseStart hooks
   */
  async executeOnPhaseStart(phaseFilePath: string, context: {
    prdId?: string;
    phaseId?: number | string;
  }): Promise<PhaseHookResult[]> {
    const hooks = await this.loadPhaseHooks(phaseFilePath);
    if (!hooks?.onPhaseStart?.length) {
      return [];
    }

    logger.info(`[PhaseHookExecutor] Executing ${hooks.onPhaseStart.length} onPhaseStart hooks for phase: ${phaseFilePath}`);

    const results: PhaseHookResult[] = [];

    for (let i = 0; i < hooks.onPhaseStart.length; i++) {
      const hook = hooks.onPhaseStart[i];
      const result = await this.executeHook(hook, i, 'onPhaseStart', context);
      results.push(result);

      if (!result.success && !hook.continueOnError) {
        logger.error(`[PhaseHookExecutor] Hook failed and continueOnError=false, stopping hook execution`);
        break;
      }
    }

    return results;
  }

  /**
   * Execute a single hook
   */
  private async executeHook(hook: PhaseHook, index: number, hookType: string, context: {
    prdId?: string;
    phaseId?: number | string;
  }): Promise<PhaseHookResult> {
    const startTime = Date.now();
    const description = hook.description || `${hook.type}: ${hook.cliCommand || hook.command}`;

    logger.info(`[PhaseHookExecutor] Executing hook ${index + 1}: ${description}`);

    emitEvent('hook:started', {
      hookType,
      hookIndex: index,
      description,
      type: hook.type,
    }, {
      prdId: context.prdId,
      phaseId: context.phaseId ? Number(context.phaseId) : undefined,
    });

    try {
      switch (hook.type) {
        case 'cli_command':
          await this.executeCLICommand(hook);
          break;
        case 'shell':
          await this.executeShellCommand(hook);
          break;
        case 'callback':
          logger.warn(`[PhaseHookExecutor] Callback hooks not yet implemented`);
          break;
        default:
          throw new Error(`Unknown hook type: ${hook.type}`);
      }

      const durationMs = Date.now() - startTime;
      logger.info(`[PhaseHookExecutor] Hook ${index + 1} completed successfully (${durationMs}ms)`);

      emitEvent('hook:completed', {
        hookType,
        hookIndex: index,
        description,
        success: true,
        durationMs,
      }, {
        prdId: context.prdId,
        phaseId: context.phaseId ? Number(context.phaseId) : undefined,
      });

      return {
        success: true,
        hookType,
        hookIndex: index,
        description,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`[PhaseHookExecutor] Hook ${index + 1} failed: ${errorMessage}`);

      emitEvent('hook:failed', {
        hookType,
        hookIndex: index,
        description,
        error: errorMessage,
        durationMs,
      }, {
        prdId: context.prdId,
        phaseId: context.phaseId ? Number(context.phaseId) : undefined,
        severity: 'error',
      });

      return {
        success: false,
        hookType,
        hookIndex: index,
        description,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Execute a CLI command hook via framework CLI
   */
  private async executeCLICommand(hook: PhaseHook): Promise<void> {
    if (!hook.cliCommand) {
      throw new Error('CLI command hook missing cliCommand property');
    }

    // Build args for CLI executor
    const args: Record<string, any> = { ...hook.args };

    logger.debug(`[PhaseHookExecutor] Executing CLI command: ${hook.cliCommand} with args: ${JSON.stringify(args)}`);

    // Use the CLI executor to run framework commands
    const result = await this.cliExecutor.execute(hook.cliCommand, args);

    if (!result.success) {
      throw new Error(`CLI command failed: ${result.error || 'Unknown error'}`);
    }
  }

  /**
   * Execute a shell command hook
   */
  private async executeShellCommand(hook: PhaseHook): Promise<void> {
    if (!hook.command) {
      throw new Error('Shell command hook missing command property');
    }

    const { execSync } = require('child_process');

    logger.debug(`[PhaseHookExecutor] Executing shell command: ${hook.command}`);

    // Execute with env variables from args if provided
    const env = { ...process.env, ...hook.args };

    execSync(hook.command, {
      cwd: process.cwd(),
      stdio: this.debug ? 'inherit' : 'pipe',
      env,
    });
  }
}

/**
 * Find phase file path from task details
 */
export function findPhaseFilePath(prdSetDir: string, prdId: string, phaseId: number | string): string | null {
  // Common phase file naming patterns
  const patterns = [
    `phase${phaseId}_phase_${phaseId}.md.yml`,
    `phase_${phaseId}.md.yml`,
    `phase${phaseId}.md.yml`,
    `${prdId}_phase${phaseId}.md.yml`,
  ];

  for (const pattern of patterns) {
    const fullPath = path.join(prdSetDir, pattern);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Try finding any file matching phase pattern
  try {
    const files = fs.readdirSync(prdSetDir);
    const phaseFile = files.find(f =>
      f.includes(`phase${phaseId}`) && f.endsWith('.md.yml')
    );
    if (phaseFile) {
      return path.join(prdSetDir, phaseFile);
    }
  } catch {
    // Directory not accessible
  }

  return null;
}
