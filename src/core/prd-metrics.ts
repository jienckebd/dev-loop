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
  TestResults
} from './hierarchical-metrics';
import { RunMetrics } from './debug-metrics';
import { CostCalculator } from './cost-calculator';
import { TestExecutionResult } from './test-executor';
import { logger } from './logger';

export class PrdMetrics {
  private metricsPath: string;
  private metrics: Map<string, PrdMetricsData> = new Map();
  private costCalculator?: CostCalculator;
  private debug: boolean;

  constructor(metricsPath: string = '.devloop/prd-metrics.json', costCalculator?: CostCalculator, debug: boolean = false) {
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
        // Calculate and update cost using CostCalculator static method
        if (metrics.tokens?.input && metrics.tokens?.output) {
          // Use default provider/model for cost calculation
          // In a real scenario, we'd track the actual provider/model used
          try {
            const { CostCalculator } = require('./cost-calculator');
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

