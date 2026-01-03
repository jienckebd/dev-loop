import * as fs from 'fs-extra';
import * as path from 'path';
import { AbstractionRecommendation } from '../frameworks/interface';

export interface FeedbackEntry {
  id: string;
  timestamp: number;
  recommendation: AbstractionRecommendation;
  feedback: 'accepted' | 'rejected' | 'modified';
  userNotes?: string;
  actualImplementation?: string; // What the user actually did
}

export interface FeedbackStoreData {
  version: string;
  entries: FeedbackEntry[];
}

export class FeedbackStore {
  private data: FeedbackStoreData;
  private storePath: string;
  private projectRoot: string;

  constructor(projectRoot: string, feedbackFile?: string) {
    this.projectRoot = projectRoot;
    this.storePath = feedbackFile || path.join(projectRoot, '.devloop', 'ai-feedback.json');
    this.data = {
      version: '1.0',
      entries: [],
    };
  }

  /**
   * Load feedback from disk
   */
  async load(): Promise<void> {
    try {
      if (await fs.pathExists(this.storePath)) {
        const loaded = await fs.readJson(this.storePath);
        this.data = loaded;
      }
    } catch (error: any) {
      console.warn(`Failed to load feedback store: ${error.message}`);
      this.data = {
        version: '1.0',
        entries: [],
      };
    }
  }

  /**
   * Save feedback to disk
   */
  async save(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.storePath));
      await fs.writeJson(this.storePath, this.data, { spaces: 2 });
    } catch (error: any) {
      throw new Error(`Failed to save feedback store: ${error.message}`);
    }
  }

  /**
   * Record feedback on a recommendation
   */
  async recordFeedback(entry: FeedbackEntry): Promise<void> {
    // Check if entry with same ID exists and update, otherwise add
    const existingIndex = this.data.entries.findIndex(e => e.id === entry.id);
    if (existingIndex >= 0) {
      this.data.entries[existingIndex] = entry;
    } else {
      this.data.entries.push(entry);
    }

    await this.save();
  }

  /**
   * Get all accepted patterns
   */
  getAcceptedPatterns(): FeedbackEntry[] {
    return this.data.entries.filter(e => e.feedback === 'accepted');
  }

  /**
   * Get all rejected patterns
   */
  getRejectedPatterns(): FeedbackEntry[] {
    return this.data.entries.filter(e => e.feedback === 'rejected');
  }

  /**
   * Get all modified patterns
   */
  getModifiedPatterns(): FeedbackEntry[] {
    return this.data.entries.filter(e => e.feedback === 'modified');
  }

  /**
   * Generate learning context for LLM
   */
  generateLearningContext(): string {
    const accepted = this.getAcceptedPatterns();
    const rejected = this.getRejectedPatterns();
    const modified = this.getModifiedPatterns();

    if (accepted.length === 0 && rejected.length === 0 && modified.length === 0) {
      return '';
    }

    let context = 'Learning from previous feedback:\n\n';

    if (accepted.length > 0) {
      context += `Accepted patterns (${accepted.length}):\n`;
      accepted.slice(0, 5).forEach(entry => {
        context += `- ${entry.recommendation.suggestion}: ${entry.recommendation.pattern?.suggestedAbstraction || 'abstraction'}\n`;
        if (entry.userNotes) {
          context += `  Note: ${entry.userNotes}\n`;
        }
      });
      context += '\n';
    }

    if (rejected.length > 0) {
      context += `Rejected patterns (${rejected.length}):\n`;
      rejected.slice(0, 5).forEach(entry => {
        context += `- ${entry.recommendation.suggestion}: ${entry.recommendation.pattern?.suggestedAbstraction || 'abstraction'}\n`;
        if (entry.userNotes) {
          context += `  Reason: ${entry.userNotes}\n`;
        }
      });
      context += '\n';
    }

    if (modified.length > 0) {
      context += `Modified patterns (${modified.length}):\n`;
      modified.slice(0, 5).forEach(entry => {
        context += `- ${entry.recommendation.suggestion}: ${entry.recommendation.pattern?.suggestedAbstraction || 'abstraction'}\n`;
        if (entry.actualImplementation) {
          context += `  Actual: ${entry.actualImplementation.substring(0, 100)}...\n`;
        }
      });
    }

    return context;
  }

  /**
   * Get feedback for a specific recommendation ID
   */
  getFeedback(id: string): FeedbackEntry | undefined {
    return this.data.entries.find(e => e.id === id);
  }

  /**
   * Clear all feedback
   */
  clear(): void {
    this.data.entries = [];
  }

  /**
   * Get statistics
   */
  getStats(): { total: number; accepted: number; rejected: number; modified: number } {
    return {
      total: this.data.entries.length,
      accepted: this.getAcceptedPatterns().length,
      rejected: this.getRejectedPatterns().length,
      modified: this.getModifiedPatterns().length,
    };
  }
}
