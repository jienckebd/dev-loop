/**
 * Generic Session Manager
 *
 * Provider-agnostic session manager for API-based AI providers.
 * Works with Anthropic, OpenAI, Gemini, Ollama, and any other API provider.
 * Implements the SessionManager interface for consistent behavior across all providers.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../core/utils/logger';
import { SessionManager, SessionContext, HistoryEntry, Session, BaseSessionManager } from './session-manager';

/**
 * Extended history entry with provider-specific fields
 */
export interface GenericHistoryEntry extends HistoryEntry {
  tokens?: {
    input?: number;
    output?: number;
  };
  model?: string;
  durationMs?: number;
}

/**
 * Extended session with provider-specific stats
 */
export interface GenericSession extends Session {
  providerName: string;
  stats: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    averageDurationMs: number;
  };
}

/**
 * Configuration for GenericSessionManager
 */
export interface GenericSessionManagerConfig {
  providerName: string;
  sessionsPath?: string;
  maxSessionAge?: number;
  maxHistoryItems?: number;
  enabled?: boolean;
  summarizeOldHistory?: boolean;
}

/**
 * Generic Session Manager for API-based providers
 * Works with Anthropic, OpenAI, Gemini, Ollama
 */
export class GenericSessionManager extends BaseSessionManager implements SessionManager {
  private config: Required<GenericSessionManagerConfig>;
  private sessionsPath: string;
  private providerName: string;
  protected sessions: Map<string, GenericSession> = new Map();

  constructor(config: GenericSessionManagerConfig) {
    super({
      maxSessionAge: config.maxSessionAge || 3600000,
      maxHistoryItems: config.maxHistoryItems || 50,
    });
    
    this.providerName = config.providerName;
    this.config = {
      providerName: config.providerName,
      sessionsPath: config.sessionsPath || `.devloop/sessions-${config.providerName}.json`,
      maxSessionAge: config.maxSessionAge || 3600000,
      maxHistoryItems: config.maxHistoryItems || 50,
      enabled: config.enabled !== false,
      summarizeOldHistory: config.summarizeOldHistory !== false,
    };
    
    this.sessionsPath = path.resolve(process.cwd(), this.config.sessionsPath);
    this.loadSessions();
  }

  /**
   * Load sessions from disk
   */
  private loadSessions(): void {
    try {
      if (fs.existsSync(this.sessionsPath)) {
        const content = fs.readFileSync(this.sessionsPath, 'utf-8');
        const data = JSON.parse(content);

        if (Array.isArray(data.sessions)) {
          for (const session of data.sessions) {
            if (session.sessionId && session.context) {
              this.sessions.set(session.sessionId, session as GenericSession);
            }
          }
        }

        logger.debug(`[GenericSessionManager:${this.providerName}] Loaded ${this.sessions.size} session(s) from ${this.sessionsPath}`);
      }
    } catch (error) {
      logger.warn(`[GenericSessionManager:${this.providerName}] Failed to load sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save sessions to disk
   */
  private saveSessions(): void {
    try {
      const dir = path.dirname(this.sessionsPath);
      fs.ensureDirSync(dir);

      const data = {
        version: '1.0',
        provider: this.providerName,
        updatedAt: new Date().toISOString(),
        sessions: Array.from(this.sessions.values()),
      };

      fs.writeFileSync(this.sessionsPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug(`[GenericSessionManager:${this.providerName}] Saved ${this.sessions.size} session(s) to ${this.sessionsPath}`);
    } catch (error) {
      logger.error(`[GenericSessionManager:${this.providerName}] Failed to save sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a new session for a given context
   */
  createSession(context: SessionContext): GenericSession {
    const sessionId = this.generateSessionId(context);

    const session: GenericSession = {
      sessionId,
      providerName: this.providerName,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      context: {
        prdId: context.prdId,
        phaseId: context.phaseId,
        prdSetId: context.prdSetId,
        taskIds: [...(context.taskIds || [])],
        targetModule: context.targetModule,
      },
      history: [],
      stats: {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        averageDurationMs: 0,
      },
    };

    this.sessions.set(sessionId, session);
    this.saveSessions();

    logger.info(`[GenericSessionManager:${this.providerName}] Created session ${sessionId} for PRD: ${context.prdId || 'default'}, Phase: ${context.phaseId || 'N/A'}`);

    return session;
  }

  /**
   * Get or create a session for a given context
   */
  getOrCreateSession(context: SessionContext): GenericSession {
    if (!this.config.enabled) {
      return this.createSession(context);
    }

    const sessionId = this.generateSessionId(context);
    let session = this.sessions.get(sessionId);

    if (session) {
      if (this.isSessionTooOld(session)) {
        logger.debug(`[GenericSessionManager:${this.providerName}] Session ${sessionId} is too old, creating new one`);
        this.sessions.delete(sessionId);
        session = undefined;
      } else {
        session.lastUsed = new Date().toISOString();
        if (context.taskIds && context.taskIds.length > 0) {
          const existingTaskIds = new Set(session.context.taskIds);
          context.taskIds.forEach(id => existingTaskIds.add(id));
          session.context.taskIds = Array.from(existingTaskIds);
        }
        this.saveSessions();
        return session;
      }
    }

    if (!session) {
      session = this.createSession(context);
    }

    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): GenericSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Add an entry to session history
   */
  addHistory(sessionId: string, entry: HistoryEntry): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`[GenericSessionManager:${this.providerName}] Cannot add history to non-existent session ${sessionId}`);
      return;
    }

    const genericEntry: GenericHistoryEntry = {
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    };

    session.history.push(genericEntry);
    session.lastUsed = new Date().toISOString();
    session.stats.totalCalls++;

    if (entry.success) {
      session.stats.successfulCalls++;
    } else {
      session.stats.failedCalls++;
    }

    // Track tokens if available
    if ((entry as GenericHistoryEntry).tokens) {
      const tokens = (entry as GenericHistoryEntry).tokens!;
      session.stats.totalInputTokens += tokens.input || 0;
      session.stats.totalOutputTokens += tokens.output || 0;
    }

    // Track duration for average calculation
    if ((entry as GenericHistoryEntry).durationMs) {
      const totalDuration = session.stats.averageDurationMs * (session.stats.totalCalls - 1) + (entry as GenericHistoryEntry).durationMs!;
      session.stats.averageDurationMs = totalDuration / session.stats.totalCalls;
    }

    this.pruneHistory(sessionId, this.config.maxHistoryItems);
    this.saveSessions();

    logger.debug(`[GenericSessionManager:${this.providerName}] Added history entry to session ${sessionId} (${session.history.length} entries)`);
  }

  /**
   * Add history entry with extended fields (convenience method)
   */
  addHistoryEntry(
    sessionId: string,
    requestId: string,
    prompt: string,
    response?: any,
    success?: boolean,
    error?: string,
    tokens?: { input?: number; output?: number },
    durationMs?: number,
    model?: string
  ): void {
    const entry: GenericHistoryEntry = {
      requestId,
      prompt,
      response,
      timestamp: new Date().toISOString(),
      success,
      error,
      tokens,
      durationMs,
      model,
    };
    this.addHistory(sessionId, entry);
  }

  /**
   * Prune session history
   */
  pruneHistory(sessionId: string, maxItems?: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const limit = maxItems || this.config.maxHistoryItems;
    const originalLength = session.history.length;

    if (originalLength <= limit) {
      return;
    }

    const recentEntries = session.history.slice(-limit);

    if (this.config.summarizeOldHistory && originalLength > limit) {
      const oldEntries = session.history.slice(0, -limit);
      if (oldEntries.length > 0) {
        const summaryEntry: GenericHistoryEntry = {
          requestId: `summary-${Date.now()}`,
          prompt: `[Summary of ${oldEntries.length} previous interactions]`,
          timestamp: new Date().toISOString(),
          success: true,
          response: {
            summary: `Previous ${oldEntries.length} interactions: ${oldEntries.filter(e => e.success).length} successful, ${oldEntries.filter(e => !e.success).length} failed.`,
          },
        };

        if (recentEntries.length < limit) {
          session.history = [summaryEntry, ...recentEntries];
        } else {
          session.history = [summaryEntry, ...recentEntries.slice(1)];
        }
      } else {
        session.history = recentEntries;
      }
    } else {
      session.history = recentEntries;
    }

    this.saveSessions();
    logger.debug(`[GenericSessionManager:${this.providerName}] Pruned history for session ${sessionId}: ${originalLength} -> ${session.history.length} entries`);
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.saveSessions();
      logger.debug(`[GenericSessionManager:${this.providerName}] Deleted session ${sessionId}`);
    }
    return deleted;
  }

  /**
   * Clean up old sessions
   */
  cleanupOldSessions(maxAge?: number): number {
    const age = maxAge || this.config.maxSessionAge;
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const sessionAge = now - new Date(session.lastUsed).getTime();
      if (sessionAge > age) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.saveSessions();
      logger.info(`[GenericSessionManager:${this.providerName}] Cleaned up ${cleaned} old session(s)`);
    }

    return cleaned;
  }

  /**
   * Build prompt with conversation history for context
   */
  buildPromptWithHistory(session: GenericSession, currentPrompt: string): string {
    if (!this.config.enabled || session.history.length === 0) {
      return currentPrompt;
    }

    const lines: string[] = [];
    lines.push('Previous conversation context:');
    lines.push('');

    const recentHistory = session.history.slice(-5);
    for (const entry of recentHistory) {
      lines.push(`[Previous Request ${entry.requestId.substring(0, 8)}]`);
      lines.push(`Prompt: ${entry.prompt.substring(0, 200)}${entry.prompt.length > 200 ? '...' : ''}`);
      if (entry.success && entry.response) {
        lines.push(`Response: Success`);
      } else if (entry.error) {
        lines.push(`Response: Error - ${entry.error.substring(0, 100)}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('Current request:');
    lines.push(currentPrompt);

    return lines.join('\n');
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): GenericSession['stats'] | null {
    const session = this.sessions.get(sessionId);
    return session ? session.stats : null;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): GenericSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions for a specific context
   */
  getSessionsForContext(context: Partial<SessionContext>): GenericSession[] {
    return Array.from(this.sessions.values()).filter(session => {
      if (context.prdId && session.context.prdId !== context.prdId) return false;
      if (context.phaseId !== undefined && session.context.phaseId !== context.phaseId) return false;
      if (context.prdSetId && session.context.prdSetId !== context.prdSetId) return false;
      if (context.targetModule && session.context.targetModule !== context.targetModule) return false;
      return true;
    });
  }
}
