/**
 * Conversation Manager
 *
 * Manages multi-turn conversations during PRD building.
 * Independent of Cursor - uses dev-loop's own conversation system.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  Conversation,
  ConversationMetadata,
  ConversationContext,
  ConversationItem,
  ConversationState,
  BuildMode,
  Question,
  Answer,
  SummarizedContext,
} from './types';
import { logger } from '../utils/logger';

export interface ConversationManagerConfig {
  conversationsPath?: string;
  maxHistoryItems?: number; // Maximum items to keep in full context
  enabled?: boolean;
  debug?: boolean;
}

/**
 * Manages conversations for PRD building
 */
export class ConversationManager {
  private config: Required<ConversationManagerConfig>;
  private conversationsPath: string;
  private conversations: Map<string, Conversation> = new Map();

  constructor(config: ConversationManagerConfig = {}) {
    this.config = {
      conversationsPath: config.conversationsPath || '.devloop/conversations',
      maxHistoryItems: config.maxHistoryItems || 50,
      enabled: config.enabled !== false, // Default to true
      debug: config.debug || false,
    };
    this.conversationsPath = path.resolve(process.cwd(), this.config.conversationsPath);
    this.loadConversations();
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    mode: BuildMode,
    initialContext?: Partial<ConversationContext>
  ): Promise<string> {
    const conversationId = `conv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    const conversation: Conversation = {
      metadata: {
        id: conversationId,
        mode,
        createdAt: now,
        updatedAt: now,
        state: 'questioning',
        totalQuestions: 0,
        totalAnswers: 0,
        currentIteration: 0,
      },
      context: {
        mode,
        initialPrompt: initialContext?.initialPrompt,
        collectedAnswers: new Map(),
        generatedQuestions: [],
        currentIteration: 0,
        featureTypes: initialContext?.featureTypes,
        framework: initialContext?.framework,
        codebaseContext: initialContext?.codebaseContext,
      },
      items: [],
    };

    this.conversations.set(conversationId, conversation);
    await this.saveConversation(conversation);

    logger.debug(`[ConversationManager] Created conversation: ${conversationId} (mode: ${mode})`);
    return conversationId;
  }

  /**
   * Add a question-answer pair to a conversation
   */
  async addQuestionAnswer(
    conversationId: string,
    question: Question,
    answer?: Answer
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const now = new Date().toISOString();
    const item: ConversationItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      question,
      answer,
      timestamp: now,
      iteration: conversation.metadata.currentIteration,
    };

    conversation.items.push(item);
    conversation.metadata.totalQuestions++;
    conversation.metadata.updatedAt = now;

    if (answer) {
      conversation.metadata.totalAnswers++;
      conversation.context.collectedAnswers.set(question.id, answer);
    }

    conversation.context.generatedQuestions.push(question);
    this.conversations.set(conversationId, conversation);
    await this.saveConversation(conversation);

    logger.debug(
      `[ConversationManager] Added Q&A to conversation ${conversationId}: question=${question.id}, answered=${!!answer}`
    );
  }

  /**
   * Update conversation state
   */
  async updateState(conversationId: string, state: ConversationState): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    conversation.metadata.state = state;
    conversation.metadata.updatedAt = new Date().toISOString();
    this.conversations.set(conversationId, conversation);
    await this.saveConversation(conversation);

    logger.debug(`[ConversationManager] Updated conversation ${conversationId} state to: ${state}`);
  }

  /**
   * Update conversation iteration
   */
  async updateIteration(conversationId: string, iteration: number): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    conversation.metadata.currentIteration = iteration;
    conversation.context.currentIteration = iteration;
    conversation.metadata.updatedAt = new Date().toISOString();
    this.conversations.set(conversationId, conversation);
    await this.saveConversation(conversation);
  }

  /**
   * Update conversation context
   */
  async updateContext(
    conversationId: string,
    updates: Partial<ConversationContext>
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    Object.assign(conversation.context, updates);
    conversation.metadata.updatedAt = new Date().toISOString();
    this.conversations.set(conversationId, conversation);
    await this.saveConversation(conversation);
  }

  /**
   * Get conversation context
   */
  async getConversationContext(conversationId: string): Promise<ConversationContext> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    return conversation.context;
  }

  /**
   * Get full conversation
   */
  async getConversation(conversationId: string): Promise<Conversation | null> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      // Try loading from disk
      await this.loadConversation(conversationId);
      return this.conversations.get(conversationId) || null;
    }
    return conversation;
  }

  /**
   * Summarize old conversation history to stay within context window
   */
  async summarizeHistory(
    conversationId: string,
    maxRecentItems: number = 10
  ): Promise<SummarizedContext> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }

    const items = conversation.items;
    if (items.length <= maxRecentItems) {
      // No need to summarize
      return {
        recent: items,
        summarized: '',
        summaryTimestamp: new Date().toISOString(),
      };
    }

    // Split recent and old items
    const recent = items.slice(-maxRecentItems);
    const old = items.slice(0, -maxRecentItems);

    // Generate summary of old items
    const summary = this.generateSummary(old);

    return {
      recent,
      summarized: summary,
      summaryTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate summary of conversation items (simple text summary)
   * In a full implementation, this could use AI to generate better summaries
   */
  private generateSummary(items: ConversationItem[]): string {
    if (items.length === 0) {
      return '';
    }

    const questions = items.map(item => `Q: ${item.question.text}`).join('\n');
    const answers = items
      .filter(item => item.answer)
      .map(item => `A: ${item.answer?.value}`)
      .join('\n');

    return `Previous conversation (${items.length} items):\n${questions}\n${answers}`;
  }

  /**
   * Load conversation from disk
   */
  private async loadConversation(conversationId: string): Promise<void> {
    const filePath = path.join(this.conversationsPath, `${conversationId}.json`);
    if (!(await fs.pathExists(filePath))) {
      return;
    }

    try {
      const data = await fs.readJson(filePath);
      // Reconstruct Map from plain object
      if (data.context && data.context.collectedAnswers) {
        data.context.collectedAnswers = new Map(
          Object.entries(data.context.collectedAnswers)
        );
      }
      this.conversations.set(conversationId, data as Conversation);
      logger.debug(`[ConversationManager] Loaded conversation from disk: ${conversationId}`);
    } catch (error) {
      logger.warn(
        `[ConversationManager] Failed to load conversation ${conversationId}: ${error}`
      );
    }
  }

  /**
   * Save conversation to disk
   */
  private async saveConversation(conversation: Conversation): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    await fs.ensureDir(this.conversationsPath);

    const filePath = path.join(this.conversationsPath, `${conversation.metadata.id}.json`);
    // Convert Map to plain object for JSON serialization
    const data = {
      ...conversation,
      context: {
        ...conversation.context,
        collectedAnswers: Object.fromEntries(conversation.context.collectedAnswers),
      },
    };

    await fs.writeJson(filePath, data, { spaces: 2 });
  }

  /**
   * Load all conversations from disk
   */
  private loadConversations(): void {
    if (!fs.existsSync(this.conversationsPath)) {
      return;
    }

    try {
      const files = fs.readdirSync(this.conversationsPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const conversationId = file.replace('.json', '');
          this.loadConversation(conversationId);
        }
      }
      logger.debug(
        `[ConversationManager] Loaded ${this.conversations.size} conversation(s) from disk`
      );
    } catch (error) {
      logger.warn(`[ConversationManager] Failed to load conversations: ${error}`);
    }
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
    const filePath = path.join(this.conversationsPath, `${conversationId}.json`);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
    logger.debug(`[ConversationManager] Deleted conversation: ${conversationId}`);
  }

  /**
   * List all conversations
   */
  async listConversations(): Promise<ConversationMetadata[]> {
    return Array.from(this.conversations.values()).map(conv => conv.metadata);
  }
}
