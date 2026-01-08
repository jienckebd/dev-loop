/**
 * Model-Agnostic Agent Interface
 *
 * Provides a unified interface for AI agent interactions across all providers.
 * Abstracts provider-specific differences (CLI vs API) behind a common interface.
 */

import { CodeChanges, TaskContext } from '../../types';
import { Session } from './session-manager';

/**
 * Unified agent interface for all AI providers
 *
 * This interface abstracts the differences between:
 * - Cursor: CLI-based background agents
 * - OpenAI/Anthropic/Gemini/Ollama: API-based calls
 */
export interface AgentInterface {
  /**
   * Generate code changes for a task
   */
  generateCode(prompt: string, context: TaskContext): Promise<CodeChanges>;

  /**
   * Get session for a given context (if session management is supported)
   */
  getSession(sessionId: string): Session | null;

  /**
   * Get or create session for a given context
   */
  getOrCreateSession(context: any): Session | null;

  /**
   * Provider name (e.g., 'cursor', 'openai', 'anthropic')
   */
  readonly name: string;

  /**
   * Check if provider supports session management
   */
  supportsSessions(): boolean;

  /**
   * Check if provider supports parallel execution
   */
  supportsParallelExecution(): boolean;
}

/**
 * Base implementation of AgentInterface with common functionality
 * Providers can extend this to implement provider-specific behavior
 */
export abstract class BaseAgent implements AgentInterface {
  abstract readonly name: string;

  abstract generateCode(prompt: string, context: TaskContext): Promise<CodeChanges>;

  /**
   * Get session (default: not supported)
   */
  getSession(sessionId: string): Session | null {
    return null;
  }

  /**
   * Get or create session (default: not supported)
   */
  getOrCreateSession(context: any): Session | null {
    return null;
  }

  /**
   * Check if provider supports session management
   */
  supportsSessions(): boolean {
    return false;
  }

  /**
   * Check if provider supports parallel execution
   */
  supportsParallelExecution(): boolean {
    return true; // Most providers support parallel execution
  }
}

