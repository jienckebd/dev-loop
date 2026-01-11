/**
 * Learning Data Types
 *
 * Shared types and schemas for patterns, observations, and test results.
 * Version 2.0 includes versioning fields to prevent stale data interference.
 */

/**
 * Pattern Entry (v2.0)
 */
export interface PatternEntry {
  id: string; // Unique pattern ID
  createdAt: string; // ISO timestamp
  lastUsedAt: string; // ISO timestamp (updated when pattern is used)
  relevanceScore: number; // 0-1, default: 1.0
  expiresAt?: string | null; // ISO timestamp (optional, null if doesn't expire)
  prdId?: string; // Optional, PRD ID where pattern was learned
  framework?: string; // Optional, framework type: 'drupal', 'react', etc.
  category: string; // e.g., 'schema', 'test', 'feature', 'error-pattern'
  pattern: string; // The actual pattern/text
  examples?: string[]; // Optional, example uses
  metadata?: Record<string, any>; // Optional, additional context
}

/**
 * Patterns File Schema (v2.0)
 */
export interface PatternsFile {
  version: string; // "2.0"
  updatedAt: string; // ISO timestamp
  patterns: PatternEntry[];
}

/**
 * Observation Entry (v2.0)
 */
export interface ObservationEntry {
  id: string; // Unique observation ID
  createdAt: string; // ISO timestamp
  relevanceScore: number; // 0-1, default: 1.0
  expiresAt?: string | null; // ISO timestamp (optional, null if doesn't expire)
  prdId: string; // PRD ID where observation was made
  phaseId?: number; // Optional, phase ID where observation was made
  category: string; // e.g., 'error', 'success', 'pattern', 'recommendation'
  observation: string; // The observation text
  context?: Record<string, any>; // Optional, additional context about the observation
  metadata?: Record<string, any>; // Optional, additional metadata
}

/**
 * Observations File Schema (v2.0)
 */
export interface ObservationsFile {
  version: string; // "2.0"
  updatedAt: string; // ISO timestamp
  observations: ObservationEntry[];
}

/**
 * Test Result Execution Entry
 * (Already has timestamp, executionId, prdId, phaseId - ensure schema is consistent)
 */
export interface TestResultExecution {
  executionId: string;
  prdId: string;
  phaseId: number;
  timestamp: string; // ISO timestamp
  total: number;
  passing: number;
  failing: number;
  skipped: number;
  duration: number; // milliseconds
  tests: any[]; // Test details
  flaky: boolean;
  status?: 'passing' | 'failing' | 'flaky'; // Optional, derived from results
  framework?: string; // Optional, application framework (e.g., 'drupal')
  testFramework?: string; // Optional, test framework (e.g., 'playwright')
}

/**
 * Test Results File Schema
 */
export interface TestResultsFile {
  version: string; // "1.0" or "2.0"
  executions: TestResultExecution[];
}

/**
 * PRD State Entry
 */
export interface PrdStateEntry {
  prdId: string;
  status: 'pending' | 'running' | 'done' | 'cancelled' | 'failed';
  completedPhases: number[];
  createdAt: string; // ISO timestamp (required)
  updatedAt: string; // ISO timestamp (required)
  cancelledAt?: string; // ISO timestamp (optional)
  completedAt?: string; // ISO timestamp (optional)
  lastPhaseId?: number; // Optional, last phase ID executed
}

/**
 * PRD Set State File Schema
 */
export interface PrdSetStateFile {
  prdStates: Record<string, PrdStateEntry>;
  sharedState: Record<string, any>;
}

/**
 * Filtering Options for Loaders
 */
export interface LearningFileFilterOptions {
  retentionDays?: number; // Keep entries from last N days (default varies by loader)
  relevanceThreshold?: number; // Minimum relevance score 0-1 (default: 0.5)
  prdId?: string; // Optional, filter by PRD ID
  phaseId?: number; // Optional, filter by phase ID
  framework?: string; // Optional, filter by framework type
  excludeExpired?: boolean; // Exclude entries with expiresAt in past (default: true)
  autoPrune?: boolean; // Auto-prune old entries when loading (default: true)
}

/**
 * Pattern Loader Filter Options (extends base with pattern-specific)
 */
export interface PatternFilterOptions extends LearningFileFilterOptions {
  lastUsedDays?: number; // Only load patterns used in last N days (default: 90)
  category?: string; // Optional, filter by category
}

/**
 * Observation Loader Filter Options (extends base)
 */
export interface ObservationFilterOptions extends LearningFileFilterOptions {
  category?: string; // Optional, filter by category
}

/**
 * Test Results Loader Filter Options (extends base)
 */
export interface TestResultsFilterOptions extends LearningFileFilterOptions {
  status?: ('passing' | 'failing' | 'flaky')[]; // Optional, filter by status
  prdStatus?: ('done' | 'failed' | 'cancelled' | 'running' | 'pending')[]; // Optional, filter by PRD status
}
