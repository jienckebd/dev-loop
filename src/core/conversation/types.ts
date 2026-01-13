/**
 * Conversation Management Types
 *
 * Types for managing multi-turn conversations during PRD building.
 * Independent of Cursor - uses dev-loop's own conversation system.
 */

/**
 * Build mode for PRD building
 */
export type BuildMode = 'convert' | 'enhance' | 'create';

/**
 * Conversation state
 */
export type ConversationState = 'questioning' | 'refining' | 'complete' | 'paused' | 'error';

/**
 * Question type for interactive prompts
 */
export type QuestionType = 'multiple-choice' | 'open-ended' | 'multi-select' | 'confirm';

/**
 * Spec-kit clarification category for structured question classification
 */
export type ClarificationCategory =
  | 'scope'          // What's in/out of scope
  | 'architecture'   // High-level design decisions
  | 'implementation' // How to build it
  | 'testing'        // How to validate
  | 'integration';   // How it connects to other systems

/**
 * Question for PRD building
 */
export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  options?: string[]; // For multiple choice / multi-select
  required: boolean;
  default?: string | string[] | boolean; // Default answer
  followUp?: Question[]; // Conditional follow-up questions
  context?: string; // Additional context for user
  conditionalLogic?: {
    ifAnswerEquals?: { [key: string]: Question[] };
    ifAnswerContains?: { [key: string]: Question[] };
    ifAnswerIsNumeric?: { min?: number; max?: number; then: Question[] };
  };
  // Spec-kit extensions
  category?: ClarificationCategory;  // Categorize the question
  inferredAnswer?: string;           // AI-inferred answer (for auto-approve)
  inferenceSource?: string;          // Where inference came from (e.g., ".cursorrules", "codebase pattern")
  confidence?: number;               // 0-1 confidence in inference
}

/**
 * Answer to a question
 */
export interface Answer {
  questionId: string;
  value: string | string[] | boolean;
  timestamp: string;
  skipped?: boolean;
}

/**
 * Conversation context
 */
export interface ConversationContext {
  mode: BuildMode;
  initialPrompt?: string; // For create mode
  collectedAnswers: Map<string, Answer>;
  generatedQuestions: Question[];
  currentIteration: number;
  featureTypes?: string[]; // Detected feature types
  framework?: string; // Detected framework
  codebaseContext?: string; // Relevant codebase context
}

/**
 * Conversation item (question or answer pair)
 */
export interface ConversationItem {
  id: string;
  question: Question;
  answer?: Answer;
  timestamp: string;
  iteration: number;
}

/**
 * Conversation metadata
 */
export interface ConversationMetadata {
  id: string;
  mode: BuildMode;
  createdAt: string;
  updatedAt: string;
  state: ConversationState;
  totalQuestions: number;
  totalAnswers: number;
  currentIteration: number;
}

/**
 * Conversation (complete conversation data)
 */
export interface Conversation {
  metadata: ConversationMetadata;
  context: ConversationContext;
  items: ConversationItem[];
}

/**
 * Summarized context (for context window management)
 */
export interface SummarizedContext {
  recent: ConversationItem[]; // Recent items (full context)
  summarized: string; // Summarized old items
  summaryTimestamp: string;
}

/**
 * PRD Building Phase
 */
export type PRDBuildingPhase =
  | 'question-generation'
  | 'question-answering'
  | 'draft-generation'
  | 'refinement'
  | 'validation'
  | 'complete';
