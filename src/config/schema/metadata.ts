import { z } from 'zod';

/**
 * Metadata Schemas
 *
 * Schemas for metadata JSON files:
 * - PRD Set State (prd-set-state.json)
 * - Chat Requests (chat-requests.json)
 * - Cursor Sessions (cursor-sessions.json)
 * - Checkpoints (prd-building-checkpoints/*.json)
 * - Conversations (conversations/*.json)
 * - PRD Context V2 (prd-context-v2/*.json)
 */

/**
 * PRD Set State Schema
 */
export const prdSetStateSchema = z.object({
  prdSetId: z.string(),
  status: z.enum(['planning', 'ready', 'active', 'complete', 'cancelled']),
  currentPhaseIds: z.array(z.number()).optional(),
  completedPhaseIds: z.array(z.number()).optional(),
  lastUpdated: z.string(),
}).passthrough();

/**
 * Chat Request Schema (for files-private/cursor/chat-requests.json)
 */
export const chatRequestSchema = z.object({
  id: z.string(),
  agentName: z.string(),
  question: z.string(),
  model: z.string(),
  mode: z.enum(['Ask', 'Chat', 'Compose']),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  createdAt: z.string(),
  context: z.object({
    prdId: z.string().optional(),
    phaseId: z.number().optional(),
    prdSetId: z.string().optional(),
    taskId: z.string().optional(),
  }).optional(),
}).passthrough();

/**
 * Cursor Session Schema (for .devloop/cursor-sessions.json)
 */
export const sessionSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  lastAccessed: z.string(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    timestamp: z.string(),
  })),
}).passthrough();

/**
 * Checkpoint Schema (for .devloop/prd-building-checkpoints/*.json)
 */
export const checkpointSchema = z.object({
  checkpointId: z.string().optional(),
  timestamp: z.string(),
  prdId: z.string().optional(),
  phaseId: z.number().optional(),
  data: z.record(z.string(), z.any()),
}).passthrough();

/**
 * Conversation Schemas (for .devloop/conversations/conv-*.json)
 * Based on Conversation interface from conversation/types.ts
 */
const questionTypeSchema = z.enum(['multiple-choice', 'open-ended', 'multi-select', 'confirm']);

const questionSchema: z.ZodTypeAny = z.object({
  id: z.string(),
  text: z.string(),
  type: questionTypeSchema,
  options: z.array(z.string()).optional(),
  required: z.boolean(),
  default: z.union([z.string(), z.array(z.string()), z.boolean()]).optional(),
  followUp: z.lazy((): z.ZodTypeAny => z.array(questionSchema)).optional(),
  context: z.string().optional(),
  conditionalLogic: z.object({
    ifAnswerEquals: z.record(z.string(), z.lazy((): z.ZodTypeAny => z.array(questionSchema))).optional(),
    ifAnswerContains: z.record(z.string(), z.lazy((): z.ZodTypeAny => z.array(questionSchema))).optional(),
    ifAnswerIsNumeric: z.object({
      min: z.number().optional(),
      max: z.number().optional(),
      then: z.lazy((): z.ZodTypeAny => z.array(questionSchema)),
    }).optional(),
  }).optional(),
});

const answerSchema = z.object({
  questionId: z.string(),
  value: z.union([z.string(), z.array(z.string()), z.boolean()]),
  timestamp: z.string(),
  skipped: z.boolean().optional(),
});

const conversationContextSchema = z.object({
  mode: z.enum(['convert', 'enhance', 'create']),
  initialPrompt: z.string().optional(),
  collectedAnswers: z.record(z.string(), answerSchema).optional(), // Map serialized as object
  generatedQuestions: z.array(questionSchema).optional(),
  currentIteration: z.number(),
  featureTypes: z.array(z.string()).optional(),
  framework: z.string().optional(),
  codebaseContext: z.string().optional(),
}).passthrough();

const conversationItemSchema = z.object({
  id: z.string(),
  question: questionSchema,
  answer: answerSchema.optional(),
  timestamp: z.string(),
  iteration: z.number(),
});

const conversationMetadataSchema = z.object({
  id: z.string(),
  mode: z.enum(['convert', 'enhance', 'create']),
  createdAt: z.string(),
  updatedAt: z.string(),
  state: z.enum(['questioning', 'refining', 'complete', 'paused', 'error']),
  totalQuestions: z.number(),
  totalAnswers: z.number(),
  currentIteration: z.number(),
});

export const conversationFileSchema = z.object({
  metadata: conversationMetadataSchema,
  context: conversationContextSchema,
  items: z.array(conversationItemSchema),
}).passthrough();

/**
 * PRD Context V2 Schema (for .devloop/prd-context-v2/*.json)
 * Based on actual prd-context-v2 file structure
 */
const requirementSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  priority: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
}).passthrough();

export const prdContextV2FileSchema = z.object({
  prdId: z.string(),
  prdPath: z.string(),
  startedAt: z.string(),
  requirements: z.array(requirementSchema),
  context: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
}).passthrough();
