/**
 * Hierarchical Metrics System
 *
 * Tracks metrics at multiple levels:
 * - PRD Set Level: Aggregates metrics across all PRDs in a set
 * - PRD Level: Aggregates metrics across all phases in a PRD
 * - Phase Level: Aggregates metrics across all tasks in a phase
 * - Task Level: Individual task execution metrics (existing)
 */

import { RunMetrics } from './debug-metrics';
import type { ConfigOverlay } from '../config/schema';

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
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
    totalCost?: number;
  };
  tests: {
    total: number;
    passing: number;
    failing: number;
    passRate: number;
  };
  prdIds: string[]; // List of PRD IDs in this set
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
  };
  tokens: {
    totalInput: number;
    totalOutput: number;
    totalCost?: number;
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

