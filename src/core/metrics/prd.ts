/**
 * PRD Level Metrics
 *
 * Tracks metrics for PRD execution, aggregating across all phases in the PRD.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import {
  PrdMetricsData,
  PrdMetadata,
  PhaseMetricsData,
  FeatureMetrics,
  SchemaOperation,
  SchemaMetrics,
  TestResults,
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
import { RunMetrics } from "./debug";
import { CostCalculator } from '../utils/cost-calculator';
import { TestExecutionResult } from '../testing/executor';
import { logger } from '../utils/logger';

export class PrdMetrics {
  private metricsPath: string;
  private metrics: Map<string, PrdMetricsData> = new Map();
  private costCalculator?: CostCalculator;
  private debug: boolean;

  constructor(metricsPath: string = '.devloop/metrics.json', costCalculator?: CostCalculator, debug: boolean = false) {
    this.metricsPath = path.resolve(process.cwd(), metricsPath);
    this.costCalculator = costCalculator;
    this.debug = debug;
    this.loadMetrics();
  }

  private loadMetrics(): void {
    try {
      if (fs.existsSync(this.metricsPath)) {
        const content = fs.readFileSync(this.metricsPath, 'utf-8');
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          data.forEach((metric: PrdMetricsData) => {
            this.metrics.set(metric.prdId, metric);
          });
        } else if (typeof data === 'object') {
          Object.values(data).forEach((metric: any) => {
            if (metric.prdId) {
              this.metrics.set(metric.prdId, metric);
            }
          });
        }
      }
    } catch (error) {
      logger.warn(`[PrdMetrics] Failed to load metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private saveMetrics(): void {
    try {
      const dir = path.dirname(this.metricsPath);
      fs.ensureDirSync(dir);
      const data = Array.from(this.metrics.values());
      fs.writeFileSync(this.metricsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error(`[PrdMetrics] Failed to save metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  startPrdExecution(prdId: string, prdSetId: string | undefined, prdMetadata: PrdMetadata): void {
    const metric: PrdMetricsData = {
      prdId,
      prdVersion: prdMetadata.prdVersion,
      prdSetId,
      startTime: new Date().toISOString(),
      status: 'in-progress',
      phases: {
        total: prdMetadata.phases?.length || 0,
        completed: 0,
        failed: 0,
        successRate: 0,
        phaseMetrics: [],
      },
      tasks: {
        total: 0,
        completed: 0,
        failed: 0,
        successRate: 0,
      },
      tests: {
        total: 0,
        passing: 0,
        failing: 0,
        passRate: 0,
      },
      timing: {
        totalMs: 0,
        avgPhaseMs: 0,
        avgTaskMs: 0,
        avgAiCallMs: 0,
        avgTestRunMs: 0,
      },
      tokens: {
        totalInput: 0,
        totalOutput: 0,
      },
      errors: {
        total: 0,
        byCategory: {},
        byType: {},
      },
      efficiency: {
        tokensPerTask: 0,
        iterationsPerTask: 0,
        avgRetries: 0,
      },
      features: {
        used: prdMetadata.features || [],
        featureMetrics: {},
      },
      schema: {
        operations: [],
        schemaMetrics: {
          totalOperations: 0,
          operationsByType: {},
          operationsBySchemaType: {},
          successRate: 0,
          avgDuration: 0,
          errors: {
            total: 0,
            byOperation: {},
            bySchemaType: {},
          },
        },
      },
      observations: {
        total: 0,
        byType: {},
        bySeverity: {},
        resolutionRate: 0,
      },
      patterns: {
        totalMatched: 0,
        byType: {},
        effectiveness: 0,
        successRate: 0,
      },
    };

    this.metrics.set(prdId, metric);
    this.saveMetrics();
  }

  recordPhaseCompletion(phaseId: number, metrics: PhaseMetricsData): void {
    const prdMetric = this.metrics.get(metrics.prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record phase completion: PRD ${metrics.prdId} not found`);
      return;
    }

    // Update phase counts
    if (metrics.status === 'completed') {
      prdMetric.phases.completed++;
    } else if (metrics.status === 'failed') {
      prdMetric.phases.failed++;
    }

    // Add or update phase metrics
    const existingPhaseIndex = prdMetric.phases.phaseMetrics.findIndex(p => p.phaseId === phaseId);
    if (existingPhaseIndex >= 0) {
      prdMetric.phases.phaseMetrics[existingPhaseIndex] = metrics;
    } else {
      prdMetric.phases.phaseMetrics.push(metrics);
    }

    // Update timing
    if (metrics.duration) {
      prdMetric.timing.totalMs += metrics.duration;
      const totalPhases = prdMetric.phases.completed + prdMetric.phases.failed;
      prdMetric.timing.avgPhaseMs = totalPhases > 0 ? prdMetric.timing.totalMs / totalPhases : 0;
    }

    // Update tokens
    prdMetric.tokens.totalInput += metrics.tokens.totalInput;
    prdMetric.tokens.totalOutput += metrics.tokens.totalOutput;

    // Update tests
    prdMetric.tests.total += metrics.tests.total;
    prdMetric.tests.passing += metrics.tests.passing;
    prdMetric.tests.failing += metrics.tests.failing;
    prdMetric.tests.passRate = prdMetric.tests.total > 0
      ? prdMetric.tests.passing / prdMetric.tests.total
      : 0;

    // Update success rate
    const totalPhases = prdMetric.phases.completed + prdMetric.phases.failed;
    prdMetric.phases.successRate = totalPhases > 0
      ? prdMetric.phases.completed / totalPhases
      : 0;

    this.saveMetrics();
  }

  recordTaskCompletion(prdId: string, taskId: string, metrics: RunMetrics): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record task completion: PRD ${prdId} not found`);
      return;
    }
        prdMetric.tasks.total++;

        if (metrics.status === 'completed') {
          prdMetric.tasks.completed++;
        } else if (metrics.status === 'failed') {
          prdMetric.tasks.failed++;
        }

        // Update timing
        if (metrics.timing?.totalMs) {
          prdMetric.timing.totalMs += metrics.timing.totalMs;
          const totalTasks = prdMetric.tasks.completed + prdMetric.tasks.failed;
          prdMetric.timing.avgTaskMs = totalTasks > 0 ? prdMetric.timing.totalMs / totalTasks : 0;
        }

        if (metrics.timing?.aiCallMs) {
          // Calculate average AI call time
          const aiCallTimes: number[] = [];
          // We'd need to track all AI call times, for now we'll use the current value
          prdMetric.timing.avgAiCallMs = metrics.timing.aiCallMs;
        }

        if (metrics.timing?.testRunMs) {
          prdMetric.timing.avgTestRunMs = metrics.timing.testRunMs;
        }

        // Update tokens
        if (metrics.tokens?.input) {
          prdMetric.tokens.totalInput += metrics.tokens.input;
        }
        if (metrics.tokens?.output) {
          prdMetric.tokens.totalOutput += metrics.tokens.output;
        }

            // Update token breakdown
        if (metrics.tokens?.input || metrics.tokens?.output) {
          // Token breakdown by feature type
          // For code generation tasks, tokens go to codeGeneration
          // AI fallback tokens tracked separately in jsonParsing metrics
          // Retry tokens tracked in jsonParsing metrics
          // Error analysis tokens tracked separately when error analysis occurs
          if (!prdMetric.tokens.byFeature) {
            prdMetric.tokens.byFeature = createDefaultTokenBreakdown();
          }
          prdMetric.tokens.byFeature.codeGeneration.input += metrics.tokens.input || 0;
          prdMetric.tokens.byFeature.codeGeneration.output += metrics.tokens.output || 0;
        }

        // Update timing breakdown for AI calls
        if (metrics.timing?.aiCallMs) {
          this.updateTimingBreakdown(prdId, 'contextBuilding', 0); // Context building already tracked
          // AI call time is captured in total timing, but we can track it separately if needed
        }

        // Update timing breakdown for validation
        if (metrics.validation?.preValidationPassed !== undefined) {
          // Validation timing tracked via validation events
        }

        // Update timing breakdown for test runs
        if (metrics.timing?.testRunMs) {
          // Test run timing is already in avgTestRunMs, could add to breakdown if needed
        }
        // Calculate and update cost using CostCalculator static method
        if (metrics.tokens?.input && metrics.tokens?.output) {
          // Use default provider/model for cost calculation
          // In a real scenario, we'd track the actual provider/model used
          try {
            const { CostCalculator } = require('../utils/cost-calculator');
            const costCalculation = CostCalculator.calculateCost(
              'anthropic', // Default provider
              'claude-3-5-sonnet-20241022', // Default model
              metrics.tokens.input,
              metrics.tokens.output
            );
            prdMetric.tokens.totalCost = (prdMetric.tokens.totalCost || 0) + costCalculation.totalCost;
          } catch (err) {
            // Cost calculation failed, continue without cost
            if (this.debug) {
              logger.warn(`[PrdMetrics] Failed to calculate cost: ${err}`);
            }
          }
        }

        // Update errors
        if (metrics.outcome?.errorCategory) {
          prdMetric.errors.total++;
          const category = metrics.outcome.errorCategory;
          prdMetric.errors.byCategory[category] = (prdMetric.errors.byCategory[category] || 0) + 1;
        }

        if (metrics.outcome?.failureType) {
          const type = metrics.outcome.failureType;
          prdMetric.errors.byType[type] = (prdMetric.errors.byType[type] || 0) + 1;
        }

        // Update efficiency
        const totalTasks = prdMetric.tasks.completed + prdMetric.tasks.failed;
        if (totalTasks > 0) {
          prdMetric.efficiency.tokensPerTask = prdMetric.tokens.totalInput / totalTasks;
        }

        if (metrics.outcome?.retryCount !== undefined) {
          // We'd need to track all retry counts to calculate average
          prdMetric.efficiency.avgRetries = metrics.outcome.retryCount;
        }

        // Update success rate
        const totalProcessed = prdMetric.tasks.completed + prdMetric.tasks.failed;
        prdMetric.tasks.successRate = totalProcessed > 0
          ? prdMetric.tasks.completed / totalProcessed
          : 0;

    this.saveMetrics();
  }

  recordTestResults(prdId: string, testResults: TestResults): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record test results: PRD ${prdId} not found`);
      return;
    }

    prdMetric.tests.total += testResults.total;
    prdMetric.tests.passing += testResults.passing;
    prdMetric.tests.failing += testResults.failing;
    prdMetric.tests.passRate = prdMetric.tests.total > 0
      ? prdMetric.tests.passing / prdMetric.tests.total
      : 0;

    this.saveMetrics();
  }

  recordFeatureUsage(prdId: string, featureName: string, success: boolean, duration: number, tokens: { input: number; output: number }, error?: string): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record feature usage: PRD ${prdId} not found`);
      return;
    }

    if (prdMetric.features.used.includes(featureName)) {
        if (!prdMetric.features.featureMetrics[featureName]) {
          prdMetric.features.featureMetrics[featureName] = {
            featureName,
            usageCount: 0,
            successCount: 0,
            failureCount: 0,
            avgDuration: 0,
            totalTokens: 0,
            errors: {
              total: 0,
              byType: {},
            },
          };
        }

        const featureMetric = prdMetric.features.featureMetrics[featureName];
        featureMetric.usageCount++;
        if (success) {
          featureMetric.successCount++;
        } else {
          featureMetric.failureCount++;
          featureMetric.errors.total++;
          if (error) {
            const errorType = error.split(':')[0] || 'unknown';
            featureMetric.errors.byType[errorType] = (featureMetric.errors.byType[errorType] || 0) + 1;
          }
        }

        // Update average duration
        const totalUsages = featureMetric.successCount + featureMetric.failureCount;
        featureMetric.avgDuration = totalUsages > 0
          ? ((featureMetric.avgDuration * (totalUsages - 1)) + duration) / totalUsages
          : duration;

        featureMetric.totalTokens += tokens.input + tokens.output;

        // Update token breakdown by feature type
        // Map feature names to token breakdown categories
        if (!prdMetric.tokens.byFeature) {
          prdMetric.tokens.byFeature = createDefaultTokenBreakdown();
        }
        
        // Map feature names to breakdown categories
        if (featureName === 'error-analysis' && tokens.input + tokens.output > 0) {
          prdMetric.tokens.byFeature.errorAnalysis.input += tokens.input;
          prdMetric.tokens.byFeature.errorAnalysis.output += tokens.output;
        } else if ((featureName === 'test-generation' || featureName === 'code-generation' || featureName === 'codebase-discovery') && tokens.input + tokens.output > 0) {
          // Code generation features go to codeGeneration
          prdMetric.tokens.byFeature.codeGeneration.input += tokens.input;
          prdMetric.tokens.byFeature.codeGeneration.output += tokens.output;
        }

      this.saveMetrics();
    }
  }

  recordSchemaOperation(prdId: string, operation: SchemaOperation): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record schema operation: PRD ${prdId} not found`);
      return;
    }
        prdMetric.schema.operations.push(operation);

        const schemaMetrics = prdMetric.schema.schemaMetrics;
        schemaMetrics.totalOperations++;

        // Update operation type counts
        schemaMetrics.operationsByType[operation.operation] =
          (schemaMetrics.operationsByType[operation.operation] || 0) + 1;

        // Update schema type counts
        schemaMetrics.operationsBySchemaType[operation.schemaType] =
          (schemaMetrics.operationsBySchemaType[operation.schemaType] || 0) + 1;

        // Update success rate
        const successful = prdMetric.schema.operations.filter(op => op.success).length;
        schemaMetrics.successRate = schemaMetrics.totalOperations > 0
          ? successful / schemaMetrics.totalOperations
          : 0;

        // Update average duration
        const totalDuration = prdMetric.schema.operations.reduce((sum, op) => sum + op.duration, 0);
        schemaMetrics.avgDuration = schemaMetrics.totalOperations > 0
          ? totalDuration / schemaMetrics.totalOperations
          : 0;

        // Update errors
        if (!operation.success && operation.error) {
          schemaMetrics.errors.total++;
          schemaMetrics.errors.byOperation[operation.operation] =
            (schemaMetrics.errors.byOperation[operation.operation] || 0) + 1;
          schemaMetrics.errors.bySchemaType[operation.schemaType] =
            (schemaMetrics.errors.bySchemaType[operation.schemaType] || 0) + 1;
        }

    this.saveMetrics();
  }

  recordObservation(prdId: string, observation: { type: string; severity: string; count: number; resolvedCount: number; resolutionRate: number }): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record observation: PRD ${prdId} not found`);
      return;
    }

    prdMetric.observations.total += observation.count;
    prdMetric.observations.byType[observation.type] =
      (prdMetric.observations.byType[observation.type] || 0) + observation.count;
    prdMetric.observations.bySeverity[observation.severity] =
      (prdMetric.observations.bySeverity[observation.severity] || 0) + observation.count;

    // Update resolution rate (weighted average)
    const totalObservations = prdMetric.observations.total;
    if (totalObservations > 0) {
      prdMetric.observations.resolutionRate =
        ((prdMetric.observations.resolutionRate * (totalObservations - observation.count)) +
         (observation.resolutionRate * observation.count)) / totalObservations;
    }

    this.saveMetrics();
  }

  recordPattern(prdId: string, pattern: { type: string; matchCount: number; applyCount: number; successCount: number; effectiveness: number }): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record pattern: PRD ${prdId} not found`);
      return;
    }

    prdMetric.patterns.totalMatched += pattern.matchCount;
    prdMetric.patterns.byType[pattern.type] =
      (prdMetric.patterns.byType[pattern.type] || 0) + pattern.matchCount;

    // Update effectiveness and success rate (weighted average)
    const totalMatched = prdMetric.patterns.totalMatched;
    if (totalMatched > 0) {
      prdMetric.patterns.effectiveness =
        ((prdMetric.patterns.effectiveness * (totalMatched - pattern.matchCount)) +
         (pattern.effectiveness * pattern.matchCount)) / totalMatched;
      prdMetric.patterns.successRate =
        ((prdMetric.patterns.successRate * (totalMatched - pattern.matchCount)) +
         ((pattern.successCount / pattern.applyCount) * pattern.matchCount)) / totalMatched;
    }

    this.saveMetrics();
  }

  // ===== Enhanced Metrics Recording Methods =====

  /**
   * Record JSON parsing metrics
   */
  recordJsonParsing(
    prdId: string,
    data: {
      strategy: 'direct' | 'retry' | 'aiFallback' | 'sanitized';
      success: boolean;
      durationMs: number;
      failureReason?: string;
      tokensUsed?: { input: number; output: number };
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record JSON parsing: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.jsonParsing) {
      prdMetric.jsonParsing = createDefaultJsonParsingMetrics();
    }

    const jp = prdMetric.jsonParsing;
    jp.totalAttempts++;
    jp.totalParsingTimeMs += data.durationMs;
    jp.avgParsingTimeMs = jp.totalParsingTimeMs / jp.totalAttempts;

    if (data.success) {
      jp.successByStrategy[data.strategy]++;
    } else if (data.failureReason) {
      jp.failuresByReason[data.failureReason] = (jp.failuresByReason[data.failureReason] || 0) + 1;
    }

    // Track AI fallback usage specifically
    if (data.strategy === 'aiFallback') {
      jp.aiFallbackUsage.triggered++;
      jp.aiFallbackUsage.totalTimeMs += data.durationMs;
      jp.aiFallbackUsage.avgTimeMs = jp.aiFallbackUsage.totalTimeMs / jp.aiFallbackUsage.triggered;

      if (data.success) {
        jp.aiFallbackUsage.succeeded++;
      } else {
        jp.aiFallbackUsage.failed++;
      }

      if (data.tokensUsed) {
        jp.aiFallbackUsage.tokensUsed.input += data.tokensUsed.input;
        jp.aiFallbackUsage.tokensUsed.output += data.tokensUsed.output;

        // Update token breakdown for AI fallback
        const prdMetric = this.metrics.get(prdId);
        if (prdMetric && prdMetric.tokens) {
          if (!prdMetric.tokens.byFeature) {
            prdMetric.tokens.byFeature = createDefaultTokenBreakdown();
          }
          prdMetric.tokens.byFeature.aiFallback.input += data.tokensUsed.input;
          prdMetric.tokens.byFeature.aiFallback.output += data.tokensUsed.output;
        }
      }
    }

    // Update timing breakdown
    this.updateTimingBreakdown(prdId, 'jsonParsing', data.durationMs);

    this.saveMetrics();
  }

  /**
   * Record IPC connection metrics
   */
  recordIpcConnection(
    prdId: string,
    data: {
      success: boolean;
      durationMs: number;
      isRetry?: boolean;
      isHealthCheck?: boolean;
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record IPC connection: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.ipc) {
      prdMetric.ipc = createDefaultIpcMetrics();
    }

    const ipc = prdMetric.ipc;

    if (data.isHealthCheck) {
      ipc.healthChecksPerformed++;
      if (!data.success) {
        ipc.healthCheckFailures++;
      }
    } else if (data.isRetry) {
      ipc.retries++;
      ipc.totalRetryTimeMs += data.durationMs;
      ipc.avgRetryTimeMs = ipc.totalRetryTimeMs / ipc.retries;
    } else {
      ipc.connectionsAttempted++;
      ipc.totalConnectionTimeMs += data.durationMs;
      ipc.avgConnectionTimeMs = ipc.totalConnectionTimeMs / ipc.connectionsAttempted;

      if (data.success) {
        ipc.connectionsSucceeded++;
      } else {
        ipc.connectionsFailed++;
      }
    }

    // Update timing breakdown
    this.updateTimingBreakdown(prdId, 'ipc', data.durationMs);

    this.saveMetrics();
  }

  /**
   * Record file filtering metrics
   */
  recordFileFiltering(
    prdId: string,
    data: {
      filesFiltered: number;
      filesAllowed: number;
      durationMs: number;
      isPredictive?: boolean;
      isBoundaryViolation?: boolean;
      suggestionGenerated?: boolean;
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record file filtering: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.fileFiltering) {
      prdMetric.fileFiltering = createDefaultFileFilteringMetrics();
    }

    const ff = prdMetric.fileFiltering;
    ff.filesFiltered += data.filesFiltered;
    ff.filesAllowed += data.filesAllowed;
    ff.totalFilteringTimeMs += data.durationMs;

    const totalOps = ff.filesFiltered + ff.filesAllowed;
    ff.avgFilteringTimeMs = totalOps > 0 ? ff.totalFilteringTimeMs / totalOps : 0;

    if (data.isPredictive) {
      ff.predictiveFilters++;
    }

    if (data.isBoundaryViolation) {
      ff.boundaryViolations++;
    }

    if (data.suggestionGenerated) {
      ff.filterSuggestionsGenerated++;
    }

    // Update timing breakdown
    this.updateTimingBreakdown(prdId, 'fileFiltering', data.durationMs);

    this.saveMetrics();
  }

  /**
   * Record validation gate metrics
   */
  recordValidation(
    prdId: string,
    data: {
      type: 'pre' | 'post';
      success: boolean;
      durationMs: number;
      errorCategory?: string;
      suggestionGenerated?: boolean;
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record validation: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.validation) {
      prdMetric.validation = createDefaultValidationMetrics();
    }

    const v = prdMetric.validation;
    v.totalValidationTimeMs += data.durationMs;

    if (data.type === 'pre') {
      v.preValidations++;
      if (!data.success) {
        v.preValidationFailures++;
      }
    } else {
      v.postValidations++;
      if (!data.success) {
        v.postValidationFailures++;
      }
    }

    const totalValidations = v.preValidations + v.postValidations;
    v.avgValidationTimeMs = totalValidations > 0 ? v.totalValidationTimeMs / totalValidations : 0;

    if (!data.success && data.errorCategory) {
      v.errorsByCategory[data.errorCategory] = (v.errorsByCategory[data.errorCategory] || 0) + 1;
    }

    if (data.suggestionGenerated) {
      v.recoverySuggestionsGenerated++;
    }

    // Update timing breakdown
    this.updateTimingBreakdown(prdId, 'validation', data.durationMs);

    this.saveMetrics();
  }

  /**
   * Record context building metrics
   */
  recordContextBuild(
    prdId: string,
    data: {
      durationMs: number;
      contextSizeChars: number;
      filesIncluded: number;
      filesTruncated: number;
      contextWindowUtilization?: number;
      searchTimeMs?: number;
      filesFound?: number;
      filesUsed?: number;
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record context build: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.context) {
      prdMetric.context = createDefaultContextMetrics();
    }

    const ctx = prdMetric.context;
    ctx.totalBuilds++;
    ctx.totalBuildTimeMs += data.durationMs;
    ctx.avgBuildTimeMs = ctx.totalBuildTimeMs / ctx.totalBuilds;

    ctx.totalContextSizeChars += data.contextSizeChars;
    ctx.avgContextSizeChars = ctx.totalContextSizeChars / ctx.totalBuilds;

    ctx.totalFilesIncluded += data.filesIncluded;
    ctx.avgFilesIncluded = ctx.totalFilesIncluded / ctx.totalBuilds;

    ctx.totalFilesTruncated += data.filesTruncated;
    ctx.avgFilesTruncated = ctx.totalFilesTruncated / ctx.totalBuilds;

    if (data.contextWindowUtilization !== undefined) {
      ctx.contextWindowUtilization = data.contextWindowUtilization;
    }

    if (data.searchTimeMs !== undefined) {
      ctx.searchOperations.total++;
      ctx.searchOperations.totalTimeMs += data.searchTimeMs;
      ctx.searchOperations.avgTimeMs = ctx.searchOperations.totalTimeMs / ctx.searchOperations.total;

      if (data.filesFound !== undefined) {
        ctx.searchOperations.filesFound += data.filesFound;
      }
      if (data.filesUsed !== undefined) {
        ctx.searchOperations.filesUsed += data.filesUsed;
      }

      if (ctx.searchOperations.filesFound > 0) {
        ctx.searchOperations.efficiency = ctx.searchOperations.filesUsed / ctx.searchOperations.filesFound;
      }
    }

    // Update timing breakdown
    this.updateTimingBreakdown(prdId, 'contextBuilding', data.durationMs);

    this.saveMetrics();
  }

  /**
   * Record codebase search metrics
   */
  recordCodebaseSearch(
    prdId: string,
    data: {
      durationMs: number;
      success: boolean;
      pattern?: string;
      filesFound: number;
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record codebase search: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.codebase) {
      prdMetric.codebase = createDefaultCodebaseMetrics();
    }

    const cb = prdMetric.codebase;
    cb.searchOperations.total++;
    cb.searchOperations.totalTimeMs += data.durationMs;
    cb.searchOperations.avgTimeMs = cb.searchOperations.totalTimeMs / cb.searchOperations.total;
    cb.searchOperations.filesFound += data.filesFound;
    cb.searchOperations.avgFilesPerSearch = cb.searchOperations.filesFound / cb.searchOperations.total;

    const successCount = cb.searchOperations.successRate * (cb.searchOperations.total - 1);
    cb.searchOperations.successRate = (successCount + (data.success ? 1 : 0)) / cb.searchOperations.total;

    if (data.pattern) {
      cb.searchOperations.patternsUsed[data.pattern] = (cb.searchOperations.patternsUsed[data.pattern] || 0) + 1;
    }

    // Update timing breakdown
    this.updateTimingBreakdown(prdId, 'codebaseSearch', data.durationMs);

    this.saveMetrics();
  }

  /**
   * Record file operation metrics
   */
  recordFileOperation(
    prdId: string,
    data: {
      type: 'read' | 'write' | 'delete';
      durationMs: number;
      success: boolean;
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record file operation: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.codebase) {
      prdMetric.codebase = createDefaultCodebaseMetrics();
    }

    const fo = prdMetric.codebase.fileOperations;

    if (data.type === 'read') {
      fo.reads++;
      fo.totalReadTimeMs += data.durationMs;
      fo.avgReadTimeMs = fo.totalReadTimeMs / fo.reads;
    } else if (data.type === 'write') {
      fo.writes++;
      fo.totalWriteTimeMs += data.durationMs;
      fo.avgWriteTimeMs = fo.totalWriteTimeMs / fo.writes;
    } else if (data.type === 'delete') {
      fo.deletes++;
    }

    if (!data.success) {
      fo.errors++;
    }

    const totalOps = fo.reads + fo.writes + fo.deletes;
    fo.errorRate = totalOps > 0 ? fo.errors / totalOps : 0;

    // Update timing breakdown
    this.updateTimingBreakdown(prdId, 'fileOperations', data.durationMs);

    this.saveMetrics();
  }

  /**
   * Record session metrics
   */
  recordSession(
    prdId: string,
    data: {
      historyEntries?: number;
      isRotation?: boolean;
      isHealthCheck?: boolean;
      isUnhealthy?: boolean;
      persistenceType?: 'save' | 'load';
      persistenceSuccess?: boolean;
      persistenceDurationMs?: number;
      pruning?: { entriesRemoved: number; entriesRetained: number; durationMs: number };
      sessionDurationMs?: number;
      isExpired?: boolean;
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record session: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.sessions) {
      prdMetric.sessions = createDefaultSessionMetrics();
    }

    const s = prdMetric.sessions;

    if (data.historyEntries !== undefined) {
      // Update history entry stats
      if (s.totalSessions === 0 || data.historyEntries > s.maxHistoryEntries) {
        s.maxHistoryEntries = data.historyEntries;
      }
      if (s.totalSessions === 0 || data.historyEntries < s.minHistoryEntries || s.minHistoryEntries === 0) {
        s.minHistoryEntries = data.historyEntries;
      }
      // Rolling average
      s.avgHistoryEntries = ((s.avgHistoryEntries * s.totalSessions) + data.historyEntries) / (s.totalSessions + 1);
      s.totalSessions++;
    }

    if (data.isRotation) {
      s.sessionRotations++;
    }

    if (data.isHealthCheck) {
      s.sessionHealthChecks++;
    }

    if (data.isUnhealthy) {
      s.unhealthySessions++;
    }

    if (data.persistenceType && data.persistenceDurationMs !== undefined) {
      const p = s.sessionPersistence;
      if (data.persistenceType === 'save') {
        p.saves++;
        p.totalSaveTimeMs += data.persistenceDurationMs;
        p.avgSaveTimeMs = p.totalSaveTimeMs / p.saves;
        if (!data.persistenceSuccess) {
          p.savesFailed++;
        }
      } else {
        p.loads++;
        p.totalLoadTimeMs += data.persistenceDurationMs;
        p.avgLoadTimeMs = p.totalLoadTimeMs / p.loads;
        if (!data.persistenceSuccess) {
          p.loadsFailed++;
        }
      }
      const totalOps = p.saves + p.loads;
      const failures = p.savesFailed + p.loadsFailed;
      p.successRate = totalOps > 0 ? (totalOps - failures) / totalOps : 0;

      // Update timing breakdown
      this.updateTimingBreakdown(prdId, 'sessionManagement', data.persistenceDurationMs);
    }

    if (data.pruning) {
      const h = s.historyManagement;
      h.prunings++;
      h.entriesRemoved += data.pruning.entriesRemoved;
      h.entriesRetained += data.pruning.entriesRetained;
      h.totalPruningTimeMs += data.pruning.durationMs;
      h.avgPruningTimeMs = h.totalPruningTimeMs / h.prunings;
    }

    if (data.sessionDurationMs !== undefined) {
      const l = s.sessionLifespan;
      if (l.avgDurationMs === 0) {
        l.avgDurationMs = data.sessionDurationMs;
        l.maxDurationMs = data.sessionDurationMs;
        l.minDurationMs = data.sessionDurationMs;
      } else {
        const count = s.totalSessions > 0 ? s.totalSessions : 1;
        l.avgDurationMs = ((l.avgDurationMs * (count - 1)) + data.sessionDurationMs) / count;
        if (data.sessionDurationMs > l.maxDurationMs) {
          l.maxDurationMs = data.sessionDurationMs;
        }
        if (data.sessionDurationMs < l.minDurationMs) {
          l.minDurationMs = data.sessionDurationMs;
        }
      }
    }

    if (data.isExpired) {
      s.sessionLifespan.expiredSessions++;
    }

    this.saveMetrics();
  }

  /**
   * Record contribution mode metrics
   */
  recordContributionMode(
    prdId: string,
    data: {
      observation?: boolean;
      fixApplied?: boolean;
      fixCategory?: string;
      isRootCauseFix?: boolean;
      isWorkaround?: boolean;
      improvementIdentified?: boolean;
      sessionDurationMs?: number;
    }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record contribution mode: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.contributionMode) {
      prdMetric.contributionMode = createDefaultContributionModeMetrics();
    }

    const cm = prdMetric.contributionMode;

    if (data.observation) {
      cm.outerAgentObservations++;
    }

    if (data.fixApplied) {
      cm.devLoopFixesApplied++;

      if (data.fixCategory) {
        cm.fixesByCategory[data.fixCategory] = (cm.fixesByCategory[data.fixCategory] || 0) + 1;
      }

      if (data.isRootCauseFix) {
        cm.rootCauseFixes++;
      }

      if (data.isWorkaround) {
        cm.workaroundFixes++;
      }
    }

    if (data.improvementIdentified) {
      cm.improvementsIdentified++;
    }

    if (data.sessionDurationMs !== undefined) {
      cm.sessionDuration = data.sessionDurationMs;
    }

    this.saveMetrics();
  }

  /**
   * Record token usage by feature
   */
  recordTokensByFeature(
    prdId: string,
    feature: 'codeGeneration' | 'aiFallback' | 'retry' | 'errorAnalysis',
    tokens: { input: number; output: number }
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) {
      logger.warn(`[PrdMetrics] Cannot record tokens by feature: PRD ${prdId} not found`);
      return;
    }

    if (!prdMetric.tokens.byFeature) {
      prdMetric.tokens.byFeature = createDefaultTokenBreakdown();
    }

    prdMetric.tokens.byFeature[feature].input += tokens.input;
    prdMetric.tokens.byFeature[feature].output += tokens.output;

    this.saveMetrics();
  }

  /**
   * Helper to update timing breakdown
   */
  private updateTimingBreakdown(
    prdId: string,
    category: keyof TimingBreakdown,
    durationMs: number
  ): void {
    const prdMetric = this.metrics.get(prdId);
    if (!prdMetric) return;

    if (!prdMetric.timing.breakdown) {
      prdMetric.timing.breakdown = createDefaultTimingBreakdown();
    }

    const breakdown = prdMetric.timing.breakdown[category];
    breakdown.count++;
    breakdown.totalMs += durationMs;
    breakdown.avgMs = breakdown.totalMs / breakdown.count;
  }

  completePrdExecution(prdId: string, status: 'completed' | 'failed'): void {
    const metric = this.metrics.get(prdId);
    if (!metric) {
      logger.warn(`[PrdMetrics] Cannot complete PRD ${prdId}: not found`);
      return;
    }

    metric.endTime = new Date().toISOString();
    metric.status = status;

    if (metric.startTime) {
      const start = new Date(metric.startTime);
      const end = new Date(metric.endTime);
      metric.duration = end.getTime() - start.getTime();
    }

    this.saveMetrics();
  }

  getPrdMetrics(prdId: string): PrdMetricsData | undefined {
    return this.metrics.get(prdId);
  }

  getAllPrdMetrics(): PrdMetricsData[] {
    return Array.from(this.metrics.values());
  }
}

