/**
 * Answer Processor
 *
 * Processes user answers and updates context.
 * Handles answer validation, conditional logic, and context updates.
 */

import { Question, Answer, ConversationContext } from '../../conversation/types';
import { ConversationManager } from '../../conversation/conversation-manager';
import { logger } from '../../utils/logger';

/**
 * Answer Processing Result
 */
export interface AnswerProcessingResult {
  success: boolean;
  updatedContext: ConversationContext;
  followUpQuestions?: Question[];
  errors?: string[];
}

/**
 * Answer Processor Configuration
 */
export interface AnswerProcessorConfig {
  conversationManager: ConversationManager;
  validateAnswers?: boolean;
  debug?: boolean;
}

/**
 * Processes user answers and updates context
 */
export class AnswerProcessor {
  private config: Required<AnswerProcessorConfig>;
  private debug: boolean;

  constructor(config: AnswerProcessorConfig) {
    this.config = {
      conversationManager: config.conversationManager,
      validateAnswers: config.validateAnswers !== false, // Default to true
      debug: config.debug || false,
    };
    this.debug = this.config.debug;
  }

  /**
   * Process an answer to a question
   */
  async processAnswer(
    conversationId: string,
    question: Question,
    answer: string | string[] | boolean
  ): Promise<AnswerProcessingResult> {
    logger.debug(`[AnswerProcessor] Processing answer for question ${question.id}`);

    const errors: string[] = [];

    // Validate answer
    if (this.config.validateAnswers) {
      const validation = this.validateAnswer(question, answer);
      if (!validation.valid) {
        errors.push(...validation.errors);
        return {
          success: false,
          updatedContext: await this.config.conversationManager.getConversationContext(conversationId),
          errors,
        };
      }
    }

    // Create answer object
    const answerObj: Answer = {
      questionId: question.id,
      value: answer,
      timestamp: new Date().toISOString(),
      skipped: false,
    };

    // Add answer to conversation
    await this.config.conversationManager.addQuestionAnswer(conversationId, question, answerObj);

    // Update conversation context
    const context = await this.config.conversationManager.getConversationContext(conversationId);

    // Check for conditional follow-up questions
    const followUpQuestions = this.getFollowUpQuestions(question, answer);

    logger.debug(
      `[AnswerProcessor] Processed answer for question ${question.id}, generated ${followUpQuestions.length} follow-up question(s)`
    );

    return {
      success: true,
      updatedContext: context,
      followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Process multiple answers at once
   */
  async processAnswers(
    conversationId: string,
    questions: Question[],
    answers: Map<string, string | string[] | boolean>
  ): Promise<AnswerProcessingResult> {
    logger.debug(`[AnswerProcessor] Processing ${answers.size} answer(s)`);

    const errors: string[] = [];
    const followUpQuestions: Question[] = [];

    for (const question of questions) {
      const answer = answers.get(question.id);
      if (answer !== undefined) {
        const result = await this.processAnswer(conversationId, question, answer);
        if (!result.success && result.errors) {
          errors.push(...result.errors);
        }
        if (result.followUpQuestions) {
          followUpQuestions.push(...result.followUpQuestions);
        }
      } else if (question.required) {
        errors.push(`Required question ${question.id} was not answered`);
      }
    }

    const context = await this.config.conversationManager.getConversationContext(conversationId);

    return {
      success: errors.length === 0,
      updatedContext: context,
      followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : undefined,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Validate answer
   */
  private validateAnswer(
    question: Question,
    answer: string | string[] | boolean
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required
    if (question.required && (answer === undefined || answer === null || answer === '')) {
      errors.push(`Question "${question.text}" is required but was not answered`);
      return { valid: false, errors };
    }

    // Type-specific validation
    switch (question.type) {
      case 'multiple-choice':
        if (typeof answer !== 'string') {
          errors.push(`Question "${question.text}" expects a single choice, got ${typeof answer}`);
        } else if (question.options && !question.options.includes(answer)) {
          errors.push(`Answer "${answer}" is not a valid option for question "${question.text}"`);
        }
        break;

      case 'multi-select':
        if (!Array.isArray(answer)) {
          errors.push(`Question "${question.text}" expects multiple selections, got ${typeof answer}`);
        } else if (question.options) {
          const invalidOptions = answer.filter(a => !question.options!.includes(a as string));
          if (invalidOptions.length > 0) {
            errors.push(
              `Invalid options for question "${question.text}": ${invalidOptions.join(', ')}`
            );
          }
        }
        break;

      case 'confirm':
        if (typeof answer !== 'boolean') {
          errors.push(`Question "${question.text}" expects a boolean (true/false), got ${typeof answer}`);
        }
        break;

      case 'open-ended':
        if (typeof answer !== 'string') {
          errors.push(`Question "${question.text}" expects a text answer, got ${typeof answer}`);
        } else if (question.required && answer.trim().length === 0) {
          errors.push(`Question "${question.text}" requires a non-empty answer`);
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get follow-up questions based on answer
   */
  private getFollowUpQuestions(
    question: Question,
    answer: string | string[] | boolean
  ): Question[] {
    const followUpQuestions: Question[] = [];

    // Check for explicit follow-up questions
    if (question.followUp && question.followUp.length > 0) {
      followUpQuestions.push(...question.followUp);
    }

    // Check for conditional logic
    if (question.conditionalLogic) {
      // Handle ifAnswerEquals
      if (question.conditionalLogic.ifAnswerEquals) {
        const answerStr = String(answer);
        for (const [key, questions] of Object.entries(question.conditionalLogic.ifAnswerEquals)) {
          if (answerStr === key || (Array.isArray(answer) && answer.includes(key))) {
            followUpQuestions.push(...questions);
          }
        }
      }

      // Handle ifAnswerContains
      if (question.conditionalLogic.ifAnswerContains) {
        const answerStr = String(answer).toLowerCase();
        for (const [key, questions] of Object.entries(question.conditionalLogic.ifAnswerContains)) {
          if (answerStr.includes(key.toLowerCase())) {
            followUpQuestions.push(...questions);
          }
        }
      }

      // Handle ifAnswerIsNumeric
      if (question.conditionalLogic.ifAnswerIsNumeric) {
        const numValue = typeof answer === 'string' ? parseFloat(answer) : typeof answer === 'number' ? answer : null;
        if (numValue !== null && !isNaN(numValue)) {
          const logic = question.conditionalLogic.ifAnswerIsNumeric;
          const inRange = (!logic.min || numValue >= logic.min) && (!logic.max || numValue <= logic.max);
          if (inRange) {
            followUpQuestions.push(...logic.then);
          }
        }
      }
    }

    return followUpQuestions;
  }

  /**
   * Extract answers from conversation context
   */
  async extractAnswers(conversationId: string): Promise<Map<string, string | string[] | boolean>> {
    const context = await this.config.conversationManager.getConversationContext(conversationId);
    // Convert Map<string, Answer> to Map<string, string | string[] | boolean>
    const answers = new Map<string, string | string[] | boolean>();
    for (const [questionId, answer] of context.collectedAnswers.entries()) {
      answers.set(questionId, answer.value);
    }
    return answers;
  }

  /**
   * Check if sufficient answers collected to generate PRD draft
   */
  async hasSufficientAnswers(conversationId: string, requiredAnswers: number = 5): Promise<boolean> {
    const context = await this.config.conversationManager.getConversationContext(conversationId);
    return context.collectedAnswers.size >= requiredAnswers;
  }
}
