import { z } from 'zod';
import type { ConfigOverlay } from './overlays';

/**
 * Hierarchical Metrics Schemas
 *
 * Schemas for metrics JSON files at different levels:
 * - PRD Set Level (prd-set-metrics.json)
 * - PRD Level (prd-metrics.json)
 * - Phase Level (phase-metrics.json)
 * - Feature Level (feature-metrics.json)
 * - Parallel Execution (parallel-metrics.json)
 * - Schema Operations (schema-metrics.json)
 * - Contribution Mode (contribution-mode.json)
 * - Retry Counts (retry-counts.json)
 * - Evolution State (evolution-state.json)
 *
 * Based on interfaces from src/core/metrics/types.ts
 */

// Helper schemas for nested structures

const timingBreakdownSchema = z.object({
  jsonParsing: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
  fileFiltering: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
  validation: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
  ipc: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
  aiFallback: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
  contextBuilding: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
  codebaseSearch: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
  fileOperations: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
  sessionManagement: z.object({ totalMs: z.number(), avgMs: z.number(), count: z.number() }),
}).partial();

const tokenBreakdownSchema = z.object({
  codeGeneration: z.object({ input: z.number(), output: z.number() }),
  aiFallback: z.object({ input: z.number(), output: z.number() }),
  retry: z.object({ input: z.number(), output: z.number() }),
  errorAnalysis: z.object({ input: z.number(), output: z.number() }),
}).partial();

const jsonParsingMetricsSchema = z.object({
  totalAttempts: z.number(),
  successByStrategy: z.object({
    direct: z.number(),
    retry: z.number(),
    aiFallback: z.number(),
    sanitized: z.number(),
  }),
  failuresByReason: z.record(z.string(), z.number()),
  avgParsingTimeMs: z.number(),
  totalParsingTimeMs: z.number(),
  aiFallbackUsage: z.object({
    triggered: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    avgTimeMs: z.number(),
    totalTimeMs: z.number(),
    tokensUsed: z.object({ input: z.number(), output: z.number() }),
  }),
}).partial();

const ipcMetricsSchema = z.object({
  connectionsAttempted: z.number(),
  connectionsSucceeded: z.number(),
  connectionsFailed: z.number(),
  healthChecksPerformed: z.number(),
  healthCheckFailures: z.number(),
  avgConnectionTimeMs: z.number(),
  totalConnectionTimeMs: z.number(),
  retries: z.number(),
  avgRetryTimeMs: z.number(),
  totalRetryTimeMs: z.number(),
}).partial();

const fileFilteringMetricsSchema = z.object({
  filesFiltered: z.number(),
  predictiveFilters: z.number(),
  boundaryViolations: z.number(),
  filesAllowed: z.number(),
  avgFilteringTimeMs: z.number(),
  totalFilteringTimeMs: z.number(),
  filterSuggestionsGenerated: z.number(),
}).partial();

const validationMetricsSchema = z.object({
  preValidations: z.number(),
  preValidationFailures: z.number(),
  postValidations: z.number(),
  postValidationFailures: z.number(),
  errorsByCategory: z.record(z.string(), z.number()),
  recoverySuggestionsGenerated: z.number(),
  avgValidationTimeMs: z.number(),
  totalValidationTimeMs: z.number(),
}).partial();

const contextMetricsSchema = z.object({
  totalBuilds: z.number(),
  avgBuildTimeMs: z.number(),
  totalBuildTimeMs: z.number(),
  avgContextSizeChars: z.number(),
  totalContextSizeChars: z.number(),
  avgFilesIncluded: z.number(),
  totalFilesIncluded: z.number(),
  avgFilesTruncated: z.number(),
  totalFilesTruncated: z.number(),
  contextWindowUtilization: z.number(),
  searchOperations: z.object({
    total: z.number(),
    avgTimeMs: z.number(),
    totalTimeMs: z.number(),
    filesFound: z.number(),
    filesUsed: z.number(),
    efficiency: z.number(),
  }).partial(),
}).partial();

const codebaseMetricsSchema = z.object({
  searchOperations: z.object({
    total: z.number(),
    avgTimeMs: z.number(),
    totalTimeMs: z.number(),
    successRate: z.number(),
    patternsUsed: z.record(z.string(), z.number()),
    filesFound: z.number(),
    avgFilesPerSearch: z.number(),
  }).partial(),
  fileDiscovery: z.object({
    totalDiscoveries: z.number(),
    avgTimeMs: z.number(),
    totalTimeMs: z.number(),
    filesDiscovered: z.number(),
    patternsMatched: z.record(z.string(), z.number()),
    discoveryStrategies: z.record(z.string(), z.number()),
  }).partial(),
  fileOperations: z.object({
    reads: z.number(),
    writes: z.number(),
    deletes: z.number(),
    avgReadTimeMs: z.number(),
    avgWriteTimeMs: z.number(),
    totalReadTimeMs: z.number(),
    totalWriteTimeMs: z.number(),
    errors: z.number(),
    errorRate: z.number(),
  }).partial(),
  indexing: z.object({
    operations: z.number(),
    avgTimeMs: z.number(),
    totalTimeMs: z.number(),
    filesIndexed: z.number(),
    cacheHits: z.number(),
    cacheMisses: z.number(),
    cacheHitRate: z.number(),
  }).partial(),
  pathResolution: z.object({
    operations: z.number(),
    avgTimeMs: z.number(),
    totalTimeMs: z.number(),
    resolved: z.number(),
    failed: z.number(),
    symlinksEncountered: z.number(),
  }).partial(),
}).partial();

const sessionMetricsSchema = z.object({
  totalSessions: z.number(),
  activeSessions: z.number(),
  avgHistoryEntries: z.number(),
  maxHistoryEntries: z.number(),
  minHistoryEntries: z.number(),
  sessionRotations: z.number(),
  sessionHealthChecks: z.number(),
  unhealthySessions: z.number(),
  sessionPersistence: z.object({
    saves: z.number(),
    savesFailed: z.number(),
    loads: z.number(),
    loadsFailed: z.number(),
    avgSaveTimeMs: z.number(),
    avgLoadTimeMs: z.number(),
    totalSaveTimeMs: z.number(),
    totalLoadTimeMs: z.number(),
    successRate: z.number(),
  }).partial(),
  historyManagement: z.object({
    prunings: z.number(),
    summarizations: z.number(),
    avgPruningTimeMs: z.number(),
    totalPruningTimeMs: z.number(),
    entriesRemoved: z.number(),
    entriesRetained: z.number(),
  }).partial(),
  sessionLifespan: z.object({
    avgDurationMs: z.number(),
    maxDurationMs: z.number(),
    minDurationMs: z.number(),
    expiredSessions: z.number(),
  }).partial(),
}).partial();

const contributionModeIssuesSchema = z.object({
  moduleConfusion: z.object({
    detected: z.boolean(),
    filteredFileRate: z.number(),
    totalFileOperations: z.number(),
    incidents: z.array(z.object({
      taskId: z.string(),
      targetModule: z.string(),
      wrongModule: z.string(),
      timestamp: z.string(),
    })),
    alertThreshold: z.number(),
  }).partial(),
  sessionPollution: z.object({
    detected: z.boolean(),
    sessionsWithMultipleModules: z.number(),
    incidents: z.array(z.object({
      sessionId: z.string(),
      modules: z.array(z.string()),
      taskIds: z.array(z.string()),
      timestamp: z.string(),
    })),
  }).partial(),
  boundaryViolations: z.object({
    total: z.number(),
    rate: z.number(),
    byPattern: z.record(z.string(), z.number()),
    alertThreshold: z.number(),
  }).partial(),
  targetModuleContextLoss: z.object({
    detected: z.boolean(),
    tasksWithoutTargetModule: z.number(),
    totalTasks: z.number(),
    rate: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  codeGenerationDegradation: z.object({
    detected: z.boolean(),
    successRateTrend: z.number(),
    testPassRateTrend: z.number(),
    degradationRate: z.number(),
    alertThreshold: z.number(),
    trendWindowHours: z.number(),
  }).partial(),
  contextWindowInefficiency: z.object({
    detected: z.boolean(),
    avgContextSize: z.number(),
    tokensPerSuccess: z.number(),
    missingFileRate: z.number(),
    efficiencyRatio: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  taskDependencyDeadlock: z.object({
    detected: z.boolean(),
    blockedTasks: z.number(),
    circularDependencies: z.array(z.string()),
    avgWaitTime: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  testGenerationQuality: z.object({
    detected: z.boolean(),
    successRate: z.number(),
    coverageGap: z.number(),
    immediateFailureRate: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  validationGateOverBlocking: z.object({
    detected: z.boolean(),
    falsePositiveRate: z.number(),
    blockedValidChanges: z.number(),
    retrySuccessRate: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  aiProviderInstability: z.object({
    detected: z.boolean(),
    errorRate: z.number(),
    timeoutRate: z.number(),
    qualityTrend: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  resourceExhaustion: z.object({
    detected: z.boolean(),
    memoryUsageTrend: z.number(),
    diskUsageTrend: z.number(),
    timeoutRate: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  phaseProgressionStalling: z.object({
    detected: z.boolean(),
    stalledPhases: z.array(z.string()),
    avgProgressRate: z.number(),
    stallDuration: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  patternLearningInefficacy: z.object({
    detected: z.boolean(),
    matchToApplicationRate: z.number(),
    applicationSuccessRate: z.number(),
    recurringPatternRate: z.number(),
    alertThreshold: z.number(),
  }).partial(),
  schemaValidationConsistency: z.object({
    detected: z.boolean(),
    falsePositiveRate: z.number(),
    validationTimeTrend: z.number(),
    inconsistencyRate: z.number(),
    alertThreshold: z.number(),
  }).partial(),
}).partial();

const contributionModeMetricsSchema = z.object({
  outerAgentObservations: z.number(),
  devLoopFixesApplied: z.number(),
  fixesByCategory: z.record(z.string(), z.number()),
  rootCauseFixes: z.number(),
  workaroundFixes: z.number(),
  sessionDuration: z.number(),
  improvementsIdentified: z.number(),
  issues: contributionModeIssuesSchema,
}).partial();

const schemaOperationSchema = z.object({
  operation: z.enum(['create', 'update', 'delete', 'validate', 'parse']),
  schemaType: z.string(),
  schemaId: z.string().optional(),
  duration: z.number(),
  success: z.boolean(),
  error: z.string().optional(),
  timestamp: z.string(),
});

const schemaMetricsSchema = z.object({
  totalOperations: z.number(),
  operationsByType: z.record(z.string(), z.number()),
  operationsBySchemaType: z.record(z.string(), z.number()),
  successRate: z.number(),
  avgDuration: z.number(),
  errors: z.object({
    total: z.number(),
    byOperation: z.record(z.string(), z.number()),
    bySchemaType: z.record(z.string(), z.number()),
  }).partial(),
}).partial();

const featureMetricsSchema = z.object({
  featureName: z.string(),
  usageCount: z.number(),
  successCount: z.number(),
  failureCount: z.number(),
  avgDuration: z.number(),
  totalTokens: z.number(),
  errors: z.object({
    total: z.number(),
    byType: z.record(z.string(), z.number()),
  }).partial(),
}).partial();

// ConfigOverlay is defined in overlays.ts, but we'll use z.any() for now to avoid circular dependencies
// ConfigOverlay schema - use z.record() but can't use passthrough() on records
// For config overlays, we'll accept any additional properties by using z.any() as value type
const configOverlaySchema: z.ZodTypeAny = z.record(z.string(), z.any());

// Phase Metrics Data Schema
export const phaseMetricsDataSchema = z.object({
  phaseId: z.number(),
  phaseName: z.string(),
  prdId: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
  status: z.enum(['in-progress', 'completed', 'failed']),
  tasks: z.object({
    total: z.number(),
    completed: z.number(),
    failed: z.number(),
    successRate: z.number(),
  }),
  timing: z.object({
    totalMs: z.number(),
    avgTaskMs: z.number(),
  }),
  tokens: z.object({
    totalInput: z.number(),
    totalOutput: z.number(),
  }),
  tests: z.object({
    total: z.number(),
    passing: z.number(),
    failing: z.number(),
  }),
  parallel: z.boolean().optional(),
  configOverlay: configOverlaySchema.optional(),
});

export const phaseMetricsFileSchema = z.object({
  version: z.union([z.number(), z.string()]).optional(),
  metrics: z.array(phaseMetricsDataSchema).default([]),
}).passthrough(); // Allow additional fields for backward compatibility

// PRD Metrics Data Schema
export const prdMetricsDataSchema = z.object({
  prdId: z.string(),
  prdVersion: z.string(),
  prdSetId: z.string().optional(),
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
  status: z.enum(['in-progress', 'completed', 'failed']),
  phases: z.object({
    total: z.number(),
    completed: z.number(),
    failed: z.number(),
    successRate: z.number(),
    phaseMetrics: z.array(phaseMetricsDataSchema).optional(),
  }),
  tasks: z.object({
    total: z.number(),
    completed: z.number(),
    failed: z.number(),
    successRate: z.number(),
  }),
  tests: z.object({
    total: z.number(),
    passing: z.number(),
    failing: z.number(),
    passRate: z.number(),
  }),
  timing: z.object({
    totalMs: z.number(),
    avgPhaseMs: z.number(),
    avgTaskMs: z.number(),
    avgAiCallMs: z.number(),
    avgTestRunMs: z.number(),
    breakdown: timingBreakdownSchema.optional(),
  }),
  tokens: z.object({
    totalInput: z.number(),
    totalOutput: z.number(),
    totalCost: z.number().optional(),
    byFeature: tokenBreakdownSchema.optional(),
  }),
  errors: z.object({
    total: z.number(),
    byCategory: z.record(z.string(), z.number()),
    byType: z.record(z.string(), z.number()),
  }),
  efficiency: z.object({
    tokensPerTask: z.number(),
    iterationsPerTask: z.number(),
    avgRetries: z.number(),
  }),
  features: z.object({
    used: z.array(z.string()),
    featureMetrics: z.record(z.string(), featureMetricsSchema),
  }),
  schema: z.object({
    operations: z.array(schemaOperationSchema),
    schemaMetrics: schemaMetricsSchema,
  }),
  observations: z.object({
    total: z.number(),
    byType: z.record(z.string(), z.number()),
    bySeverity: z.record(z.string(), z.number()),
    resolutionRate: z.number(),
  }),
  patterns: z.object({
    totalMatched: z.number(),
    byType: z.record(z.string(), z.number()),
    effectiveness: z.number(),
    successRate: z.number(),
  }),
  jsonParsing: jsonParsingMetricsSchema.optional(),
  ipc: ipcMetricsSchema.optional(),
  fileFiltering: fileFilteringMetricsSchema.optional(),
  validation: validationMetricsSchema.optional(),
  context: contextMetricsSchema.optional(),
  codebase: codebaseMetricsSchema.optional(),
  sessions: sessionMetricsSchema.optional(),
  contributionMode: contributionModeMetricsSchema.optional(),
}).partial(); // Make all fields optional for flexibility

export const prdMetricsFileSchema = z.object({
  version: z.union([z.number(), z.string()]).optional(),
  // Can be array or object format (see prd.ts:61-71)
  metrics: z.union([
    z.array(prdMetricsDataSchema),
    z.record(z.string(), prdMetricsDataSchema),
  ]).optional(),
}).passthrough(); // Allow additional fields

// PRD Set Metrics Data Schema
export const prdSetMetricsDataSchema = z.object({
  setId: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  duration: z.number().optional(),
  status: z.enum(['in-progress', 'completed', 'failed', 'blocked']),
  prds: z.object({
    total: z.number(),
    completed: z.number(),
    failed: z.number(),
    blocked: z.number(),
    successRate: z.number(),
  }),
  executionLevels: z.object({
    total: z.number(),
    current: z.number(),
    completed: z.number(),
  }),
  timing: z.object({
    totalMs: z.number(),
    avgPrdMs: z.number(),
    avgTaskMs: z.number(),
    breakdown: timingBreakdownSchema.optional(),
  }),
  tokens: z.object({
    totalInput: z.number(),
    totalOutput: z.number(),
    totalCost: z.number().optional(),
    byFeature: tokenBreakdownSchema.optional(),
  }),
  tests: z.object({
    total: z.number(),
    passing: z.number(),
    failing: z.number(),
    passRate: z.number(),
  }),
  prdIds: z.array(z.string()),
  jsonParsing: jsonParsingMetricsSchema.optional(),
  ipc: ipcMetricsSchema.optional(),
  fileFiltering: fileFilteringMetricsSchema.optional(),
  validation: validationMetricsSchema.optional(),
  context: contextMetricsSchema.optional(),
  codebase: codebaseMetricsSchema.optional(),
  sessions: sessionMetricsSchema.optional(),
  contributionMode: contributionModeMetricsSchema.optional(),
}).partial(); // Make all fields optional for flexibility

export const prdSetMetricsFileSchema = z.object({
  version: z.union([z.number(), z.string()]).optional(),
  // Can be array or object format (see prd-set.ts:58-69)
  metrics: z.union([
    z.array(prdSetMetricsDataSchema),
    z.record(z.string(), prdSetMetricsDataSchema),
  ]).optional(),
}).passthrough(); // Allow additional fields

// Parallel Metrics Schema
const agentMetricsSchema = z.object({
  agentId: z.string(),
  taskId: z.string(),
  prdId: z.string(),
  phaseId: z.number().optional(),
  startTime: z.string(),
  endTime: z.string().optional(),
  durationMs: z.number(),
  status: z.enum(['running', 'completed', 'failed', 'timeout']),
  tokens: z.object({
    input: z.number(),
    output: z.number(),
    estimated: z.boolean(),
  }),
  overlappedWith: z.array(z.string()),
  promptLength: z.number(),
  responseLength: z.number(),
});

const concurrencyStatsSchema = z.object({
  maxConcurrent: z.number(),
  avgConcurrent: z.number(),
  peakTime: z.string(),
  totalAgents: z.number(),
});

const coordinationStatsSchema = z.object({
  waitTimeMs: z.number(),
  overlapTimeMs: z.number(),
  sequentialTimeMs: z.number(),
  parallelEfficiency: z.number(),
});

const parallelExecutionMetricsSchema = z.object({
  executionId: z.string(),
  prdSetId: z.string().optional(),
  startTime: z.string(),
  endTime: z.string().optional(),
  totalDurationMs: z.number(),
  agents: z.array(agentMetricsSchema),
  concurrency: concurrencyStatsSchema,
  coordination: coordinationStatsSchema,
  tokens: z.object({
    totalInput: z.number(),
    totalOutput: z.number(),
    avgPerAgent: z.number(),
  }),
});

export const parallelMetricsFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  executions: z.array(parallelExecutionMetricsSchema).default([]),
  summary: z.object({
    totalExecutions: z.number(),
    avgAgentsPerExecution: z.number(),
    avgParallelEfficiency: z.number(),
    totalTokensUsed: z.number(),
  }),
});

// Feature Metrics Schema
export const featureMetricsFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  features: z.record(z.string(), featureMetricsSchema),
  summary: z.object({
    totalFeatures: z.number(),
    avgSuccessRate: z.number(),
    totalUsageCount: z.number(),
  }).optional(),
}).passthrough();

// Schema Metrics Schema
export const schemaMetricsFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  operations: z.array(schemaOperationSchema).default([]),
  metrics: schemaMetricsSchema,
}).passthrough();

// Contribution Mode Schema
export const contributionModeFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  metrics: contributionModeMetricsSchema,
}).passthrough();

// Retry Counts Schema
export const retryCountsFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  retries: z.record(z.string(), z.object({
    count: z.number(),
    lastRetry: z.string(),
    success: z.boolean().optional(),
  })),
}).passthrough();

// Evolution State Schema
export const evolutionStateFileSchema = z.object({
  version: z.union([z.number(), z.string()]),
  currentPhase: z.string().optional(),
  fileCreationTracking: z.record(z.string(), z.object({
    requested: z.array(z.string()),
    created: z.array(z.string()),
    missing: z.array(z.string()),
  })),
  lastUpdated: z.string(),
}).passthrough();
