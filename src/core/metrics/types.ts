/**
 * Hierarchical Metrics System
 *
 * Tracks metrics at multiple levels:
 * - PRD Set Level: Aggregates metrics across all PRDs in a set
 * - PRD Level: Aggregates metrics across all phases in a PRD
 * - Phase Level: Aggregates metrics across all tasks in a phase
 * - Task Level: Individual task execution metrics (existing)
 */

import { RunMetrics } from "./debug";
import type { ConfigOverlay } from '../../config/schema/overlays';

// PRD Set Level
export interface PrdSetMetadata {
  setId: string;
  prdPaths: string[];
  startTime?: string;
  // Config overlay for the entire PRD set (merged with project config)
  configOverlay?: ConfigOverlay;
}

export interface PrdSetMetricsData {
  setId: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  status: 'in-progress' | 'completed' | 'failed' | 'blocked';
  prds: {
    total: number;
    completed: number;
    failed: number;
    blocked: number;
    successRate: number;
  };
  executionLevels: {
    total: number;
    current: number;
    completed: number;
  };
  timing: {
    totalMs: number;
    avgPrdMs: number;
    avgTaskMs: number;
    breakdown?: TimingBreakdown;
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
    totalCost?: number;
    byFeature?: TokenBreakdown;
  };
  tests: {
    total: number;
    passing: number;
    failing: number;
    passRate: number;
  };
  prdIds: string[]; // List of PRD IDs in this set
  // Aggregated enhanced metrics
  jsonParsing?: JsonParsingMetrics;
  ipc?: IpcMetrics;
  fileFiltering?: FileFilteringMetrics;
  validation?: ValidationMetrics;
  context?: ContextMetrics;
  codebase?: CodebaseMetrics;
  sessions?: SessionMetrics;
  contributionMode?: ContributionModeMetrics;
  specKit?: SpecKitMetrics;
}

// Task Level Detail (for reporting)
export interface TaskDetail {
  taskId: string;
  title: string;
  status: 'success' | 'failed' | 'blocked' | 'pending';
  durationMs: number;
  tokensInput: number;
  tokensOutput: number;
  retryCount: number;
  jsonParseAttempts: number;
  contextSizeChars: number;
  filesCreated: number;
  filesModified: number;
  filesDeleted: number;
  patternsApplied?: number;
  iterationsToSuccess?: number;
}

// PRD Level
export interface PrdMetadata {
  prdId: string;
  prdVersion: string;
  prdPath: string;
  phases?: Array<{
    id: number;
    name: string;
    // Phase-level config overlay (merged with PRD config)
    config?: ConfigOverlay;
  }>;
  features?: string[];
  // PRD-level config overlay (merged with PRD set config)
  configOverlay?: ConfigOverlay;
}

export interface FeatureMetrics {
  featureName: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  avgDuration: number;
  totalTokens: number;
  errors: {
    total: number;
    byType: Record<string, number>;
  };
}

export interface SchemaOperation {
  operation: 'create' | 'update' | 'delete' | 'validate' | 'parse';
  schemaType: string; // e.g., 'entity_type', 'field_storage', 'form_display'
  schemaId?: string;
  duration: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

export interface SchemaMetrics {
  totalOperations: number;
  operationsByType: Record<string, number>;
  operationsBySchemaType: Record<string, number>;
  successRate: number;
  avgDuration: number;
  errors: {
    total: number;
    byOperation: Record<string, number>;
    bySchemaType: Record<string, number>;
  };
}

// JSON Parsing Metrics
export interface JsonParsingMetrics {
  totalAttempts: number;
  successByStrategy: {
    direct: number;
    retry: number;
    aiFallback: number;
    sanitized: number;
  };
  failuresByReason: Record<string, number>;
  avgParsingTimeMs: number;
  totalParsingTimeMs: number;
  aiFallbackUsage: {
    triggered: number;
    succeeded: number;
    failed: number;
    avgTimeMs: number;
    totalTimeMs: number;
    tokensUsed: { input: number; output: number };
  };
}

// IPC Connection Metrics
export interface IpcMetrics {
  connectionsAttempted: number;
  connectionsSucceeded: number;
  connectionsFailed: number;
  healthChecksPerformed: number;
  healthCheckFailures: number;
  avgConnectionTimeMs: number;
  totalConnectionTimeMs: number;
  retries: number;
  avgRetryTimeMs: number;
  totalRetryTimeMs: number;
}

// File Filtering Metrics
export interface FileFilteringMetrics {
  filesFiltered: number;
  predictiveFilters: number;
  boundaryViolations: number;
  filesAllowed: number;
  avgFilteringTimeMs: number;
  totalFilteringTimeMs: number;
  filterSuggestionsGenerated: number;
}

// Validation Gate Metrics
export interface ValidationMetrics {
  preValidations: number;
  preValidationFailures: number;
  postValidations: number;
  postValidationFailures: number;
  errorsByCategory: Record<string, number>;
  recoverySuggestionsGenerated: number;
  avgValidationTimeMs: number;
  totalValidationTimeMs: number;
}

// Context Management Metrics
export interface ContextMetrics {
  totalBuilds: number;
  avgBuildTimeMs: number;
  totalBuildTimeMs: number;
  avgContextSizeChars: number;
  totalContextSizeChars: number;
  avgFilesIncluded: number;
  totalFilesIncluded: number;
  avgFilesTruncated: number;
  totalFilesTruncated: number;
  contextWindowUtilization: number; // percentage of context window used
  searchOperations: {
    total: number;
    avgTimeMs: number;
    totalTimeMs: number;
    filesFound: number;
    filesUsed: number;
    efficiency: number; // filesUsed / filesFound
  };
}

// Codebase Management Metrics
export interface CodebaseMetrics {
  searchOperations: {
    total: number;
    avgTimeMs: number;
    totalTimeMs: number;
    successRate: number;
    patternsUsed: Record<string, number>;
    filesFound: number;
    avgFilesPerSearch: number;
  };
  fileDiscovery: {
    totalDiscoveries: number;
    avgTimeMs: number;
    totalTimeMs: number;
    filesDiscovered: number;
    patternsMatched: Record<string, number>;
    discoveryStrategies: Record<string, number>;
  };
  fileOperations: {
    reads: number;
    writes: number;
    deletes: number;
    avgReadTimeMs: number;
    avgWriteTimeMs: number;
    totalReadTimeMs: number;
    totalWriteTimeMs: number;
    errors: number;
    errorRate: number;
  };
  indexing: {
    operations: number;
    avgTimeMs: number;
    totalTimeMs: number;
    filesIndexed: number;
    cacheHits: number;
    cacheMisses: number;
    cacheHitRate: number;
  };
  pathResolution: {
    operations: number;
    avgTimeMs: number;
    totalTimeMs: number;
    resolved: number;
    failed: number;
    symlinksEncountered: number;
  };
}

// Session Management Metrics
export interface SessionMetrics {
  totalSessions: number;
  activeSessions: number;
  avgHistoryEntries: number;
  maxHistoryEntries: number;
  minHistoryEntries: number;
  sessionRotations: number;
  sessionHealthChecks: number;
  unhealthySessions: number;
  sessionPersistence: {
    saves: number;
    savesFailed: number;
    loads: number;
    loadsFailed: number;
    avgSaveTimeMs: number;
    avgLoadTimeMs: number;
    totalSaveTimeMs: number;
    totalLoadTimeMs: number;
    successRate: number;
  };
  historyManagement: {
    prunings: number;
    summarizations: number;
    avgPruningTimeMs: number;
    totalPruningTimeMs: number;
    entriesRemoved: number;
    entriesRetained: number;
  };
  sessionLifespan: {
    avgDurationMs: number;
    maxDurationMs: number;
    minDurationMs: number;
    expiredSessions: number;
  };
}

// Contribution Mode Metrics
export interface ContributionModeMetrics {
  outerAgentObservations: number;
  devLoopFixesApplied: number;
  fixesByCategory: Record<string, number>;
  rootCauseFixes: number;
  workaroundFixes: number;
  sessionDuration: number;
  improvementsIdentified: number;
  // NEW: Issue detection for contribution mode
  issues: {
    moduleConfusion: {
      detected: boolean;
      filteredFileRate: number; // % of files filtered vs total
      totalFileOperations: number;
      incidents: Array<{
        taskId: string;
        targetModule: string;
        wrongModule: string;
        timestamp: string;
      }>;
      alertThreshold: number; // e.g., 0.10 (10%)
    };
    sessionPollution: {
      detected: boolean;
      sessionsWithMultipleModules: number;
      incidents: Array<{
        sessionId: string;
        modules: string[];
        taskIds: string[];
        timestamp: string;
      }>;
    };
    boundaryViolations: {
      total: number;
      rate: number; // % of file operations
      byPattern: Record<string, number>;
      alertThreshold: number; // e.g., 0.05 (5%)
    };
    targetModuleContextLoss: {
      detected: boolean;
      tasksWithoutTargetModule: number;
      totalTasks: number;
      rate: number; // % of tasks
      alertThreshold: number; // e.g., 0.01 (1%)
    };
    codeGenerationDegradation: {
      detected: boolean;
      successRateTrend: number; // Trend in success rate (negative = degrading)
      testPassRateTrend: number; // Trend in test pass rate
      degradationRate: number; // % degradation from baseline
      alertThreshold: number; // e.g., 0.20 (20% degradation)
      trendWindowHours: number; // Time window for trend analysis
    };
    contextWindowInefficiency: {
      detected: boolean;
      avgContextSize: number; // Average context window size
      tokensPerSuccess: number; // Average tokens per successful task
      missingFileRate: number; // % of tasks with missing file errors
      efficiencyRatio: number; // success rate / tokens per task
      alertThreshold: number; // Minimum acceptable efficiency ratio
    };
    taskDependencyDeadlock: {
      detected: boolean;
      blockedTasks: number; // Tasks stuck due to dependencies
      circularDependencies: string[]; // Detected circular dependency paths
      avgWaitTime: number; // Average wait time in minutes
      alertThreshold: number; // Max wait time in minutes (e.g., 30)
    };
    testGenerationQuality: {
      detected: boolean;
      successRate: number; // Tests that pass on first run
      coverageGap: number; // Gap between test coverage and requirements coverage
      immediateFailureRate: number; // Tests that fail immediately after generation
      alertThreshold: number; // Minimum success rate (e.g., 0.70 = 70%)
    };
    validationGateOverBlocking: {
      detected: boolean;
      falsePositiveRate: number; // % of validation failures that are false positives
      blockedValidChanges: number; // Count of valid changes blocked
      retrySuccessRate: number; // Success rate after validation retry
      alertThreshold: number; // Max false positive rate (e.g., 0.30 = 30%)
    };
    aiProviderInstability: {
      detected: boolean;
      errorRate: number; // % of API calls that error
      timeoutRate: number; // % of API calls that timeout
      qualityTrend: number; // Trend in response quality (negative = degrading)
      alertThreshold: number; // Max error rate (e.g., 0.10 = 10%)
    };
    resourceExhaustion: {
      detected: boolean;
      memoryUsageTrend: number; // Trend in memory usage (positive = increasing)
      diskUsageTrend: number; // Trend in disk usage (positive = increasing)
      timeoutRate: number; // Network timeout rate
      alertThreshold: number; // Max resource usage threshold
    };
    phaseProgressionStalling: {
      detected: boolean;
      stalledPhases: string[]; // Phase IDs that are stalled
      avgProgressRate: number; // Tasks completed per hour
      stallDuration: number; // Duration of current stall in minutes
      alertThreshold: number; // Min progress rate (tasks/hour) or max stall duration (minutes)
    };
    patternLearningInefficacy: {
      detected: boolean;
      matchToApplicationRate: number; // % of matched patterns that are applied
      applicationSuccessRate: number; // % of applied patterns that succeed
      recurringPatternRate: number; // % of patterns that recur after matching
      alertThreshold: number; // Min match-to-application rate (e.g., 0.50 = 50%)
    };
    schemaValidationConsistency: {
      detected: boolean;
      falsePositiveRate: number; // % of validation failures that are false positives
      validationTimeTrend: number; // Trend in validation time (positive = increasing)
      inconsistencyRate: number; // % of inconsistent validation results
      alertThreshold: number; // Max false positive rate (e.g., 0.20 = 20%)
    };
  };
}

// Spec-Kit Context Metrics
export interface SpecKitMetrics {
  contextsLoaded: number;
  clarificationsUsed: number;
  researchFindingsUsed: number;
  constitutionRulesApplied: number;
  contextInjections: {
    total: number;
    byCategory: Record<string, number>;  // architecture, integration, etc.
  };
  avgContextSizeChars: number;
  totalContextSizeChars: number;
  designDecisionsApplied: number;
  loadTimeMs: {
    avg: number;
    total: number;
  };
}

export function createDefaultSpecKitMetrics(): SpecKitMetrics {
  return {
    contextsLoaded: 0,
    clarificationsUsed: 0,
    researchFindingsUsed: 0,
    constitutionRulesApplied: 0,
    contextInjections: {
      total: 0,
      byCategory: {},
    },
    avgContextSizeChars: 0,
    totalContextSizeChars: 0,
    designDecisionsApplied: 0,
    loadTimeMs: {
      avg: 0,
      total: 0,
    },
  };
}

// Timing Breakdown
export interface TimingBreakdown {
  jsonParsing: { totalMs: number; avgMs: number; count: number };
  fileFiltering: { totalMs: number; avgMs: number; count: number };
  validation: { totalMs: number; avgMs: number; count: number };
  ipc: { totalMs: number; avgMs: number; count: number };
  aiFallback: { totalMs: number; avgMs: number; count: number };
  contextBuilding: { totalMs: number; avgMs: number; count: number };
  codebaseSearch: { totalMs: number; avgMs: number; count: number };
  fileOperations: { totalMs: number; avgMs: number; count: number };
  sessionManagement: { totalMs: number; avgMs: number; count: number };
}

// Token Breakdown by Feature
export interface TokenBreakdown {
  codeGeneration: { input: number; output: number };
  aiFallback: { input: number; output: number };
  retry: { input: number; output: number };
  errorAnalysis: { input: number; output: number };
}

export interface TestResults {
  total: number;
  passing: number;
  failing: number;
  passRate: number;
  categories?: Record<string, { total: number; passing: number; failing: number }>;
}

export interface PrdMetricsData {
  prdId: string;
  prdVersion: string;
  prdSetId?: string; // Parent PRD set
  startTime: string;
  endTime?: string;
  duration?: number;
  status: 'in-progress' | 'completed' | 'failed';
  phases: {
    total: number;
    completed: number;
    failed: number;
    successRate: number;
    phaseMetrics: PhaseMetricsData[];
  };
  tasks: {
    total: number;
    completed: number;
    failed: number;
    successRate: number;
  };
  tests: {
    total: number;
    passing: number;
    failing: number;
    passRate: number;
  };
  timing: {
    totalMs: number;
    avgPhaseMs: number;
    avgTaskMs: number;
    avgAiCallMs: number;
    avgTestRunMs: number;
    breakdown?: TimingBreakdown;
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
    totalCost?: number;
    byFeature?: TokenBreakdown;
  };
  errors: {
    total: number;
    byCategory: Record<string, number>;
    byType: Record<string, number>;
  };
  efficiency: {
    tokensPerTask: number;
    iterationsPerTask: number;
    avgRetries: number;
  };
  features: {
    used: string[]; // List of PRD features used
    featureMetrics: Record<string, FeatureMetrics>;
  };
  schema: {
    operations: SchemaOperation[];
    schemaMetrics: SchemaMetrics;
  };
  observations: {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    resolutionRate: number;
  };
  patterns: {
    totalMatched: number;
    byType: Record<string, number>;
    effectiveness: number;
    successRate: number;
  };
  // New enhanced metrics
  jsonParsing?: JsonParsingMetrics;
  ipc?: IpcMetrics;
  fileFiltering?: FileFilteringMetrics;
  validation?: ValidationMetrics;
  context?: ContextMetrics;
  codebase?: CodebaseMetrics;
  sessions?: SessionMetrics;
  contributionMode?: ContributionModeMetrics;

  // Code generation metrics (from EventMetricBridge)
  tokensInput?: number;
  tokensOutput?: number;
  codeGenDurationMs?: number;
  filesGenerated?: number;
  codeGenFailures?: number;

  // Test metrics (from EventMetricBridge)
  testsRun?: number;
  testsPassed?: number;
  testsFailed?: number;
  testDurationMs?: number;

  // Task metrics (from EventMetricBridge)
  tasksStarted?: number;
  tasksCompleted?: number;
  tasksSucceeded?: number;
  tasksFailed?: number;
  tasksBlocked?: number;

  // File operation metrics (from EventMetricBridge)
  filesCreated?: number;
  filesModified?: number;
  filesDeleted?: number;

  // Failure analysis metrics (from EventMetricBridge)
  failureAnalyses?: number;
  errorsAnalyzed?: number;
  fixTasksCreated?: number;

  // Pattern learning metrics (from EventMetricBridge)
  patternsLearned?: number;
  patternsByType?: Record<string, number>;
}

// Phase Level
export interface PhaseMetricsData {
  phaseId: number;
  phaseName: string;
  prdId: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  status: 'in-progress' | 'completed' | 'failed';
  tasks: {
    total: number;
    completed: number;
    failed: number;
    successRate: number;
  };
  timing: {
    totalMs: number;
    avgTaskMs: number;
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
  };
  tests: {
    total: number;
    passing: number;
    failing: number;
  };
  parallel: boolean; // Whether phase executed in parallel
  // Phase-level config overlay (merged with PRD config)
  configOverlay?: ConfigOverlay;
}

// Factory functions for creating default empty metrics

export function createDefaultJsonParsingMetrics(): JsonParsingMetrics {
  return {
    totalAttempts: 0,
    successByStrategy: { direct: 0, retry: 0, aiFallback: 0, sanitized: 0 },
    failuresByReason: {},
    avgParsingTimeMs: 0,
    totalParsingTimeMs: 0,
    aiFallbackUsage: {
      triggered: 0,
      succeeded: 0,
      failed: 0,
      avgTimeMs: 0,
      totalTimeMs: 0,
      tokensUsed: { input: 0, output: 0 },
    },
  };
}

export function createDefaultIpcMetrics(): IpcMetrics {
  return {
    connectionsAttempted: 0,
    connectionsSucceeded: 0,
    connectionsFailed: 0,
    healthChecksPerformed: 0,
    healthCheckFailures: 0,
    avgConnectionTimeMs: 0,
    totalConnectionTimeMs: 0,
    retries: 0,
    avgRetryTimeMs: 0,
    totalRetryTimeMs: 0,
  };
}

export function createDefaultFileFilteringMetrics(): FileFilteringMetrics {
  return {
    filesFiltered: 0,
    predictiveFilters: 0,
    boundaryViolations: 0,
    filesAllowed: 0,
    avgFilteringTimeMs: 0,
    totalFilteringTimeMs: 0,
    filterSuggestionsGenerated: 0,
  };
}

export function createDefaultValidationMetrics(): ValidationMetrics {
  return {
    preValidations: 0,
    preValidationFailures: 0,
    postValidations: 0,
    postValidationFailures: 0,
    errorsByCategory: {},
    recoverySuggestionsGenerated: 0,
    avgValidationTimeMs: 0,
    totalValidationTimeMs: 0,
  };
}

export function createDefaultContextMetrics(): ContextMetrics {
  return {
    totalBuilds: 0,
    avgBuildTimeMs: 0,
    totalBuildTimeMs: 0,
    avgContextSizeChars: 0,
    totalContextSizeChars: 0,
    avgFilesIncluded: 0,
    totalFilesIncluded: 0,
    avgFilesTruncated: 0,
    totalFilesTruncated: 0,
    contextWindowUtilization: 0,
    searchOperations: {
      total: 0,
      avgTimeMs: 0,
      totalTimeMs: 0,
      filesFound: 0,
      filesUsed: 0,
      efficiency: 0,
    },
  };
}

export function createDefaultCodebaseMetrics(): CodebaseMetrics {
  return {
    searchOperations: {
      total: 0,
      avgTimeMs: 0,
      totalTimeMs: 0,
      successRate: 0,
      patternsUsed: {},
      filesFound: 0,
      avgFilesPerSearch: 0,
    },
    fileDiscovery: {
      totalDiscoveries: 0,
      avgTimeMs: 0,
      totalTimeMs: 0,
      filesDiscovered: 0,
      patternsMatched: {},
      discoveryStrategies: {},
    },
    fileOperations: {
      reads: 0,
      writes: 0,
      deletes: 0,
      avgReadTimeMs: 0,
      avgWriteTimeMs: 0,
      totalReadTimeMs: 0,
      totalWriteTimeMs: 0,
      errors: 0,
      errorRate: 0,
    },
    indexing: {
      operations: 0,
      avgTimeMs: 0,
      totalTimeMs: 0,
      filesIndexed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheHitRate: 0,
    },
    pathResolution: {
      operations: 0,
      avgTimeMs: 0,
      totalTimeMs: 0,
      resolved: 0,
      failed: 0,
      symlinksEncountered: 0,
    },
  };
}

export function createDefaultSessionMetrics(): SessionMetrics {
  return {
    totalSessions: 0,
    activeSessions: 0,
    avgHistoryEntries: 0,
    maxHistoryEntries: 0,
    minHistoryEntries: 0,
    sessionRotations: 0,
    sessionHealthChecks: 0,
    unhealthySessions: 0,
    sessionPersistence: {
      saves: 0,
      savesFailed: 0,
      loads: 0,
      loadsFailed: 0,
      avgSaveTimeMs: 0,
      avgLoadTimeMs: 0,
      totalSaveTimeMs: 0,
      totalLoadTimeMs: 0,
      successRate: 0,
    },
    historyManagement: {
      prunings: 0,
      summarizations: 0,
      avgPruningTimeMs: 0,
      totalPruningTimeMs: 0,
      entriesRemoved: 0,
      entriesRetained: 0,
    },
    sessionLifespan: {
      avgDurationMs: 0,
      maxDurationMs: 0,
      minDurationMs: 0,
      expiredSessions: 0,
    },
  };
}

export function createDefaultContributionModeMetrics(): ContributionModeMetrics {
  return {
    outerAgentObservations: 0,
    devLoopFixesApplied: 0,
    fixesByCategory: {},
    rootCauseFixes: 0,
    workaroundFixes: 0,
    sessionDuration: 0,
    improvementsIdentified: 0,
    // NEW: Issue detection fields
    issues: {
      moduleConfusion: {
        detected: false,
        filteredFileRate: 0,
        totalFileOperations: 0,
        incidents: [],
        alertThreshold: 0.10, // 10%
      },
      sessionPollution: {
        detected: false,
        sessionsWithMultipleModules: 0,
        incidents: [],
      },
      boundaryViolations: {
        total: 0,
        rate: 0,
        byPattern: {},
        alertThreshold: 0.05, // 5%
      },
      targetModuleContextLoss: {
        detected: false,
        tasksWithoutTargetModule: 0,
        totalTasks: 0,
        rate: 0,
        alertThreshold: 0.01, // 1%
      },
      codeGenerationDegradation: {
        detected: false,
        successRateTrend: 0,
        testPassRateTrend: 0,
        degradationRate: 0,
        alertThreshold: 0.20, // 20% degradation
        trendWindowHours: 24,
      },
      contextWindowInefficiency: {
        detected: false,
        avgContextSize: 0,
        tokensPerSuccess: 0,
        missingFileRate: 0,
        efficiencyRatio: 0,
        alertThreshold: 0.001, // Minimum efficiency ratio
      },
      taskDependencyDeadlock: {
        detected: false,
        blockedTasks: 0,
        circularDependencies: [],
        avgWaitTime: 0,
        alertThreshold: 30, // 30 minutes
      },
      testGenerationQuality: {
        detected: false,
        successRate: 0,
        coverageGap: 0,
        immediateFailureRate: 0,
        alertThreshold: 0.70, // 70%
      },
      validationGateOverBlocking: {
        detected: false,
        falsePositiveRate: 0,
        blockedValidChanges: 0,
        retrySuccessRate: 0,
        alertThreshold: 0.30, // 30%
      },
      aiProviderInstability: {
        detected: false,
        errorRate: 0,
        timeoutRate: 0,
        qualityTrend: 0,
        alertThreshold: 0.10, // 10%
      },
      resourceExhaustion: {
        detected: false,
        memoryUsageTrend: 0,
        diskUsageTrend: 0,
        timeoutRate: 0,
        alertThreshold: 0.80, // 80% resource usage
      },
      phaseProgressionStalling: {
        detected: false,
        stalledPhases: [],
        avgProgressRate: 0,
        stallDuration: 0,
        alertThreshold: 60, // 60 minutes or 0.1 tasks/hour
      },
      patternLearningInefficacy: {
        detected: false,
        matchToApplicationRate: 0,
        applicationSuccessRate: 0,
        recurringPatternRate: 0,
        alertThreshold: 0.50, // 50%
      },
      schemaValidationConsistency: {
        detected: false,
        falsePositiveRate: 0,
        validationTimeTrend: 0,
        inconsistencyRate: 0,
        alertThreshold: 0.20, // 20%
      },
    },
  };
}

export function createDefaultTimingBreakdown(): TimingBreakdown {
  return {
    jsonParsing: { totalMs: 0, avgMs: 0, count: 0 },
    fileFiltering: { totalMs: 0, avgMs: 0, count: 0 },
    validation: { totalMs: 0, avgMs: 0, count: 0 },
    ipc: { totalMs: 0, avgMs: 0, count: 0 },
    aiFallback: { totalMs: 0, avgMs: 0, count: 0 },
    contextBuilding: { totalMs: 0, avgMs: 0, count: 0 },
    codebaseSearch: { totalMs: 0, avgMs: 0, count: 0 },
    fileOperations: { totalMs: 0, avgMs: 0, count: 0 },
    sessionManagement: { totalMs: 0, avgMs: 0, count: 0 },
  };
}

export function createDefaultTokenBreakdown(): TokenBreakdown {
  return {
    codeGeneration: { input: 0, output: 0 },
    aiFallback: { input: 0, output: 0 },
    retry: { input: 0, output: 0 },
    errorAnalysis: { input: 0, output: 0 },
  };
}

// Intervention Metrics
export interface InterventionMetrics {
  totalInterventions: number;
  successfulInterventions: number;
  failedInterventions: number;
  rolledBackInterventions: number;
  successRate: number;
  byIssueType: Record<string, {
    count: number;
    successful: number;
    failed: number;
    rolledBack: number;
    avgFixTimeMs: number;
    effectiveness: number; // success / (success + failed + rolledBack)
  }>;
  byEventType: Record<string, {
    interventions: number;
    preventedIssues: number; // Issues prevented by intervention
    avgPreventionTimeMs: number;
  }>;
  patterns: {
    mostEffectiveStrategies: Array<{ strategy: string; successRate: number }>;
    leastEffectiveStrategies: Array<{ strategy: string; successRate: number }>;
    commonFailureModes: Array<{ issueType: string; failureReason: string; count: number }>;
  };
  timing: {
    avgDetectionTimeMs: number; // Time from event to intervention
    avgFixTimeMs: number; // Time from intervention to fix applied
    avgValidationTimeMs: number; // Time to validate fix effectiveness
    totalTimeMs: number;
  };
  thresholds: {
    exceededCount: number; // Number of times thresholds were exceeded
    preventedCount: number; // Number of issues prevented by interventions
    falsePositives: number; // Interventions that weren't needed
  };
}export function createDefaultInterventionMetrics(): InterventionMetrics {
  return {
    totalInterventions: 0,
    successfulInterventions: 0,
    failedInterventions: 0,
    rolledBackInterventions: 0,
    successRate: 0,
    byIssueType: {},
    byEventType: {},
    patterns: {
      mostEffectiveStrategies: [],
      leastEffectiveStrategies: [],
      commonFailureModes: [],
    },
    timing: {
      avgDetectionTimeMs: 0,
      avgFixTimeMs: 0,
      avgValidationTimeMs: 0,
      totalTimeMs: 0,
    },
    thresholds: {
      exceededCount: 0,
      preventedCount: 0,
      falsePositives: 0,
    },
  };
}
