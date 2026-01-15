/**
 * Cursor Session Manager
 *
 * Manages session state and history for Cursor background agents to maintain
 * context window continuity between multiple invocations.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from "../../core/utils/logger";
import { SessionManager, SessionContext, HistoryEntry, Session, BaseSessionManager } from './session-manager';

export interface SessionHistoryEntry extends HistoryEntry {
  // Cursor-specific fields can be added here if needed
}

export interface CursorSession {
  sessionId: string;
  chatId?: string;  // Cursor chat ID if available
  createdAt: string;
  lastUsed: string;
  context: SessionContext;
  history: SessionHistoryEntry[];
  stats: {
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    jsonParsingErrors: number;
  };
}

export interface CursorSessionManagerConfig {
  sessionsPath?: string;
  maxSessionAge?: number;  // milliseconds
  maxHistoryItems?: number;
  enabled?: boolean;
}

/**
 * Manages Cursor background agent sessions for context persistence
 * Implements provider-agnostic SessionManager interface
 */
export class CursorSessionManager extends BaseSessionManager implements SessionManager {
  private config: Required<CursorSessionManagerConfig>;
  private sessionsPath: string;
  protected sessions: Map<string, CursorSession> = new Map();

  constructor(config: CursorSessionManagerConfig = {}) {
    super({
      maxSessionAge: config.maxSessionAge || 3600000,
      maxHistoryItems: config.maxHistoryItems || 50,
    });
    this.config = {
      sessionsPath: config.sessionsPath || '.devloop/execution-state.json', // Sessions now in execution-state.json
      maxSessionAge: config.maxSessionAge || 3600000, // 1 hour default
      maxHistoryItems: config.maxHistoryItems || 50,
      enabled: config.enabled !== false, // Default to true
    };
    this.sessionsPath = path.resolve(process.cwd(), this.config.sessionsPath);
    // Note: Sessions are now stored in execution-state.json.sessions
    // TODO: Update to use UnifiedStateManager for session management
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
          // Legacy array format
          for (const session of data.sessions) {
            // Validate session structure
            if (session.sessionId && session.context) {
              this.sessions.set(session.sessionId, session as CursorSession);
            }
          }
        } else if (data.sessions && typeof data.sessions === 'object') {
          // New record format (matches ExecutionState schema)
          for (const [sessionId, session] of Object.entries(data.sessions)) {
            if (typeof session === 'object' && session !== null) {
              const s = session as any;
              if (s.sessionId || sessionId) {
                this.sessions.set(s.sessionId || sessionId, s as CursorSession);
              }
            }
          }
        }

        logger.debug(`[CursorSessionManager] Loaded ${this.sessions.size} session(s) from ${this.sessionsPath}`);
      }
    } catch (error) {
      logger.warn(`[CursorSessionManager] Failed to load sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save sessions to disk
   */
  private saveSessions(): void {
    try {
      const dir = path.dirname(this.sessionsPath);
      fs.ensureDirSync(dir);

      // Convert Map to record (object) format to match ExecutionState schema
      const sessionsRecord: Record<string, any> = {};
      for (const [key, value] of this.sessions.entries()) {
        sessionsRecord[key] = value;
      }

      // Read existing execution state and merge sessions
      let existingData: any = {};
      try {
        if (fs.pathExistsSync(this.sessionsPath)) {
          existingData = fs.readJsonSync(this.sessionsPath);
        }
      } catch {
        // Ignore read errors, start fresh
      }

      const data = {
        ...existingData,  // Preserve other fields (active, prdStates, etc.)
        version: existingData.version || '1.0',
        updatedAt: new Date().toISOString(),
        sessions: sessionsRecord,  // Record format, not array
      };

      fs.writeFileSync(this.sessionsPath, JSON.stringify(data, null, 2), 'utf-8');
      logger.debug(`[CursorSessionManager] Saved ${this.sessions.size} session(s) to ${this.sessionsPath}`);
    } catch (error) {
      logger.error(`[CursorSessionManager] Failed to save sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create a new session for a given context
   */
  createSession(context: SessionContext): CursorSession {
    const sessionId = super.generateSessionId(context);

    const session: CursorSession = {
      sessionId,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      context: {
        prdId: context.prdId,
        phaseId: context.phaseId,
        prdSetId: context.prdSetId,
        taskIds: [...(context.taskIds || [])],
      },
      history: [],
      stats: {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        jsonParsingErrors: 0,
      },
    };

    this.sessions.set(sessionId, session);
    this.saveSessions();

    logger.info(`[CursorSessionManager] Created session ${sessionId} for PRD: ${context.prdId || 'default'}, Phase: ${context.phaseId || 'N/A'}`);

    return session;
  }

  /**
   * Get or create a session for a given context
   */
  getOrCreateSession(context: SessionContext): CursorSession {
    if (!this.config.enabled) {
      // Return a dummy session if disabled
      return this.createSession(context);
    }

    const sessionId = super.generateSessionId(context);
    let session: CursorSession | undefined = this.sessions.get(sessionId);

      // Check if session exists and is not too old
      if (session) {
        if (this.isSessionTooOld(session)) {
          logger.debug(`[CursorSessionManager] Session ${sessionId} is too old, creating new one`);
          this.sessions.delete(sessionId);
          session = undefined;
        } else {
        // Update last used time
        session.lastUsed = new Date().toISOString();
        // Merge task IDs
        if (context.taskIds && context.taskIds.length > 0) {
          const existingTaskIds = new Set(session.context.taskIds);
          context.taskIds.forEach(id => existingTaskIds.add(id));
          session.context.taskIds = Array.from(existingTaskIds);
        }
        this.saveSessions();
        return session;
      }
    }

    // Create new session if none exists
    if (!session) {
      session = this.createSession(context);
    }

    return session;
  }

  /**
   * Resume an existing session by ID
   */
  resumeSession(sessionId: string): CursorSession | null {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastUsed = new Date().toISOString();
      this.saveSessions();
      logger.debug(`[CursorSessionManager] Resumed session ${sessionId}`);
      return session;
    }
    logger.debug(`[CursorSessionManager] Session ${sessionId} not found (will create new session)`);
    return null;
  }

  /**
   * Add an entry to session history (implements SessionManager interface)
   */
  addHistory(sessionId: string, entry: HistoryEntry): void {
    this.addToHistory(sessionId, entry.requestId, entry.prompt, entry.response, entry.success, entry.error);
  }

  /**
   * Add an entry to session history (Cursor-specific method)
   */
  addToHistory(sessionId: string, requestId: string, prompt: string, response?: any, success?: boolean, error?: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`[CursorSessionManager] Cannot add history to non-existent session ${sessionId}`);
      return;
    }

    const entry: SessionHistoryEntry = {
      requestId,
      prompt,
      response,
      timestamp: new Date().toISOString(),
      success,
      error,
    };

    session.history.push(entry);
    session.lastUsed = new Date().toISOString();
    session.stats.totalCalls++;

    if (success) {
      session.stats.successfulCalls++;
    } else {
      session.stats.failedCalls++;
      if (error && (error.includes('control character') || error.includes('JSON') || error.includes('parse'))) {
        session.stats.jsonParsingErrors++;
      }
    }

    // Intelligent history pruning
    this.pruneHistory(sessionId, this.config.maxHistoryItems);

    this.saveSessions();
    logger.debug(`[CursorSessionManager] Added history entry to session ${sessionId} (${session.history.length} entries)`);
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): CursorSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): CursorSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions for a specific context
   */
  getSessionsForContext(context: Partial<SessionContext>): CursorSession[] {
    return Array.from(this.sessions.values()).filter(session => {
      if (context.prdId && session.context.prdId !== context.prdId) return false;
      if (context.phaseId !== undefined && session.context.phaseId !== context.phaseId) return false;
      if (context.prdSetId && session.context.prdSetId !== context.prdSetId) return false;
      return true;
    });
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
      logger.info(`[CursorSessionManager] Cleaned up ${cleaned} old session(s)`);
    }

    return cleaned;
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      this.saveSessions();
      logger.debug(`[CursorSessionManager] Deleted session ${sessionId}`);
    }
    return deleted;
  }


  /**
   * Build prompt with conversation history for context
   */
  buildPromptWithHistory(session: CursorSession, currentPrompt: string): string {
    if (!this.config.enabled || session.history.length === 0) {
      return currentPrompt;
    }

    const lines: string[] = [];
    lines.push('Previous conversation context:');
    lines.push('');

    // Include recent history (last 5 entries to avoid token limits)
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

    lines.push('---');
    lines.push('');
    lines.push('Current request:');
    lines.push(currentPrompt);

    return lines.join('\n');
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): CursorSession['stats'] | null {
    const session = this.sessions.get(sessionId);
    return session ? session.stats : null;
  }

  /**
   * Get all session statistics
   */
  getAllStats(): { [sessionId: string]: CursorSession['stats'] } {
    const stats: { [sessionId: string]: CursorSession['stats'] } = {};
    for (const [sessionId, session] of this.sessions.entries()) {
      stats[sessionId] = session.stats;
    }
    return stats;
  }

  /**
   * Prune session history intelligently
   *
   * Strategy:
   * - Keep the most recent entries (configurable, default 10)
   * - Optionally summarize older entries instead of discarding them
   * - Remove oldest entries when limit exceeded
   */
  pruneHistory(sessionId: string, maxItems?: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const limit = maxItems || this.config.maxHistoryItems;
    const originalLength = session.history.length;

    if (originalLength <= limit) {
      return; // No pruning needed
    }

    // Keep most recent entries
    const recentEntries = session.history.slice(-limit);

    // Optionally summarize older entries (if enabled in config)
    const summarizeOldHistory = (this.config as any).summarizeOldHistory !== false;
    if (summarizeOldHistory && originalLength > limit) {
      const oldEntries = session.history.slice(0, -limit);
      if (oldEntries.length > 0) {
        // Create a summary entry for old history
        const summaryEntry: SessionHistoryEntry = {
          requestId: `summary-${Date.now()}`,
          prompt: `[Summary of ${oldEntries.length} previous interactions]`,
          timestamp: new Date().toISOString(),
          success: true,
          response: {
            summary: `Previous ${oldEntries.length} interactions completed. Key outcomes: ${oldEntries.filter(e => e.success).length} successful, ${oldEntries.filter(e => !e.success).length} failed.`,
            totalFiles: oldEntries.reduce((sum, e) => sum + (e.response?.files?.length || 0), 0),
          },
        };
        // Keep summary + recent entries (if we have room)
        if (recentEntries.length < limit) {
          session.history = [summaryEntry, ...recentEntries];
        } else {
          // Replace oldest recent entry with summary if we're at limit
          session.history = [summaryEntry, ...recentEntries.slice(1)];
        }
      } else {
        session.history = recentEntries;
      }
    } else {
      // Simple pruning: just keep recent entries
      session.history = recentEntries;
    }

    this.saveSessions();
    logger.debug(`[CursorSessionManager] Pruned history for session ${sessionId}: ${originalLength} -> ${session.history.length} entries`);
  }
}

