/**
 * API Agent Wrapper
 *
 * Wraps API-based AI providers to provide background-agent-like interface.
 * Enables consistent behavior across Cursor CLI and API providers with:
 * - Progress event emission
 * - Build metrics tracking
 * - Session history management
 * - Token tracking
 */

import { AIProvider } from './interface';
import { CodeChanges, TaskContext } from '../../types';
import { Session, SessionContext } from './session-manager';
import { emitEvent } from '../../core/utils/event-stream';
import { getBuildMetrics } from '../../core/metrics/build';
import { getParallelMetricsTracker } from '../../core/metrics/parallel';
import { logger } from '../../core/utils/logger';

/**
 * Helper to convert optional tokens to required format
 */
function normalizeTokens(tokens?: { input?: number; output?: number }): { input: number; output: number } | undefined {
  if (!tokens) return undefined;
  if (tokens.input === undefined && tokens.output === undefined) return undefined;
  return {
    input: tokens.input ?? 0,
    output: tokens.output ?? 0,
  };
}

/**
 * Configuration for APIAgentWrapper
 */
export interface APIAgentWrapperConfig {
  /** Emit agent lifecycle events */
  emitEvents?: boolean;
  /** Track metrics in BuildMetrics */
  trackMetrics?: boolean;
  /** Track parallel execution metrics */
  trackParallelMetrics?: boolean;
  /** Session context for session management */
  sessionContext?: SessionContext;
  /** Include session history in prompts */
  useSessionHistory?: boolean;
  /** Maximum history entries to include in context */
  maxHistoryInContext?: number;
}

/**
 * Result from agent execution with metadata
 */
export interface AgentResult {
  codeChanges: CodeChanges;
  durationMs: number;
  tokens?: {
    input?: number;
    output?: number;
  };
  sessionId?: string;
}

/**
 * Wraps API providers to provide background-agent-like interface
 * Enables consistent behavior across Cursor CLI and API providers
 */
export class APIAgentWrapper {
  private provider: AIProvider;
  private config: Required<APIAgentWrapperConfig>;

  constructor(
    provider: AIProvider,
    config: APIAgentWrapperConfig = {}
  ) {
    this.provider = provider;
    this.config = {
      emitEvents: config.emitEvents ?? true,
      trackMetrics: config.trackMetrics ?? true,
      trackParallelMetrics: config.trackParallelMetrics ?? true,
      sessionContext: config.sessionContext ?? { taskIds: [] },
      useSessionHistory: config.useSessionHistory ?? true,
      maxHistoryInContext: config.maxHistoryInContext ?? 3,
    };
  }

  /**
   * Execute code generation with agent-like behavior
   * - Emits progress events
   * - Tracks metrics (build and parallel)
   * - Manages session history
   */
  async generateCode(prompt: string, context: TaskContext): Promise<AgentResult> {
    const startTime = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const agentId = `agent-${requestId}`;
    const taskId = context.task.id;
    const prdId = context.prdId || 'unknown';
    const phaseId = context.phaseId ?? undefined;

    // Track agent in parallel metrics
    if (this.config.trackParallelMetrics) {
      try {
        const parallelMetrics = getParallelMetricsTracker();
        parallelMetrics.startAgent(agentId, taskId, prdId, phaseId, prompt.length);
      } catch {
        // Parallel metrics not available
      }
    }

    // Emit start event
    if (this.config.emitEvents) {
      emitEvent('build:ai_call_started', {
        requestId,
        provider: this.provider.name,
        taskId: context.task.id,
        taskTitle: context.task.title,
      });
    }

    try {
      // Get or create session for context continuity
      let session: Session | null = null;
      if (this.supportsSession() && this.config.sessionContext) {
        session = (this.provider as any).getOrCreateSession(this.config.sessionContext);
      }

      // Enrich context with session history if available
      const enrichedContext = session && this.config.useSessionHistory
        ? this.enrichContextWithHistory(context, session)
        : context;

      // Execute generation
      logger.info(`[APIAgentWrapper] Executing code generation with ${this.provider.name}`);
      const result = await this.provider.generateCode(prompt, enrichedContext);
      const durationMs = Date.now() - startTime;

      // Get token usage if available
      let tokens: { input?: number; output?: number } | undefined;
      if ('getLastTokens' in this.provider && typeof (this.provider as any).getLastTokens === 'function') {
        tokens = (this.provider as any).getLastTokens();
      }

      // Track parallel metrics completion
      if (this.config.trackParallelMetrics) {
        try {
          const parallelMetrics = getParallelMetricsTracker();
          parallelMetrics.completeAgent(agentId, 'completed', JSON.stringify(result).length);
        } catch {
          // Parallel metrics not available
        }
      }

      // Track build metrics
      if (this.config.trackMetrics) {
        try {
          const buildMetrics = getBuildMetrics();
          buildMetrics.recordAICall(
            `${this.provider.name}-generateCode`,
            true,
            durationMs,
            normalizeTokens(tokens)
          );
        } catch {
          // Build metrics not available
        }
      }

      // Add to session history
      if (session && 'addHistory' in this.provider) {
        const historyEntry = {
          requestId,
          prompt: prompt.substring(0, 500), // Truncate for storage
          response: { filesCount: result.files.length, summary: result.summary },
          timestamp: new Date().toISOString(),
          success: true,
          tokens,
          durationMs,
        };
        try {
          (this.provider as any).sessionManager?.addHistory(session.sessionId, historyEntry);
        } catch {
          // Session history not available
        }
      }

      // Emit completion event
      if (this.config.emitEvents) {
        emitEvent('build:ai_call_completed', {
          requestId,
          provider: this.provider.name,
          durationMs,
          filesCount: result.files.length,
          tokens,
        });
      }

      logger.info(`[APIAgentWrapper] Code generation completed in ${durationMs}ms with ${result.files.length} files`);

      return {
        codeChanges: result,
        durationMs,
        tokens,
        sessionId: session?.sessionId,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Track parallel metrics failure
      if (this.config.trackParallelMetrics) {
        try {
          const parallelMetrics = getParallelMetricsTracker();
          parallelMetrics.completeAgent(agentId, 'failed', 0);
        } catch {
          // Parallel metrics not available
        }
      }

      // Track failed call
      if (this.config.trackMetrics) {
        try {
          const buildMetrics = getBuildMetrics();
          buildMetrics.recordAICall(
            `${this.provider.name}-generateCode`,
            false,
            durationMs
          );
        } catch {
          // Build metrics not available
        }
      }

      // Emit error event
      if (this.config.emitEvents) {
        emitEvent('build:ai_call_failed', {
          requestId,
          provider: this.provider.name,
          error: errorMessage,
          durationMs,
        });
      }

      logger.error(`[APIAgentWrapper] Code generation failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Generate text with agent-like behavior
   */
  async generateText(
    prompt: string,
    options?: { maxTokens?: number; temperature?: number; systemPrompt?: string }
  ): Promise<string> {
    if (!('generateText' in this.provider) || typeof (this.provider as any).generateText !== 'function') {
      throw new Error(`Provider ${this.provider.name} does not support text generation`);
    }

    const startTime = Date.now();
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    if (this.config.emitEvents) {
      emitEvent('build:ai_call_started', {
        requestId,
        provider: this.provider.name,
        callType: 'text-generation',
      });
    }

    try {
      const result = await (this.provider as any).generateText(prompt, options);
      const durationMs = Date.now() - startTime;

      // Get token usage if available
      let tokens: { input?: number; output?: number } | undefined;
      if ('getLastTokens' in this.provider && typeof (this.provider as any).getLastTokens === 'function') {
        tokens = (this.provider as any).getLastTokens();
      }

      // Track metrics
      if (this.config.trackMetrics) {
        try {
          const buildMetrics = getBuildMetrics();
          buildMetrics.recordAICall(
            `${this.provider.name}-generateText`,
            true,
            durationMs,
            normalizeTokens(tokens)
          );
        } catch {
          // Build metrics not available
        }
      }

      if (this.config.emitEvents) {
        emitEvent('build:ai_call_completed', {
          requestId,
          provider: this.provider.name,
          callType: 'text-generation',
          durationMs,
          responseLength: result.length,
          tokens,
        });
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;

      if (this.config.trackMetrics) {
        try {
          const buildMetrics = getBuildMetrics();
          buildMetrics.recordAICall(
            `${this.provider.name}-generateText`,
            false,
            durationMs
          );
        } catch {
          // Build metrics not available
        }
      }

      if (this.config.emitEvents) {
        emitEvent('build:ai_call_failed', {
          requestId,
          provider: this.provider.name,
          callType: 'text-generation',
          error: error instanceof Error ? error.message : String(error),
          durationMs,
        });
      }

      throw error;
    }
  }

  /**
   * Check if provider supports sessions
   */
  private supportsSession(): boolean {
    return 'getOrCreateSession' in this.provider && 
           typeof (this.provider as any).getOrCreateSession === 'function';
  }

  /**
   * Enrich context with session history
   */
  private enrichContextWithHistory(context: TaskContext, session: Session): TaskContext {
    if (!session.history || session.history.length === 0) {
      return context;
    }

    // Get recent successful entries
    const recentHistory = session.history
      .filter(h => h.success)
      .slice(-this.config.maxHistoryInContext)
      .map(h => `Previous: ${h.prompt.substring(0, 100)}...`)
      .join('\n');

    if (!recentHistory) {
      return context;
    }

    return {
      ...context,
      codebaseContext: context.codebaseContext
        ? `${context.codebaseContext}\n\n## Recent Session History\n${recentHistory}`
        : `## Recent Session History\n${recentHistory}`,
    };
  }

  /**
   * Execute multiple code generation requests concurrently
   * Provides parallel execution similar to Cursor's background agents
   */
  async generateCodeConcurrent(
    requests: Array<{ prompt: string; context: TaskContext }>
  ): Promise<AgentResult[]> {
    logger.info(`[APIAgentWrapper] Executing ${requests.length} code generation requests concurrently`);
    
    return Promise.all(
      requests.map(r => this.generateCode(r.prompt, r.context))
    );
  }

  /**
   * Execute multiple text generation requests concurrently
   */
  async generateTextConcurrent(
    requests: Array<{ prompt: string; options?: { maxTokens?: number; temperature?: number; systemPrompt?: string } }>
  ): Promise<string[]> {
    logger.info(`[APIAgentWrapper] Executing ${requests.length} text generation requests concurrently`);
    
    return Promise.all(
      requests.map(r => this.generateText(r.prompt, r.options))
    );
  }

  /**
   * Get the underlying provider
   */
  getProvider(): AIProvider {
    return this.provider;
  }

  /**
   * Get provider name
   */
  get name(): string {
    return this.provider.name;
  }
}

/**
 * Create an APIAgentWrapper for a provider
 */
export function wrapProvider(
  provider: AIProvider,
  config?: APIAgentWrapperConfig
): APIAgentWrapper {
  return new APIAgentWrapper(provider, config);
}
