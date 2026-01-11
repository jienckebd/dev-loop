import { z } from 'zod';

/**
 * Execution State Schema
 *
 * Unified schema for all execution-related state, consolidating:
 * - Current workflow state (from state.json)
 * - PRD set states (from prd-set-state.json)
 * - Contribution tracking (from evolution-state.json, migrated to contribution)
 * - Contribution mode (from contribution-mode.json)
 * - Session management (from cursor-sessions.json)
 * - Retry counts (from retry-counts.json)
 */

export const workflowStateSchema = z.enum([
  'idle',
  'fetching-task',
  'executing-ai',
  'applying-changes',
  'awaiting-approval',
  'running-post-apply-hooks',
  'running-pre-test-hooks',
  'running-tests',
  'analyzing-logs',
  'marking-done',
  'creating-fix-task',
]);

export const prdStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled', 'blocked']);

export const activeContextSchema = z.object({
  prdSetId: z.string().optional(),
  prdId: z.string().optional(),
  phaseId: z.number().optional(),
  taskId: z.string().optional(),
  workflowState: workflowStateSchema,
  startedAt: z.string().optional(),
});

export const fileCreationTrackingSchema = z.object({
  requested: z.array(z.string()).default([]),
  created: z.array(z.string()).default([]),
  missing: z.array(z.string()).default([]),
  wrongLocation: z.array(z.string()).default([]),
});

export const investigationTrackingSchema = z.object({
  requested: z.boolean().default(false),
  skipped: z.boolean().default(false),
  created: z.number().default(0),
});

export const phaseStateSchema = z.object({
  phaseId: z.number(),
  status: prdStatusSchema,
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  completedTasks: z.number().default(0),
  totalTasks: z.number().default(0),
});

export const prdStateSchema = z.object({
  prdId: z.string(),
  prdSetId: z.string().optional(),
  status: prdStatusSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  cancelledAt: z.string().optional(),
  completedPhases: z.array(z.number()).default([]),
  currentPhase: z.number().optional(),
  currentTask: z.object({
    id: z.string(),
    status: z.string(),
    startedAt: z.string().optional(),
  }).optional(),
  phases: z.record(z.number(), phaseStateSchema).default({}),
  retryCounts: z.record(z.string(), z.number()).default({}),
});

export const prdSetStateSchema = z.object({
  setId: z.string(),
  status: prdStatusSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  cancelledAt: z.string().optional(),
  prds: z.array(z.string()).default([]),
  completedPhases: z.array(z.string()).default([]),
  currentPhase: z.number().optional(),
});

export const contributionSchema = z.object({
  fileCreation: z.record(z.string(), fileCreationTrackingSchema).default({}),
  investigationTasks: z.record(z.string(), investigationTrackingSchema).default({}),
});

export const contributionModeSchema = z.object({
  active: z.boolean().default(false),
  activatedAt: z.string().optional(),
  prdPath: z.string().optional(),
});

export const sessionHistoryEntrySchema = z.object({
  requestId: z.string().optional(),
  prompt: z.string().optional(),
  response: z.object({
    text: z.string().optional(),
    raw: z.any().optional(),
  }).optional(),
  timestamp: z.string(),
  success: z.boolean().optional(),
});

export const sessionStateSchema = z.object({
  sessionId: z.string(),
  createdAt: z.string(),
  lastUsed: z.string(),
  context: z.object({
    prdId: z.string().optional(),
    taskIds: z.array(z.string()).default([]),
  }),
  history: z.array(sessionHistoryEntrySchema).default([]),
});

export const executionStateFileSchema = z.object({
  version: z.union([z.number(), z.string()]).default('1.0'),
  updatedAt: z.string(),
  active: activeContextSchema,
  prdSets: z.record(z.string(), prdSetStateSchema).default({}),
  prds: z.record(z.string(), prdStateSchema).default({}),
  contribution: contributionSchema.default({
    fileCreation: {},
    investigationTasks: {},
  }),
  contributionMode: contributionModeSchema,
  sessions: z.record(z.string(), sessionStateSchema).default({}),
});

export type ExecutionState = z.infer<typeof executionStateFileSchema>;
export type ActiveContext = z.infer<typeof activeContextSchema>;
export type PRDSetState = z.infer<typeof prdSetStateSchema>;
export type PRDState = z.infer<typeof prdStateSchema>;
export type PhaseState = z.infer<typeof phaseStateSchema>;
export type ContributionState = z.infer<typeof contributionSchema>;
export type ContributionModeState = z.infer<typeof contributionModeSchema>;
export type SessionState = z.infer<typeof sessionStateSchema>;
