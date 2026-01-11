/**
 * Question Generator
 *
 * Generates clarifying questions based on context.
 * Uses AI to generate questions that help build comprehensive PRD sets.
 */

import { Question, QuestionType, Conversation } from '../../conversation/types';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureType } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../prompts/prompt-selector';
import { ConversationManager } from '../../conversation/conversation-manager';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { TextGenerationAdapter } from '../refinement/text-generation-adapter';
import { BuildMode } from '../../conversation/types';
import { logger } from '../../utils/logger';

/**
 * Question Generation Context
 */
export interface QuestionGenerationContext {
  conversationId: string;
  mode: BuildMode;
  initialPrompt: string;
  codebaseAnalysis: CodebaseAnalysisResult;
  featureTypes?: FeatureType[];
  existingQuestions?: Question[];
  existingAnswers?: Map<string, any>;
  iteration: number;
}

/**
 * Question Generation Result
 */
export interface QuestionGenerationResult {
  questions: Question[];
  summary: string;
}

/**
 * Question Generator Configuration
 */
export interface QuestionGeneratorConfig {
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  codebaseAnalysis: CodebaseAnalysisResult;
  promptSelector: PromptSelector;
  conversationManager?: ConversationManager;
  maxQuestions?: number;
  debug?: boolean;
}

/**
 * Generates clarifying questions based on context
 */
export class QuestionGenerator {
  private config: QuestionGeneratorConfig;
  private textGenerator: TextGenerationAdapter;
  private debug: boolean;

  constructor(config: QuestionGeneratorConfig) {
    this.config = {
      ...config,
      maxQuestions: config.maxQuestions || 10,
      debug: config.debug ?? false,
    };
    this.debug = this.config.debug ?? false;
    this.textGenerator = new TextGenerationAdapter(
      config.aiProvider,
      config.aiProviderConfig,
      this.debug
    );
  }

  /**
   * Generate initial questions from prompt
   */
  async generateInitialQuestions(
    initialPrompt: string,
    context: Omit<QuestionGenerationContext, 'iteration' | 'existingQuestions' | 'existingAnswers'>
  ): Promise<QuestionGenerationResult> {
    logger.debug(`[QuestionGenerator] Generating initial questions from prompt: ${initialPrompt.substring(0, 50)}...`);

    // Get appropriate prompt for question generation
    const prompt = await this.config.promptSelector.getPromptForUseCase('question-generation', {
      mode: context.mode,
      framework: context.codebaseAnalysis.framework,
      featureTypes: context.featureTypes,
    });

    // Build prompt for AI
    const aiPrompt = this.buildQuestionGenerationPrompt(initialPrompt, context, prompt);

    try {
      const response = await this.textGenerator.generate(aiPrompt, {
        maxTokens: 3000,
        temperature: 0.7, // Higher temperature for more creative questions
        systemPrompt: 'You are an expert at generating clarifying questions to help build comprehensive PRD sets.',
      });

      // Parse AI response to extract questions
      const questions = this.parseQuestionsResponse(response, context);

      // Limit to maxQuestions
      const limitedQuestions = questions.slice(0, this.config.maxQuestions || 10);

      const summary = `Generated ${limitedQuestions.length} initial question(s) from prompt`;

      return {
        questions: limitedQuestions,
        summary,
      };
    } catch (error) {
      logger.error(`[QuestionGenerator] Failed to generate questions: ${error}`);
      // Fallback to basic questions
      return this.generateFallbackQuestions(initialPrompt, context);
    }
  }

  /**
   * Generate follow-up questions based on answers
   */
  async generateFollowUpQuestions(
    context: QuestionGenerationContext
  ): Promise<QuestionGenerationResult> {
    logger.debug(`[QuestionGenerator] Generating follow-up questions for iteration ${context.iteration}`);

    // Get conversation context
    const conversation = this.config.conversationManager && context.conversationId
      ? await this.config.conversationManager.getConversation(context.conversationId)
      : null;

    if (!conversation) {
      return { questions: [], summary: 'No conversation context available' };
    }

    // Get appropriate prompt
    const prompt = await this.config.promptSelector.getPromptForUseCase(
      'follow-up-question-generation',
      {
        mode: context.mode,
        framework: context.codebaseAnalysis.framework,
        featureTypes: context.featureTypes,
      }
    );

    // Build prompt for follow-up questions
    const aiPrompt = this.buildFollowUpQuestionPrompt(context, conversation, prompt);

    try {
      const response = await this.textGenerator.generate(aiPrompt, {
        maxTokens: 2000,
        temperature: 0.6,
        systemPrompt: 'You are an expert at generating follow-up questions based on previous answers.',
      });

      // Parse AI response
      const questions = this.parseQuestionsResponse(response, context);

      // Limit to maxQuestions
      const limitedQuestions = questions.slice(0, this.config.maxQuestions || 5); // Fewer follow-up questions

      const summary = `Generated ${limitedQuestions.length} follow-up question(s)`;

      return {
        questions: limitedQuestions,
        summary,
      };
    } catch (error) {
      logger.error(`[QuestionGenerator] Failed to generate follow-up questions: ${error}`);
      return { questions: [], summary: 'Failed to generate follow-up questions' };
    }
  }

  /**
   * Build prompt for initial question generation
   */
  private buildQuestionGenerationPrompt(
    initialPrompt: string,
    context: Omit<QuestionGenerationContext, 'iteration' | 'existingQuestions' | 'existingAnswers'>,
    basePrompt: string
  ): string {
    const parts: string[] = [];

    parts.push(basePrompt);
    parts.push('\n---\n');

    parts.push('## User Prompt');
    parts.push(initialPrompt);
    parts.push('');

    // Framework context
    if (context.codebaseAnalysis.frameworkPlugin) {
      parts.push('## Framework');
      parts.push(`Framework: ${context.codebaseAnalysis.frameworkPlugin.name}`);
      parts.push(`Description: ${context.codebaseAnalysis.frameworkPlugin.description}`);
      parts.push('');
    }

    // Feature types context
    if (context.featureTypes && context.featureTypes.length > 0) {
      parts.push('## Detected Feature Types');
      parts.push(context.featureTypes.join(', '));
      parts.push('');
    }

    // Codebase context (limited)
    if (context.codebaseAnalysis.codebaseContext) {
      parts.push('## Codebase Context (Summary)');
      parts.push(context.codebaseAnalysis.codebaseContext.substring(0, 1000)); // Limit context size
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push(`Generate ${this.config.maxQuestions || 10} clarifying questions to help build a comprehensive PRD set.`);
    parts.push('Questions should:');
    parts.push('- Clarify requirements and scope');
    parts.push('- Identify missing details');
    parts.push('- Understand user preferences');
    parts.push('- Be specific and actionable');
    parts.push('- Use appropriate question types (multiple-choice, open-ended, etc.)');
    parts.push('');
    parts.push('Return questions in JSON format:');
    parts.push(JSON.stringify({
      questions: [
        {
          id: 'question-1',
          text: 'Question text?',
          type: 'multiple-choice', // or 'open-ended', 'multi-select', 'confirm'
          options: ['Option 1', 'Option 2'], // For multiple-choice/multi-select
          required: true,
        },
      ],
    }, null, 2));

    return parts.join('\n');
  }

  /**
   * Build prompt for follow-up questions
   */
  private buildFollowUpQuestionPrompt(
    context: QuestionGenerationContext,
    conversation: Conversation,
    basePrompt: string
  ): string {
    const parts: string[] = [];

    parts.push(basePrompt);
    parts.push('\n---\n');

    parts.push('## Previous Conversation');
    parts.push(`Initial Prompt: ${context.initialPrompt}`);
    parts.push('');

    // Include recent Q&A
    const recentItems = conversation.items.slice(-5);
    for (const item of recentItems) {
      parts.push(`Q: ${item.question.text}`);
      if (item.answer) {
        parts.push(`A: ${typeof item.answer.value === 'string' ? item.answer.value : JSON.stringify(item.answer.value)}`);
      }
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push(`Generate ${this.config.maxQuestions || 5} follow-up questions based on the answers above.`);
    parts.push('Questions should:');
    parts.push('- Dive deeper into unclear areas');
    parts.push('- Ask about specific implementation details');
    parts.push('- Clarify dependencies and relationships');
    parts.push('- Address gaps in understanding');
    parts.push('');
    parts.push('Return questions in JSON format (same structure as initial questions).');

    return parts.join('\n');
  }

  /**
   * Parse AI response to extract questions
   */
  private parseQuestionsResponse(
    response: string,
    context: Omit<QuestionGenerationContext, 'iteration' | 'existingQuestions' | 'existingAnswers'>
  ): Question[] {
    const questions: Question[] = [];

    // Try to parse JSON response
    try {
      const jsonMatch = response.match(/```(?:json)?\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.questions && Array.isArray(parsed.questions)) {
          for (const q of parsed.questions) {
            questions.push(this.normalizeQuestion(q, questions.length + 1));
          }
          return questions;
        }
      }

      // Try parsing entire response as JSON
      const parsed = JSON.parse(response);
      if (parsed.questions && Array.isArray(parsed.questions)) {
        for (const q of parsed.questions) {
          questions.push(this.normalizeQuestion(q, questions.length + 1));
        }
        return questions;
      }
    } catch {
      // JSON parsing failed, try other formats
    }

    // Try to parse markdown list format
    const lines = response.split('\n');
    let currentQuestion: Partial<Question> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for question marker
      if (trimmed.match(/^\d+[\.\)]\s+/) || trimmed.match(/^[-*]\s+/) || trimmed.match(/^Q[:\d]+\s*/i)) {
        if (currentQuestion && currentQuestion.text) {
          questions.push(this.normalizeQuestion(currentQuestion, questions.length + 1));
        }
        currentQuestion = {
          text: trimmed.replace(/^\d+[\.\)]\s+/, '').replace(/^[-*]\s+/, '').replace(/^Q[:\d]+\s*/i, '').trim(),
        };
      } else if (trimmed.match(/^Type:/i)) {
        const type = trimmed.replace(/^Type:\s*/i, '').trim().toLowerCase();
        if (currentQuestion) {
          currentQuestion.type = type as Question['type'];
        }
      } else if (trimmed.match(/^Options:/i)) {
        // Extract options from following lines
        const options: string[] = [];
        const optionIndex = lines.indexOf(line);
        for (let i = optionIndex + 1; i < lines.length && i < optionIndex + 10; i++) {
          const optLine = lines[i].trim();
          if (optLine.match(/^[-*]\s/) || optLine.match(/^\d+[\.\)]\s/)) {
            options.push(optLine.replace(/^[-*]\s/, '').replace(/^\d+[\.\)]\s/, '').trim());
          } else if (optLine.length === 0) {
            break;
          }
        }
        if (currentQuestion && options.length > 0) {
          currentQuestion.options = options;
        }
      } else if (currentQuestion && trimmed.length > 0 && !trimmed.startsWith('#')) {
        // Add to question text
        currentQuestion.text = `${currentQuestion.text} ${trimmed}`.trim();
      }
    }

    // Add last question
    if (currentQuestion && currentQuestion.text) {
      questions.push(this.normalizeQuestion(currentQuestion, questions.length + 1));
    }

    // If no structured format found, create basic questions from response
    if (questions.length === 0) {
      return this.generateFallbackQuestions(context.initialPrompt, context).questions;
    }

    return questions;
  }

  /**
   * Normalize question structure
   */
  private normalizeQuestion(q: any, index: number): Question {
    const question: Question = {
      id: q.id || `question-${index}`,
      text: q.text || q.question || String(q),
      type: (q.type || 'open-ended') as Question['type'],
      required: q.required !== false, // Default to required
      options: q.options || q.choices || undefined,
      default: q.default,
      context: q.context,
      conditionalLogic: q.conditionalLogic,
      followUp: q.followUp || q.follow_up || undefined,
    };

    // Validate question type
    if (question.type === 'multiple-choice' || question.type === 'multi-select') {
      if (!question.options || question.options.length === 0) {
        // Fallback to open-ended if no options provided
        question.type = 'open-ended';
      }
    }

    return question;
  }

  /**
   * Generate fallback questions if AI generation fails
   */
  private generateFallbackQuestions(
    initialPrompt: string,
    context: Omit<QuestionGenerationContext, 'iteration' | 'existingQuestions' | 'existingAnswers'>
  ): QuestionGenerationResult {
    const questions: Question[] = [];

    // Basic questions based on prompt analysis
    const promptLower = initialPrompt.toLowerCase();

    questions.push({
      id: 'question-1',
      text: 'What is the primary goal or purpose of this feature?',
      type: 'open-ended',
      required: true,
    });

    questions.push({
      id: 'question-2',
      text: 'What are the main requirements or functionality needed?',
      type: 'open-ended',
      required: true,
    });

    if (promptLower.includes('entity') || promptLower.includes('model')) {
      questions.push({
        id: 'question-3',
        text: 'What data fields or properties should this entity have?',
        type: 'open-ended',
        required: false,
      });
    }

    if (promptLower.includes('form')) {
      questions.push({
        id: 'question-3',
        text: 'What form fields or inputs are needed?',
        type: 'open-ended',
        required: false,
      });
    }

    if (promptLower.includes('api') || promptLower.includes('endpoint')) {
      questions.push({
        id: 'question-3',
        text: 'What API endpoints or operations are needed?',
        type: 'open-ended',
        required: false,
      });
    }

    questions.push({
      id: 'question-4',
      text: 'Are there any dependencies on other modules or features?',
      type: 'confirm',
      required: false,
    });

    questions.push({
      id: 'question-5',
      text: 'What is the expected behavior or outcome?',
      type: 'open-ended',
      required: false,
    });

    return {
      questions: questions.slice(0, this.config.maxQuestions || 10),
      summary: `Generated ${questions.length} fallback question(s)`,
    };
  }
}
