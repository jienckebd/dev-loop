import { z } from 'zod';

/**
 * Runtime Data Schemas
 *
 * Schemas for runtime JSON files that dev-loop reads/writes during execution.
 * These schemas validate data persistence files.
 */

/**
 * Pattern schema (for patterns.json)
 * Based on actual patterns.json structure
 */
export const patternSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  guidance: z.string(),
  occurrences: z.number().default(0),
  lastSeen: z.string().optional(),
  files: z.array(z.string()).default([]),
  projectTypes: z.array(z.string()).default([]),
});

export const patternsFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  lastUpdated: z.string().optional(),
  updatedAt: z.string().optional(), // Support both formats
  patterns: z.array(patternSchema).default([]),
});

/**
 * Observation schema (for observations.json)
 * Based on Observation interface from metrics/observation.ts:14-26
 */
export const observationSchema = z.object({
  id: z.string(),
  type: z.enum(['failure-pattern', 'efficiency-issue', 'validation-trend', 'token-spike', 'other']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  createdAt: z.string().optional(),
  relevanceScore: z.number().min(0).max(1).optional(),
  expiresAt: z.string().nullable().optional(),
  prdId: z.string().optional(),
  phaseId: z.number().optional(),
  taskId: z.string().optional(),
  category: z.string().optional(),
  observation: z.string().optional(),
  description: z.string().optional(),
  resolved: z.boolean().optional(),
  resolvedAt: z.string().optional(),
  resolution: z.string().optional(),
  timestamp: z.string().optional(),
  occurrences: z.number().optional(),
  affectedProjects: z.array(z.string()).optional(),
  affectedProviders: z.array(z.string()).optional(),
  firstSeen: z.string().optional(),
  lastSeen: z.string().optional(),
  suggestedImprovements: z.array(z.string()).optional(),
  evidence: z.array(z.string()).optional(),
  context: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const observationsFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  observations: z.array(observationSchema).default([]),
  updatedAt: z.string().optional(),
});

/**
 * Run metrics schema (for metrics.json - debug/run metrics)
 * Based on RunMetrics and MetricsData interfaces from metrics/debug.ts
 */
export const runMetricsSchema = z.object({
  timestamp: z.string(),
  taskId: z.union([z.string(), z.number(), z.null()]).optional(),
  taskTitle: z.string().optional(),
  status: z.enum(['completed', 'failed', 'pending']).optional(),
  timing: z.object({
    aiCallMs: z.number().optional(),
    testRunMs: z.number().optional(),
    logAnalysisMs: z.number().optional(),
    totalMs: z.number().optional(),
  }).optional(),
  tokens: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
  }).optional(),
  context: z.object({
    sizeChars: z.number().optional(),
    filesIncluded: z.number().optional(),
    filesTruncated: z.number().optional(),
  }).optional(),
  patches: z.object({
    attempted: z.number().optional(),
    succeeded: z.number().optional(),
    failed: z.number().optional(),
  }).optional(),
  validation: z.object({
    preValidationPassed: z.boolean().optional(),
    syntaxErrorsFound: z.number().optional(),
  }).optional(),
  patterns: z.object({
    matched: z.number().optional(),
    applied: z.number().optional(),
  }).optional(),
  projectMetadata: z.object({
    projectType: z.string().optional(),
    framework: z.string().optional(),
    projectPath: z.string().optional(),
  }).optional(),
  outcome: z.object({
    failureType: z.enum(['validation', 'test', 'log', 'timeout', 'success']).optional(),
    errorCategory: z.string().optional(),
    retryCount: z.number().optional(),
  }).optional(),
  efficiency: z.object({
    tokensPerSuccess: z.number().optional(),
    iterationsToSuccess: z.number().optional(),
  }).optional(),
  contribution: z.object({
    fileCreation: z.object({
      filesRequested: z.array(z.string()).optional(),
      filesCreated: z.array(z.string()).optional(),
      missingFiles: z.array(z.string()).optional(),
      wrongLocationFiles: z.array(z.string()).optional(),
    }).optional(),
    investigationTasks: z.object({
      requested: z.boolean().optional(),
      skipped: z.boolean().optional(),
      created: z.number().optional(),
    }).optional(),
    blockingReason: z.string().optional(),
    aiSummary: z.string().optional(),
  }).optional(),
});

export const metricsFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  runs: z.array(runMetricsSchema).default([]),
  summary: z.object({
    totalRuns: z.number().optional(),
    successRate: z.number().optional(),
    avgAiCallMs: z.number().optional(),
    avgTestRunMs: z.number().optional(),
    totalTokensInput: z.number().optional(),
    totalTokensOutput: z.number().optional(),
  }).optional(),
});

/**
 * State schema (for state.json)
 */
export const stateFileSchema = z.object({
  currentPrdId: z.string().optional(),
  currentPhaseId: z.number().optional(),
  currentTaskId: z.string().optional(),
  workflowState: z.enum([
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
  ]).optional(),
  lastUpdated: z.string().optional(),
}).passthrough(); // Allow additional fields

/**
 * Test result schema (for test-results.json/test-results.json)
 */
export const testResultSchema = z.object({
  id: z.string().optional(),
  timestamp: z.string(),
  success: z.boolean(),
  output: z.string().optional(),
  artifacts: z.array(z.object({
    type: z.string(),
    path: z.string(),
    name: z.string(),
  })).optional(),
  duration: z.number().optional(),
});

export const testResultsFileSchema = z.object({
  version: z.union([z.number(), z.string()]).optional(),
  results: z.array(testResultSchema).default([]),
}).passthrough(); // Allow additional fields
