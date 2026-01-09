/**
 * PRD Set Level Metrics
 *
 * Tracks metrics for PRD set execution, aggregating across all PRDs in the set.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  PrdSetMetricsData,
  PrdMetricsData,
  JsonParsingMetrics,
  IpcMetrics,
  FileFilteringMetrics,
  ValidationMetrics,
  ContextMetrics,
  CodebaseMetrics,
  SessionMetrics,
  ContributionModeMetrics,
  TimingBreakdown,
  TokenBreakdown,
  createDefaultJsonParsingMetrics,
  createDefaultIpcMetrics,
  createDefaultFileFilteringMetrics,
  createDefaultValidationMetrics,
  createDefaultContextMetrics,
  createDefaultCodebaseMetrics,
  createDefaultSessionMetrics,
  createDefaultContributionModeMetrics,
  createDefaultTimingBreakdown,
  createDefaultTokenBreakdown,
} from "./types";
import type { ConfigOverlay } from '../../config/schema';
import { logger } from '../utils/logger';

export interface PrdSetMetadata {
  setId: string;
  prdPaths: string[];
  startTime?: string;
  // Config overlay for the entire PRD set (merged with project config)
  configOverlay?: ConfigOverlay;
}

export class PrdSetMetrics {
  private metricsPath: string;
  private metrics: Map<string, PrdSetMetricsData> = new Map();

  constructor(metricsPath: string = '.devloop/prd-set-metrics.json') {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.loadMetrics();
  }

  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          data.forEach((metric: PrdSetMetricsData) => {
            this.metrics.set(metric.setId, this.normalizeMetric(metric));
          });
        } else if (typeof data === 'object') {
          // Support both array and object formats
          Object.values(data).forEach((metric: any) => {
            if (metric.setId) {
              this.metrics.set(metric.setId, this.normalizeMetric(metric));
            }
          });
        }
      }
    } catch (error) {
      logger.warn(`[PrdSetMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Normalize a metric object to ensure all required fields exist
   */
  private normalizeMetric(metric: Partial<PrdSetMetricsData>): PrdSetMetricsData {
    return {
      setId: metric.setId || 'unknown',
      startTime: metric.startTime || new Date().toISOString(),
      endTime: metric.endTime,
      status: metric.status || 'in-progress',
      duration: metric.duration,
      prds: {
        total: metric.prds?.total || 0,
        completed: metric.prds?.completed || 0,
        failed: metric.prds?.failed || 0,
        blocked: metric.prds?.blocked || 0,
        successRate: metric.prds?.successRate || 0,
      },
      executionLevels: {
        total: metric.executionLevels?.total || 0,
        current: metric.executionLevels?.current || 0,
        completed: metric.executionLevels?.completed || 0,
      },
      timing: {
        totalMs: metric.timing?.totalMs || 0,
        avgPrdMs: metric.timing?.avgPrdMs || 0,
        avgTaskMs: metric.timing?.avgTaskMs || 0,
      },
      tokens: {
        totalInput: metric.tokens?.totalInput || 0,
        totalOutput: metric.tokens?.totalOutput || 0,
        totalCost: metric.tokens?.totalCost,
      },
      tests: {
        total: metric.tests?.total || 0,
        passing: metric.tests?.passing || 0,
        failing: metric.tests?.failing || 0,
        passRate: metric.tests?.passRate || 0,
      },
      prdIds: metric.prdIds || [],
    };
  }

  private saveMetrics(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      const data = Array.from(this.metrics.values());
      fs.writeFileSync(this.metricsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[PrdSetMetrics] Failed to save metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  startPrdSetExecution(setId: string, prdSetMetadata: PrdSetMetadata): void {
    const metric: PrdSetMetricsData = {
      setId,
      startTime: new Date().toISOString(),
      status: 'in-progress',
      prds: {
        total: prdSetMetadata.prdPaths.length,
        completed: 0,
        failed: 0,
        blocked: 0,
        successRate: 0,
      },
      executionLevels: {
        total: 0,
        current: 0,
        completed: 0,
      },
      timing: {
        totalMs: 0,
        avgPrdMs: 0,
        avgTaskMs: 0,
      },
      tokens: {
        totalInput: 0,
        totalOutput: 0,
      },
      tests: {
        total: 0,
        passing: 0,
        failing: 0,
        passRate: 0,
      },
      prdIds: [],
    };

    this.metrics.set(setId, metric);
    this.saveMetrics();
  }

  recordPrdCompletion(prdId: string, metrics: PrdMetricsData): void {
    // Find the PRD set that contains this PRD
    for (const [setId, setMetric] of this.metrics.entries()) {
      if (setMetric.prdIds.includes(prdId) || metrics.prdSetId === setId) {
        // Update PRD counts
        if (metrics.status === 'completed') {
          setMetric.prds.completed++;
        } else if (metrics.status === 'failed') {
          setMetric.prds.failed++;
        }

        // Update timing
        if (metrics.duration) {
          setMetric.timing.totalMs += metrics.duration;
          setMetric.timing.avgPrdMs = setMetric.timing.totalMs / (setMetric.prds.completed + setMetric.prds.failed);
        }

        // Update tokens (with null checks)
        if (metrics.tokens) {
          setMetric.tokens.totalInput += metrics.tokens.totalInput || 0;
          setMetric.tokens.totalOutput += metrics.tokens.totalOutput || 0;
          if (metrics.tokens.totalCost) {
            setMetric.tokens.totalCost = (setMetric.tokens.totalCost || 0) + metrics.tokens.totalCost;
          }
        }

        // Update tests (with null checks)
        if (metrics.tests) {
          setMetric.tests.total += metrics.tests.total || 0;
          setMetric.tests.passing += metrics.tests.passing || 0;
          setMetric.tests.failing += metrics.tests.failing || 0;
          setMetric.tests.passRate = setMetric.tests.total > 0
            ? setMetric.tests.passing / setMetric.tests.total
            : 0;
        }

        // Update success rate
        const totalProcessed = setMetric.prds.completed + setMetric.prds.failed + setMetric.prds.blocked;
        setMetric.prds.successRate = totalProcessed > 0
          ? setMetric.prds.completed / totalProcessed
          : 0;

        // Ensure PRD ID is in the list
        if (!setMetric.prdIds.includes(prdId)) {
          setMetric.prdIds.push(prdId);
        }

        this.saveMetrics();
        break;
      }
    }
  }

  completePrdSetExecution(setId: string, status: 'completed' | 'failed' | 'blocked'): void {
    const metric = this.metrics.get(setId);
    if (!metric) {
      logger.warn(`[PrdSetMetrics] Cannot complete PRD set ${setId}: not found`);
      return;
    }

    metric.endTime = new Date().toISOString();
    metric.status = status;

    if (metric.startTime) {
      const start = new Date(metric.startTime);
      const end = new Date(metric.endTime);
      metric.duration = end.getTime() - start.getTime();
    }

    // Aggregate tokens from individual runs if not already aggregated
    this.aggregateTokensFromRuns(setId);

    // Calculate final statistics
    this.calculateFinalStatistics(setId);

    this.saveMetrics();

    logger.info(`[PrdSetMetrics] PRD set ${setId} finalized with status: ${status}`);

    // Emit metrics finalized event
    try {
      const { emitEvent } = require('./event-stream');
      emitEvent('metrics:finalized', {
        setId,
        status,
        duration: metric.duration,
        prdsCompleted: metric.prds.completed,
        prdsTotal: metric.prds.total,
        successRate: metric.prds.successRate,
        totalTokens: (metric.tokens.totalInput || 0) + (metric.tokens.totalOutput || 0),
      }, { severity: 'info' });
    } catch {
      // Event stream not available
    }
  }

  /**
   * Aggregate tokens from individual run metrics filtered by PRD set
   */
  aggregateTokensFromRuns(setId: string): void {
    const metric = this.metrics.get(setId);
    if (!metric) return;

    try {
      const fs = require('fs-extra');
      const path = require('path');

      // Load individual run metrics
      const metricsPath = path.resolve(process.cwd(), '.devloop/metrics.json');
      if (!fs.existsSync(metricsPath)) return;

      const metricsData = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
      const runs = metricsData.runs || [];

      // Filter runs within the PRD set execution time range
      const startTime = metric.startTime ? new Date(metric.startTime).getTime() : 0;
      const endTime = metric.endTime ? new Date(metric.endTime).getTime() : Date.now();

      let totalInput = 0;
      let totalOutput = 0;
      let runCount = 0;

      for (const run of runs) {
        if (!run.timestamp) continue;

        const runTime = new Date(run.timestamp).getTime();
        if (runTime >= startTime && runTime <= endTime) {
          totalInput += run.tokens?.input || 0;
          totalOutput += run.tokens?.output || 0;
          runCount++;
        }
      }

      // Only update if we found runs and current values are zero
      if (runCount > 0 && metric.tokens.totalInput === 0) {
        metric.tokens.totalInput = totalInput;
        metric.tokens.totalOutput = totalOutput;

        // Estimate cost (assuming GPT-4 pricing)
        const inputCost = totalInput * 0.00003; // $0.03 per 1K input tokens
        const outputCost = totalOutput * 0.00006; // $0.06 per 1K output tokens
        metric.tokens.totalCost = inputCost + outputCost;

        logger.debug(`[PrdSetMetrics] Aggregated tokens from ${runCount} runs: ${totalInput} input, ${totalOutput} output`);

        // Emit aggregation event
        try {
          const { emitEvent } = require('./event-stream');
          emitEvent('metrics:aggregated', {
            setId,
            runsProcessed: runCount,
            totalInput,
            totalOutput,
            estimatedCost: metric.tokens.totalCost,
          }, { severity: 'info' });
        } catch {
          // Event stream not available
        }
      }
    } catch (error) {
      logger.warn(`[PrdSetMetrics] Failed to aggregate tokens: ${error}`);
    }
  }

  /**
   * Calculate final statistics for PRD set
   */
  private calculateFinalStatistics(setId: string): void {
    const metric = this.metrics.get(setId);
    if (!metric) return;

    // Calculate success rate
    const totalProcessed = metric.prds.completed + metric.prds.failed + metric.prds.blocked;
    metric.prds.successRate = totalProcessed > 0
      ? metric.prds.completed / totalProcessed
      : 0;

    // Calculate average timing
    if (totalProcessed > 0 && metric.timing.totalMs > 0) {
      metric.timing.avgPrdMs = metric.timing.totalMs / totalProcessed;
    }

    // Calculate test pass rate
    if (metric.tests.total > 0) {
      metric.tests.passRate = metric.tests.passing / metric.tests.total;
    }

    // Log summary
    logger.info(`[PrdSetMetrics] Final stats for ${setId}:`);
    logger.info(`  PRDs: ${metric.prds.completed}/${metric.prds.total} completed (${(metric.prds.successRate * 100).toFixed(1)}% success)`);
    logger.info(`  Tokens: ${metric.tokens.totalInput} input, ${metric.tokens.totalOutput} output`);
    logger.info(`  Duration: ${metric.duration ? (metric.duration / 1000 / 60).toFixed(1) : 'N/A'} minutes`);
  }

  getPrdSetMetrics(setId: string): PrdSetMetricsData | undefined {
    return this.metrics.get(setId);
  }

  getAllPrdSetMetrics(): PrdSetMetricsData[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Finalize any in-progress PRD sets (called on startup or cleanup)
   */
  finalizeInProgressSets(): void {
    for (const [setId, metric] of this.metrics.entries()) {
      if (metric.status === 'in-progress') {
        // Check if this set has been inactive for more than 1 hour
        const lastActivity = metric.endTime || metric.startTime;
        if (lastActivity) {
          const inactiveMs = Date.now() - new Date(lastActivity).getTime();
          const oneHour = 60 * 60 * 1000;

          if (inactiveMs > oneHour) {
            logger.warn(`[PrdSetMetrics] Finalizing stale PRD set ${setId} (inactive for ${(inactiveMs / 1000 / 60).toFixed(0)} minutes)`);
            this.completePrdSetExecution(setId, 'blocked');
          }
        }
      }
    }
  }

  /**
   * Get aggregated metrics summary for reporting
   */
  getMetricsSummary(): {
    totalSets: number;
    completedSets: number;
    failedSets: number;
    totalTokensUsed: number;
    estimatedCost: number;
    averageSuccessRate: number;
  } {
    const allMetrics = this.getAllPrdSetMetrics();
    let totalTokensUsed = 0;
    let estimatedCost = 0;
    let successRateSum = 0;
    let completedSets = 0;
    let failedSets = 0;

    for (const metric of allMetrics) {
      totalTokensUsed += (metric.tokens.totalInput || 0) + (metric.tokens.totalOutput || 0);
      estimatedCost += metric.tokens.totalCost || 0;
      successRateSum += metric.prds.successRate;

      if (metric.status === 'completed') completedSets++;
      else if (metric.status === 'failed') failedSets++;
    }

    return {
      totalSets: allMetrics.length,
      completedSets,
      failedSets,
      totalTokensUsed,
      estimatedCost,
      averageSuccessRate: allMetrics.length > 0 ? successRateSum / allMetrics.length : 0,
    };
  }

  /**
   * Aggregate enhanced metrics from PRD metrics into PRD set metrics
   */
  aggregateEnhancedMetrics(setId: string, prdMetrics: PrdMetricsData[]): void {
    const metric = this.metrics.get(setId);
    if (!metric) return;

    // Initialize enhanced metrics if not present
    if (!metric.jsonParsing) metric.jsonParsing = createDefaultJsonParsingMetrics();
    if (!metric.ipc) metric.ipc = createDefaultIpcMetrics();
    if (!metric.fileFiltering) metric.fileFiltering = createDefaultFileFilteringMetrics();
    if (!metric.validation) metric.validation = createDefaultValidationMetrics();
    if (!metric.context) metric.context = createDefaultContextMetrics();
    if (!metric.codebase) metric.codebase = createDefaultCodebaseMetrics();
    if (!metric.sessions) metric.sessions = createDefaultSessionMetrics();
    if (!metric.contributionMode) metric.contributionMode = createDefaultContributionModeMetrics();
    if (!metric.timing.breakdown) metric.timing.breakdown = createDefaultTimingBreakdown();
    if (!metric.tokens.byFeature) metric.tokens.byFeature = createDefaultTokenBreakdown();

    for (const prd of prdMetrics) {
      // Aggregate JSON parsing metrics
      if (prd.jsonParsing) {
        this.aggregateJsonParsing(metric.jsonParsing, prd.jsonParsing);
      }

      // Aggregate IPC metrics
      if (prd.ipc) {
        this.aggregateIpc(metric.ipc, prd.ipc);
      }

      // Aggregate file filtering metrics
      if (prd.fileFiltering) {
        this.aggregateFileFiltering(metric.fileFiltering, prd.fileFiltering);
      }

      // Aggregate validation metrics
      if (prd.validation) {
        this.aggregateValidation(metric.validation, prd.validation);
      }

      // Aggregate context metrics
      if (prd.context) {
        this.aggregateContext(metric.context, prd.context);
      }

      // Aggregate codebase metrics
      if (prd.codebase) {
        this.aggregateCodebase(metric.codebase, prd.codebase);
      }

      // Aggregate session metrics
      if (prd.sessions) {
        this.aggregateSessions(metric.sessions, prd.sessions);
      }

      // Aggregate contribution mode metrics
      if (prd.contributionMode) {
        this.aggregateContributionMode(metric.contributionMode, prd.contributionMode);
      }

      // Aggregate timing breakdown
      if (prd.timing.breakdown) {
        this.aggregateTimingBreakdown(metric.timing.breakdown, prd.timing.breakdown);
      }

      // Aggregate token breakdown
      if (prd.tokens.byFeature) {
        this.aggregateTokenBreakdown(metric.tokens.byFeature, prd.tokens.byFeature);
      }
    }

    this.saveMetrics();
  }

  private aggregateJsonParsing(target: JsonParsingMetrics, source: JsonParsingMetrics): void {
    target.totalAttempts += source.totalAttempts;
    target.successByStrategy.direct += source.successByStrategy.direct;
    target.successByStrategy.retry += source.successByStrategy.retry;
    target.successByStrategy.aiFallback += source.successByStrategy.aiFallback;
    target.successByStrategy.sanitized += source.successByStrategy.sanitized;

    for (const [reason, count] of Object.entries(source.failuresByReason)) {
      target.failuresByReason[reason] = (target.failuresByReason[reason] || 0) + count;
    }

    target.totalParsingTimeMs += source.totalParsingTimeMs;
    target.avgParsingTimeMs = target.totalAttempts > 0 ? target.totalParsingTimeMs / target.totalAttempts : 0;

    target.aiFallbackUsage.triggered += source.aiFallbackUsage.triggered;
    target.aiFallbackUsage.succeeded += source.aiFallbackUsage.succeeded;
    target.aiFallbackUsage.failed += source.aiFallbackUsage.failed;
    target.aiFallbackUsage.totalTimeMs += source.aiFallbackUsage.totalTimeMs;
    target.aiFallbackUsage.avgTimeMs = target.aiFallbackUsage.triggered > 0
      ? target.aiFallbackUsage.totalTimeMs / target.aiFallbackUsage.triggered : 0;
    target.aiFallbackUsage.tokensUsed.input += source.aiFallbackUsage.tokensUsed.input;
    target.aiFallbackUsage.tokensUsed.output += source.aiFallbackUsage.tokensUsed.output;
  }

  private aggregateIpc(target: IpcMetrics, source: IpcMetrics): void {
    target.connectionsAttempted += source.connectionsAttempted;
    target.connectionsSucceeded += source.connectionsSucceeded;
    target.connectionsFailed += source.connectionsFailed;
    target.healthChecksPerformed += source.healthChecksPerformed;
    target.healthCheckFailures += source.healthCheckFailures;
    target.totalConnectionTimeMs += source.totalConnectionTimeMs;
    target.avgConnectionTimeMs = target.connectionsAttempted > 0
      ? target.totalConnectionTimeMs / target.connectionsAttempted : 0;
    target.retries += source.retries;
    target.totalRetryTimeMs += source.totalRetryTimeMs;
    target.avgRetryTimeMs = target.retries > 0 ? target.totalRetryTimeMs / target.retries : 0;
  }

  private aggregateFileFiltering(target: FileFilteringMetrics, source: FileFilteringMetrics): void {
    target.filesFiltered += source.filesFiltered;
    target.predictiveFilters += source.predictiveFilters;
    target.boundaryViolations += source.boundaryViolations;
    target.filesAllowed += source.filesAllowed;
    target.totalFilteringTimeMs += source.totalFilteringTimeMs;
    const totalOps = target.filesFiltered + target.filesAllowed;
    target.avgFilteringTimeMs = totalOps > 0 ? target.totalFilteringTimeMs / totalOps : 0;
    target.filterSuggestionsGenerated += source.filterSuggestionsGenerated;
  }

  private aggregateValidation(target: ValidationMetrics, source: ValidationMetrics): void {
    target.preValidations += source.preValidations;
    target.preValidationFailures += source.preValidationFailures;
    target.postValidations += source.postValidations;
    target.postValidationFailures += source.postValidationFailures;
    target.totalValidationTimeMs += source.totalValidationTimeMs;
    const totalValidations = target.preValidations + target.postValidations;
    target.avgValidationTimeMs = totalValidations > 0 ? target.totalValidationTimeMs / totalValidations : 0;

    for (const [category, count] of Object.entries(source.errorsByCategory)) {
      target.errorsByCategory[category] = (target.errorsByCategory[category] || 0) + count;
    }

    target.recoverySuggestionsGenerated += source.recoverySuggestionsGenerated;
  }

  private aggregateContext(target: ContextMetrics, source: ContextMetrics): void {
    target.totalBuilds += source.totalBuilds;
    target.totalBuildTimeMs += source.totalBuildTimeMs;
    target.avgBuildTimeMs = target.totalBuilds > 0 ? target.totalBuildTimeMs / target.totalBuilds : 0;
    target.totalContextSizeChars += source.totalContextSizeChars;
    target.avgContextSizeChars = target.totalBuilds > 0 ? target.totalContextSizeChars / target.totalBuilds : 0;
    target.totalFilesIncluded += source.totalFilesIncluded;
    target.avgFilesIncluded = target.totalBuilds > 0 ? target.totalFilesIncluded / target.totalBuilds : 0;
    target.totalFilesTruncated += source.totalFilesTruncated;
    target.avgFilesTruncated = target.totalBuilds > 0 ? target.totalFilesTruncated / target.totalBuilds : 0;

    target.searchOperations.total += source.searchOperations.total;
    target.searchOperations.totalTimeMs += source.searchOperations.totalTimeMs;
    target.searchOperations.avgTimeMs = target.searchOperations.total > 0
      ? target.searchOperations.totalTimeMs / target.searchOperations.total : 0;
    target.searchOperations.filesFound += source.searchOperations.filesFound;
    target.searchOperations.filesUsed += source.searchOperations.filesUsed;
    target.searchOperations.efficiency = target.searchOperations.filesFound > 0
      ? target.searchOperations.filesUsed / target.searchOperations.filesFound : 0;
  }

  private aggregateCodebase(target: CodebaseMetrics, source: CodebaseMetrics): void {
    // Search operations
    target.searchOperations.total += source.searchOperations.total;
    target.searchOperations.totalTimeMs += source.searchOperations.totalTimeMs;
    target.searchOperations.avgTimeMs = target.searchOperations.total > 0
      ? target.searchOperations.totalTimeMs / target.searchOperations.total : 0;
    target.searchOperations.filesFound += source.searchOperations.filesFound;
    target.searchOperations.avgFilesPerSearch = target.searchOperations.total > 0
      ? target.searchOperations.filesFound / target.searchOperations.total : 0;

    for (const [pattern, count] of Object.entries(source.searchOperations.patternsUsed)) {
      target.searchOperations.patternsUsed[pattern] = (target.searchOperations.patternsUsed[pattern] || 0) + count;
    }

    // File discovery
    target.fileDiscovery.totalDiscoveries += source.fileDiscovery.totalDiscoveries;
    target.fileDiscovery.totalTimeMs += source.fileDiscovery.totalTimeMs;
    target.fileDiscovery.avgTimeMs = target.fileDiscovery.totalDiscoveries > 0
      ? target.fileDiscovery.totalTimeMs / target.fileDiscovery.totalDiscoveries : 0;
    target.fileDiscovery.filesDiscovered += source.fileDiscovery.filesDiscovered;

    // File operations
    target.fileOperations.reads += source.fileOperations.reads;
    target.fileOperations.writes += source.fileOperations.writes;
    target.fileOperations.deletes += source.fileOperations.deletes;
    target.fileOperations.totalReadTimeMs += source.fileOperations.totalReadTimeMs;
    target.fileOperations.totalWriteTimeMs += source.fileOperations.totalWriteTimeMs;
    target.fileOperations.avgReadTimeMs = target.fileOperations.reads > 0
      ? target.fileOperations.totalReadTimeMs / target.fileOperations.reads : 0;
    target.fileOperations.avgWriteTimeMs = target.fileOperations.writes > 0
      ? target.fileOperations.totalWriteTimeMs / target.fileOperations.writes : 0;
    target.fileOperations.errors += source.fileOperations.errors;
    const totalFileOps = target.fileOperations.reads + target.fileOperations.writes + target.fileOperations.deletes;
    target.fileOperations.errorRate = totalFileOps > 0 ? target.fileOperations.errors / totalFileOps : 0;

    // Indexing
    target.indexing.operations += source.indexing.operations;
    target.indexing.totalTimeMs += source.indexing.totalTimeMs;
    target.indexing.avgTimeMs = target.indexing.operations > 0
      ? target.indexing.totalTimeMs / target.indexing.operations : 0;
    target.indexing.filesIndexed += source.indexing.filesIndexed;
    target.indexing.cacheHits += source.indexing.cacheHits;
    target.indexing.cacheMisses += source.indexing.cacheMisses;
    const totalCacheOps = target.indexing.cacheHits + target.indexing.cacheMisses;
    target.indexing.cacheHitRate = totalCacheOps > 0 ? target.indexing.cacheHits / totalCacheOps : 0;

    // Path resolution
    target.pathResolution.operations += source.pathResolution.operations;
    target.pathResolution.totalTimeMs += source.pathResolution.totalTimeMs;
    target.pathResolution.avgTimeMs = target.pathResolution.operations > 0
      ? target.pathResolution.totalTimeMs / target.pathResolution.operations : 0;
    target.pathResolution.resolved += source.pathResolution.resolved;
    target.pathResolution.failed += source.pathResolution.failed;
    target.pathResolution.symlinksEncountered += source.pathResolution.symlinksEncountered;
  }

  private aggregateSessions(target: SessionMetrics, source: SessionMetrics): void {
    target.totalSessions += source.totalSessions;
    target.activeSessions = source.activeSessions; // Use latest value
    target.sessionRotations += source.sessionRotations;
    target.sessionHealthChecks += source.sessionHealthChecks;
    target.unhealthySessions += source.unhealthySessions;

    // Update max/min history entries
    if (source.maxHistoryEntries > target.maxHistoryEntries) {
      target.maxHistoryEntries = source.maxHistoryEntries;
    }
    if (source.minHistoryEntries > 0 && (target.minHistoryEntries === 0 || source.minHistoryEntries < target.minHistoryEntries)) {
      target.minHistoryEntries = source.minHistoryEntries;
    }

    // Session persistence
    target.sessionPersistence.saves += source.sessionPersistence.saves;
    target.sessionPersistence.savesFailed += source.sessionPersistence.savesFailed;
    target.sessionPersistence.loads += source.sessionPersistence.loads;
    target.sessionPersistence.loadsFailed += source.sessionPersistence.loadsFailed;
    target.sessionPersistence.totalSaveTimeMs += source.sessionPersistence.totalSaveTimeMs;
    target.sessionPersistence.totalLoadTimeMs += source.sessionPersistence.totalLoadTimeMs;
    target.sessionPersistence.avgSaveTimeMs = target.sessionPersistence.saves > 0
      ? target.sessionPersistence.totalSaveTimeMs / target.sessionPersistence.saves : 0;
    target.sessionPersistence.avgLoadTimeMs = target.sessionPersistence.loads > 0
      ? target.sessionPersistence.totalLoadTimeMs / target.sessionPersistence.loads : 0;

    // History management
    target.historyManagement.prunings += source.historyManagement.prunings;
    target.historyManagement.summarizations += source.historyManagement.summarizations;
    target.historyManagement.totalPruningTimeMs += source.historyManagement.totalPruningTimeMs;
    target.historyManagement.avgPruningTimeMs = target.historyManagement.prunings > 0
      ? target.historyManagement.totalPruningTimeMs / target.historyManagement.prunings : 0;
    target.historyManagement.entriesRemoved += source.historyManagement.entriesRemoved;
    target.historyManagement.entriesRetained += source.historyManagement.entriesRetained;

    // Session lifespan
    target.sessionLifespan.expiredSessions += source.sessionLifespan.expiredSessions;
    if (source.sessionLifespan.maxDurationMs > target.sessionLifespan.maxDurationMs) {
      target.sessionLifespan.maxDurationMs = source.sessionLifespan.maxDurationMs;
    }
    if (source.sessionLifespan.minDurationMs > 0 &&
      (target.sessionLifespan.minDurationMs === 0 || source.sessionLifespan.minDurationMs < target.sessionLifespan.minDurationMs)) {
      target.sessionLifespan.minDurationMs = source.sessionLifespan.minDurationMs;
    }
  }

  private aggregateContributionMode(target: ContributionModeMetrics, source: ContributionModeMetrics): void {
    target.outerAgentObservations += source.outerAgentObservations;
    target.devLoopFixesApplied += source.devLoopFixesApplied;
    target.rootCauseFixes += source.rootCauseFixes;
    target.workaroundFixes += source.workaroundFixes;
    target.improvementsIdentified += source.improvementsIdentified;
    target.sessionDuration = source.sessionDuration; // Use latest

    for (const [category, count] of Object.entries(source.fixesByCategory)) {
      target.fixesByCategory[category] = (target.fixesByCategory[category] || 0) + count;
    }
  }

  private aggregateTimingBreakdown(target: TimingBreakdown, source: TimingBreakdown): void {
    const categories: (keyof TimingBreakdown)[] = [
      'jsonParsing', 'fileFiltering', 'validation', 'ipc', 'aiFallback',
      'contextBuilding', 'codebaseSearch', 'fileOperations', 'sessionManagement'
    ];

    for (const category of categories) {
      target[category].totalMs += source[category].totalMs;
      target[category].count += source[category].count;
      target[category].avgMs = target[category].count > 0
        ? target[category].totalMs / target[category].count : 0;
    }
  }

  private aggregateTokenBreakdown(target: TokenBreakdown, source: TokenBreakdown): void {
    const features: (keyof TokenBreakdown)[] = ['codeGeneration', 'aiFallback', 'retry', 'errorAnalysis'];

    for (const feature of features) {
      target[feature].input += source[feature].input;
      target[feature].output += source[feature].output;
    }
  }

  /**
   * Get enhanced metrics for a PRD set
   */
  getEnhancedMetrics(setId: string): {
    jsonParsing?: JsonParsingMetrics;
    ipc?: IpcMetrics;
    fileFiltering?: FileFilteringMetrics;
    validation?: ValidationMetrics;
    context?: ContextMetrics;
    codebase?: CodebaseMetrics;
    sessions?: SessionMetrics;
    contributionMode?: ContributionModeMetrics;
    timingBreakdown?: TimingBreakdown;
    tokenBreakdown?: TokenBreakdown;
  } | null {
    const metric = this.metrics.get(setId);
    if (!metric) return null;

    return {
      jsonParsing: metric.jsonParsing,
      ipc: metric.ipc,
      fileFiltering: metric.fileFiltering,
      validation: metric.validation,
      context: metric.context,
      codebase: metric.codebase,
      sessions: metric.sessions,
      contributionMode: metric.contributionMode,
      timingBreakdown: metric.timing.breakdown,
      tokenBreakdown: metric.tokens.byFeature,
    };
  }
}

