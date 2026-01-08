/**
 * Unified Context Builder
 *
 * Provides consistent context building across all AI providers.
 * Extracts context from tasks, sessions, and codebase in a provider-agnostic way.
 */

import { Task, TaskContext } from '../../types';
import { Session, SessionContext } from './session-manager';
import { CodeContextProvider } from '../../core/code-context-provider';

export interface ContextBuilderConfig {
  includeSkeleton?: boolean;
  maxContextChars?: number;
  codeContextProvider?: CodeContextProvider;
}

/**
 * Unified context builder for all AI providers
 */
export class ContextBuilder {
  private config: ContextBuilderConfig & { includeSkeleton: boolean; maxContextChars: number };
  private codeContextProvider?: CodeContextProvider;

  constructor(config: ContextBuilderConfig = {}) {
    this.config = {
      includeSkeleton: config.includeSkeleton !== false,
      maxContextChars: config.maxContextChars || 25000,
      codeContextProvider: config.codeContextProvider,
    };
    this.codeContextProvider = config.codeContextProvider;
  }

  /**
   * Build unified context from task and optional session
   */
  async buildContext(task: Task, session: Session | null): Promise<TaskContext> {
    // Extract codebase context
    const { codebaseContext, targetFiles, existingCode } = await this.getCodebaseContext(task);

    // Build session history context if session exists
    const sessionContext = session ? this.buildSessionContext(session) : undefined;

    // Combine all context
    const context: TaskContext = {
      task,
      codebaseContext: this.combineContext(codebaseContext, sessionContext),
      prdId: session?.context.prdId,
      phaseId: session?.context.phaseId,
      prdSetId: session?.context.prdSetId,
    };

    return context;
  }

  /**
   * Get codebase context for a task
   */
  private async getCodebaseContext(task: Task): Promise<{
    codebaseContext: string;
    targetFiles?: string;
    existingCode?: string;
  }> {
    if (!this.codeContextProvider) {
      return {
        codebaseContext: '',
      };
    }

    // Extract file paths from task
    const taskText = `${task.title} ${task.description} ${task.details || ''}`;
    const filePaths = this.extractFilePaths(taskText);

    // Build context from files
    const contexts: string[] = [];
    let totalChars = 0;

    for (const filePath of filePaths.slice(0, 10)) { // Limit to 10 files
      if (totalChars >= this.config.maxContextChars) {
        break;
      }

      try {
        const fileContext = await this.codeContextProvider.getFileContext(filePath);
        if (fileContext) {
          // Format file context from FileContext interface
          const contextStr = this.formatFileContext(fileContext, filePath);
          if (totalChars + contextStr.length <= this.config.maxContextChars) {
            contexts.push(contextStr);
            totalChars += contextStr.length;
          }
        }
      } catch (error) {
        // Skip files that can't be read
      }
    }

    return {
      codebaseContext: contexts.join('\n\n'),
      targetFiles: filePaths.join('\n'),
    };
  }

  /**
   * Build session context from session history
   */
  private buildSessionContext(session: Session): string {
    if (session.history.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push('Previous conversation context:');
    lines.push('');

    // Include recent history (last 5 entries)
    const recentHistory = session.history.slice(-5);
    for (const entry of recentHistory) {
      lines.push(`[Previous Request ${entry.requestId.substring(0, 8)}]`);
      lines.push(`Prompt: ${entry.prompt.substring(0, 200)}${entry.prompt.length > 200 ? '...' : ''}`);
      if (entry.success && entry.response) {
        lines.push(`Response: Success (${entry.response.files?.length || 0} files generated)`);
      } else if (entry.error) {
        lines.push(`Response: Error - ${entry.error.substring(0, 100)}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Combine codebase context with session context
   */
  private combineContext(codebaseContext: string, sessionContext?: string): string {
    const parts: string[] = [];

    if (sessionContext) {
      parts.push(sessionContext);
      parts.push('---');
      parts.push('');
    }

    parts.push('Codebase Context:');
    parts.push(codebaseContext);

    return parts.join('\n');
  }

  /**
   * Extract file paths from task text
   */
  private extractFilePaths(taskText: string): string[] {
    const filePaths: string[] = [];
    const pathPattern = /([\w./\-]+\.[a-z]+)/gi;
    let match;

    while ((match = pathPattern.exec(taskText)) !== null) {
      const filePath = match[1];
      if (filePath.includes('/') || filePath.includes('.')) {
        filePaths.push(filePath);
      }
    }

    return [...new Set(filePaths)]; // Remove duplicates
  }

  /**
   * Format file context for inclusion in prompt
   */
  private formatFileContext(fileContext: any, filePath: string): string {
    // Format from FileContext interface
    const lines: string[] = [];
    lines.push(`File: ${filePath}`);
    lines.push('');

    if (fileContext.imports && fileContext.imports.length > 0) {
      lines.push('Imports:');
      fileContext.imports.forEach((imp: string) => lines.push(`  ${imp}`));
      lines.push('');
    }

    if (fileContext.helperSignatures && fileContext.helperSignatures.length > 0) {
      lines.push('Available functions/classes:');
      fileContext.helperSignatures.forEach((sig: string) => lines.push(`  ${sig}`));
      lines.push('');
    }

    if (fileContext.skeleton) {
      lines.push('File structure:');
      lines.push(fileContext.skeleton);
    }

    if (fileContext.fullContent) {
      lines.push('');
      lines.push('Full content:');
      lines.push(fileContext.fullContent);
    }

    return lines.join('\n');
  }
}

