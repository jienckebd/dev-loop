/**
 * AmpProvider - Amp AI Provider
 *
 * Implements the AIProvider interface for Amp (https://ampcode.com/).
 * Amp is a CLI-based AI coding agent similar to Cursor.
 */

import { spawn } from 'child_process';
import {
  AIProvider,
  AIProviderConfig,
  TokenUsage,
  TextGenerationOptions,
} from './interface';
import { CodeChanges, TaskContext, LogAnalysis } from '../../types';
import { logger } from '../../core/utils/logger';
import { parseCodeChangesFromText } from './json-parser';

export class AmpProvider implements AIProvider {
  name = 'amp';
  private lastTokens: TokenUsage = {};
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  /**
   * Generate code changes from a prompt
   */
  async generateCode(prompt: string, context: TaskContext): Promise<CodeChanges> {
    const fullPrompt = this.buildCodeGenerationPrompt(prompt, context);
    const result = await this.invokeAmpCli(fullPrompt);
    return this.parseCodeChanges(result, context);
  }

  /**
   * Analyze errors and provide recommendations
   */
  async analyzeError(error: string, context: TaskContext): Promise<LogAnalysis> {
    const prompt = `Analyze this error and provide fix recommendations:

## Error
${error}

## Context
Task: ${context.task.title}
${context.codebaseContext ? `\nRelevant Code:\n${context.codebaseContext.substring(0, 5000)}` : ''}

## Instructions
1. Identify the root cause
2. Provide specific fix recommendations
3. List any warnings or considerations`;

    const result = await this.invokeAmpCli(prompt);
    return this.parseLogAnalysis(result);
  }

  /**
   * Generate text for general purposes
   */
  async generateText(prompt: string, options?: TextGenerationOptions): Promise<string> {
    const fullPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n${prompt}`
      : prompt;

    return this.invokeAmpCli(fullPrompt);
  }

  /**
   * Invoke the Amp CLI
   */
  private async invokeAmpCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const args: string[] = [];

      // Build command arguments
      // Note: Amp CLI interface may differ - adjust as needed
      if (this.config.model && this.config.model !== 'auto') {
        args.push('--model', this.config.model);
      }

      // Add the message/prompt
      args.push('--message', prompt);

      logger.debug(`[AmpProvider] Invoking Amp CLI with model: ${this.config.model || 'auto'}`);

      const proc = spawn('amp', args, {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;

        // Estimate token usage (rough approximation)
        this.lastTokens = {
          input: Math.ceil(prompt.length / 4),
          output: Math.ceil(stdout.length / 4),
        };

        logger.debug(`[AmpProvider] Amp CLI completed in ${duration}ms, exit code: ${code}`);

        if (code === 0) {
          resolve(stdout);
        } else {
          const errorMessage = stderr || `Amp CLI exited with code ${code}`;
          logger.error(`[AmpProvider] Amp CLI error: ${errorMessage}`);
          reject(new Error(errorMessage));
        }
      });

      proc.on('error', (error) => {
        logger.error(`[AmpProvider] Failed to spawn Amp CLI: ${error.message}`);
        reject(new Error(`Failed to invoke Amp CLI: ${error.message}. Is 'amp' installed and in PATH?`));
      });

      // Write prompt to stdin if needed (alternative to --message)
      // proc.stdin?.write(prompt);
      // proc.stdin?.end();
    });
  }

  /**
   * Build prompt for code generation
   */
  private buildCodeGenerationPrompt(prompt: string, context: TaskContext): string {
    const parts: string[] = [];

    // Task description
    parts.push(`# Task: ${context.task.title}`);
    parts.push('');
    parts.push(context.task.description);

    if (context.task.details) {
      parts.push('');
      parts.push('## Details');
      parts.push(context.task.details);
    }

    // Custom prompt content
    if (prompt && prompt !== context.task.description) {
      parts.push('');
      parts.push('## Instructions');
      parts.push(prompt);
    }

    // Codebase context
    if (context.codebaseContext) {
      parts.push('');
      parts.push('## Relevant Code');
      parts.push(context.codebaseContext);
    }

    // Target module constraint
    if (context.targetModule) {
      parts.push('');
      parts.push('## IMPORTANT: Target Module Constraint');
      parts.push(`Only modify files within: ${context.targetModule}`);
      parts.push('Do NOT modify files outside this module path.');
    }

    // Output format instructions
    parts.push('');
    parts.push('## Output Format');
    parts.push('Provide code changes in the following format:');
    parts.push('');
    parts.push('For each file:');
    parts.push('```<language>:<filepath>');
    parts.push('// file content');
    parts.push('```');
    parts.push('');
    parts.push('Or for patches:');
    parts.push('```diff:<filepath>');
    parts.push('<<<< SEARCH');
    parts.push('code to find');
    parts.push('====');
    parts.push('replacement code');
    parts.push('>>>> REPLACE');
    parts.push('```');

    return parts.join('\n');
  }

  /**
   * Parse code changes from Amp output
   */
  private parseCodeChanges(output: string, context: TaskContext): CodeChanges {
    try {
      // Try to parse using the standard parser
      // Convert TaskContext to JsonParsingContext format
      const parsingContext = {
        taskId: context.task.id,
        phaseId: context.phaseId ?? undefined,
        prdId: context.prdId,
        prdSetId: context.prdSetId ?? undefined,
      };
      const result = parseCodeChangesFromText(output, undefined, parsingContext);
      return result || {
        files: [],
        summary: 'No code changes parsed from Amp output',
      };
    } catch (error) {
      logger.warn(`[AmpProvider] Failed to parse code changes: ${error}`);
      return {
        files: [],
        summary: 'Failed to parse code changes from Amp output',
      };
    }
  }

  /**
   * Parse log analysis from Amp output
   */
  private parseLogAnalysis(output: string): LogAnalysis {
    const errors: string[] = [];
    const warnings: string[] = [];
    const recommendations: string[] = [];

    // Extract errors
    const errorSection = output.match(/(?:error|cause|issue)[:\s]*([\s\S]*?)(?=warning|recommendation|$)/i);
    if (errorSection) {
      const lines = errorSection[1].split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'));
      errors.push(...lines.map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean));
    }

    // Extract recommendations
    const recSection = output.match(/(?:recommendation|fix|suggestion)[:\s]*([\s\S]*?)(?=warning|$)/i);
    if (recSection) {
      const lines = recSection[1].split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*') || l.trim().match(/^\d+\./));
      recommendations.push(...lines.map(l => l.replace(/^[-*\d.]\s*/, '').trim()).filter(Boolean));
    }

    // If no structured content found, use first line as summary
    if (errors.length === 0) {
      const firstLine = output.split('\n').find(l => l.trim());
      if (firstLine) {
        errors.push(firstLine.trim());
      }
    }

    return {
      errors: errors.length > 0 ? errors : ['Unable to parse error details'],
      warnings,
      summary: errors[0] || 'Error analysis from Amp',
      recommendations: recommendations.length > 0 ? recommendations : ['Review the error details manually'],
    };
  }

  /**
   * Get token usage from last call
   */
  getLastTokens(): TokenUsage {
    return this.lastTokens;
  }

  /**
   * Check if Amp CLI is available
   */
  static async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('amp', ['--version'], { stdio: 'pipe' });
      
      proc.on('close', (code) => {
        resolve(code === 0);
      });

      proc.on('error', () => {
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve(false);
      }, 5000);
    });
  }
}
