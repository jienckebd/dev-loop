/**
 * Unified Context Builder
 *
 * Provides consistent context building across all AI providers.
 * Extracts context from tasks, sessions, and codebase in a provider-agnostic way.
 */

import { Task, TaskContext } from '../../types';
import { Session, SessionContext } from './session-manager';
import { CodeContextProvider } from '../../core/analysis/code/context-provider';
import { ConversationManager } from '../../core/conversation/conversation-manager';
import { Conversation, SummarizedContext } from '../../core/conversation/types';
import { CodebaseAnalysisResult } from '../../core/analysis/codebase-analyzer';

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

  /**
   * Build PRD building context from conversation and codebase analysis
   */
  async buildPRDBuildingContext(
    conversation: Conversation,
    codebaseAnalysis: CodebaseAnalysisResult,
    maxContextChars: number = 75000
  ): Promise<string> {
    const parts: string[] = [];

    // 1. Conversation context (prioritize recent items)
    const conversationContext = await this.buildConversationContext(conversation, maxContextChars * 0.4); // 40% for conversation
    if (conversationContext) {
      parts.push('# Conversation Context\n');
      parts.push(conversationContext);
      parts.push('\n---\n');
    }

    // 2. Codebase context (filtered by feature types)
    const codebaseContext = this.buildCodebaseContext(
      codebaseAnalysis,
      maxContextChars * 0.4 // 40% for codebase
    );
    if (codebaseContext) {
      parts.push('# Codebase Context\n');
      parts.push(codebaseContext);
      parts.push('\n---\n');
    }

    // 3. Framework and feature type information (smaller portion)
    const frameworkContext = this.buildFrameworkContext(codebaseAnalysis, maxContextChars * 0.2); // 20% for framework
    if (frameworkContext) {
      parts.push('# Framework & Feature Type Context\n');
      parts.push(frameworkContext);
    }

    // Combine and limit total size
    const combined = parts.join('\n');
    if (combined.length > maxContextChars) {
      // Truncate while preserving structure
      return combined.substring(0, maxContextChars - 100) + '\n\n... (context truncated)';
    }

    return combined;
  }

  /**
   * Build conversation context (prioritize recent items, summarize old ones)
   */
  private async buildConversationContext(
    conversation: Conversation,
    maxChars: number
  ): Promise<string> {
    const lines: string[] = [];
    lines.push(`Mode: ${conversation.context.mode}`);
    lines.push(`Iteration: ${conversation.metadata.currentIteration}`);
    lines.push(`State: ${conversation.metadata.state}`);
    lines.push('');

    // Get recent items (last 10, full context)
    const recentItems = conversation.items.slice(-10);
    const oldItems = conversation.items.slice(0, -10);

    // Build recent context
    if (recentItems.length > 0) {
      lines.push('## Recent Questions & Answers (Full Context)');
      lines.push('');
      for (const item of recentItems) {
        lines.push(`### Question: ${item.question.text}`);
        if (item.answer) {
          lines.push(`Answer: ${typeof item.answer.value === 'string' ? item.answer.value : JSON.stringify(item.answer.value)}`);
        } else {
          lines.push('Answer: (not yet answered)');
        }
        lines.push('');
      }
    }

    // Summarize old items if they exist
    if (oldItems.length > 0) {
      lines.push('## Previous Conversation (Summarized)');
      lines.push('');
      const summary = this.summarizeConversationItems(oldItems);
      lines.push(summary);
      lines.push('');
    }

    // Add collected answers summary
    if (conversation.context.collectedAnswers.size > 0) {
      lines.push('## Collected Answers Summary');
      lines.push('');
      for (const [questionId, answer] of conversation.context.collectedAnswers.entries()) {
        lines.push(`- ${questionId}: ${typeof answer.value === 'string' ? answer.value : JSON.stringify(answer.value)}`);
      }
      lines.push('');
    }

    const context = lines.join('\n');
    if (context.length > maxChars) {
      // Truncate oldest items first
      return context.substring(0, maxChars - 100) + '\n... (conversation context truncated)';
    }

    return context;
  }

  /**
   * Summarize old conversation items
   */
  private summarizeConversationItems(items: Array<{ question: any; answer?: any }>): string {
    if (items.length === 0) {
      return 'No previous conversation.';
    }

    const questions = items.map(item => item.question.text).slice(0, 10);
    const answers = items
      .filter(item => item.answer)
      .map(item => `Q: ${item.question.text}\nA: ${typeof item.answer.value === 'string' ? item.answer.value : JSON.stringify(item.answer.value)}`)
      .slice(0, 10);

    if (answers.length > 0) {
      return `Previous ${items.length} Q&A pairs:\n\n${answers.join('\n\n')}`;
    } else {
      return `Previous ${items.length} questions asked (no answers yet):\n- ${questions.join('\n- ')}`;
    }
  }

  /**
   * Build codebase context (filtered by feature types)
   */
  private buildCodebaseContext(
    analysis: CodebaseAnalysisResult,
    maxChars: number
  ): string {
    const lines: string[] = [];

    // Framework information
    if (analysis.framework) {
      lines.push(`Framework: ${analysis.framework}`);
      if (analysis.frameworkPlugin) {
        lines.push(`Description: ${analysis.frameworkPlugin.description}`);
      }
      lines.push('');
    }

    // Feature types
    if (analysis.featureTypes && analysis.featureTypes.length > 0) {
      lines.push(`Detected Feature Types: ${analysis.featureTypes.join(', ')}`);
      lines.push('');
    }

    // Codebase summary
    if (analysis.codebaseContext) {
      lines.push('## Codebase Summary');
      lines.push(analysis.codebaseContext);
      lines.push('');
    }

    // Relevant files (limited)
    if (analysis.relevantFiles.length > 0) {
      lines.push('## Relevant Files');
      lines.push(`Total: ${analysis.relevantFiles.length} files analyzed`);
      lines.push('');
      for (const filePath of analysis.relevantFiles.slice(0, 20)) {
        // Limit to 20 files
        lines.push(`- ${filePath}`);
      }
      if (analysis.relevantFiles.length > 20) {
        lines.push(`... and ${analysis.relevantFiles.length - 20} more files`);
      }
      lines.push('');
    }

    // Patterns (if available)
    if (analysis.patterns && analysis.patterns.length > 0) {
      lines.push('## Detected Patterns');
      for (const pattern of analysis.patterns.slice(0, 10)) {
        // Limit to 10 patterns
        lines.push(`- ${pattern.type}: ${pattern.signature} (${pattern.occurrences} occurrences)`);
      }
      if (analysis.patterns.length > 10) {
        lines.push(`... and ${analysis.patterns.length - 10} more patterns`);
      }
      lines.push('');
    }

    // Schema patterns (if available)
    if (analysis.schemaPatterns && analysis.schemaPatterns.length > 0) {
      lines.push('## Schema Patterns');
      for (const schemaPattern of analysis.schemaPatterns.slice(0, 5)) {
        // Limit to 5 schema patterns
        lines.push(`- ${schemaPattern.type}: ${schemaPattern.pattern}`);
        if (schemaPattern.examples && schemaPattern.examples.length > 0) {
          lines.push(`  Examples: ${schemaPattern.examples.slice(0, 2).join(', ')}`);
        }
      }
      lines.push('');
    }

    const context = lines.join('\n');
    if (context.length > maxChars) {
      return context.substring(0, maxChars - 100) + '\n... (codebase context truncated)';
    }

    return context;
  }

  /**
   * Build framework context
   */
  private buildFrameworkContext(
    analysis: CodebaseAnalysisResult,
    maxChars: number
  ): string {
    const lines: string[] = [];

    if (analysis.frameworkPlugin) {
      lines.push(`Framework: ${analysis.frameworkPlugin.name}`);
      lines.push(`Description: ${analysis.frameworkPlugin.description}`);
      lines.push('');

      // Framework-specific file extensions
      const extensions = analysis.frameworkPlugin.getFileExtensions();
      if (extensions.length > 0) {
        lines.push(`File Extensions: ${extensions.join(', ')}`);
      }

      // Framework-specific search directories
      const searchDirs = analysis.frameworkPlugin.getSearchDirs();
      if (searchDirs.length > 0) {
        lines.push(`Search Directories: ${searchDirs.join(', ')}`);
      }

      // Framework-specific error patterns (if available)
      const errorPatterns = analysis.frameworkPlugin.getErrorPatterns();
      if (errorPatterns && Object.keys(errorPatterns).length > 0) {
        lines.push('');
        lines.push('Error Pattern Guidance:');
        for (const [pattern, guidance] of Object.entries(errorPatterns).slice(0, 5)) {
          // Limit to 5 error patterns
          lines.push(`- ${pattern}: ${guidance}`);
        }
      }
    }

    // Feature types with evidence
    if (analysis.featureTypes && analysis.featureTypes.length > 0) {
      lines.push('');
      lines.push('Feature Types:');
      for (const featureType of analysis.featureTypes) {
        lines.push(`- ${featureType}`);
      }
    }

    const context = lines.join('\n');
    if (context.length > maxChars) {
      return context.substring(0, maxChars - 50) + '\n... (truncated)';
    }

    return context;
  }

  /**
   * Prioritize context items (recent over old)
   */
  private prioritizeContext<T extends { timestamp?: string }>(
    items: T[],
    maxItems: number
  ): T[] {
    // Sort by timestamp (newest first), then take top N
    const sorted = [...items].sort((a, b) => {
      if (!a.timestamp && !b.timestamp) return 0;
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return sorted.slice(0, maxItems);
  }
}

