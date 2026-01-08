/**
 * Provider-Agnostic Session Manager Interface
 *
 * Defines a unified interface for session management across all AI providers.
 * Providers can implement this interface to maintain conversation history
 * and context across multiple AI interactions.
 */

export interface SessionContext {
  prdId?: string;
  phaseId?: number;
  prdSetId?: string;
  taskIds: string[];
}

export interface HistoryEntry {
  requestId: string;
  prompt: string;
  response?: any;
  timestamp: string;
  success?: boolean;
  error?: string;
}

export interface Session {
  sessionId: string;
  createdAt: string;
  lastUsed: string;
  context: SessionContext;
  history: HistoryEntry[];
}

/**
 * Provider-agnostic session manager interface
 *
 * All AI providers should implement this interface to support
 * session management and conversation history.
 */
export interface SessionManager {
  /**
   * Create a new session for a given context
   */
  createSession(context: SessionContext): Session;

  /**
   * Get or create a session for a given context
   */
  getOrCreateSession(context: SessionContext): Session;

  /**
   * Get session by ID
   */
  getSession(sessionId: string): Session | null;

  /**
   * Add history entry to a session
   */
  addHistory(sessionId: string, entry: HistoryEntry): void;

  /**
   * Prune session history to keep only recent entries
   */
  pruneHistory(sessionId: string, maxItems: number): void;

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean;

  /**
   * Clean up old sessions
   */
  cleanupOldSessions(maxAge?: number): number;
}

/**
 * Base implementation of SessionManager with common functionality
 * Providers can extend this to implement provider-specific behavior
 */
export abstract class BaseSessionManager implements SessionManager {
  protected sessions: Map<string, Session> = new Map();
  protected maxSessionAge: number = 3600000; // 1 hour default
  protected maxHistoryItems: number = 50;

  constructor(config?: {
    maxSessionAge?: number;
    maxHistoryItems?: number;
  }) {
    if (config?.maxSessionAge) {
      this.maxSessionAge = config.maxSessionAge;
    }
    if (config?.maxHistoryItems) {
      this.maxHistoryItems = config.maxHistoryItems;
    }
  }

  abstract createSession(context: SessionContext): Session;
  abstract getOrCreateSession(context: SessionContext): Session;
  abstract getSession(sessionId: string): Session | null;
  abstract addHistory(sessionId: string, entry: HistoryEntry): void;
  abstract pruneHistory(sessionId: string, maxItems: number): void;
  abstract deleteSession(sessionId: string): boolean;

  /**
   * Generate a session ID from context
   */
  protected generateSessionId(context: SessionContext): string {
    const parts: string[] = [];
    if (context.prdSetId) parts.push(`set-${context.prdSetId}`);
    if (context.prdId) parts.push(`prd-${context.prdId}`);
    if (context.phaseId !== undefined) parts.push(`phase-${context.phaseId}`);

    if (parts.length === 0) {
      return 'default-session';
    }

    return parts.join('-');
  }

  /**
   * Check if session is too old
   */
  protected isSessionTooOld(session: Session): boolean {
    const age = Date.now() - new Date(session.lastUsed).getTime();
    return age > this.maxSessionAge;
  }

  /**
   * Clean up old sessions
   */
  cleanupOldSessions(maxAge?: number): number {
    const age = maxAge || this.maxSessionAge;
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const sessionAge = now - new Date(session.lastUsed).getTime();
      if (sessionAge > age) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

