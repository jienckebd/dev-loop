import { Config, ConfigOverlay } from '../config/schema';
import { WorkflowEngine, PrdExecutionResult } from './workflow-engine';
import { PrdSet } from './prd-coordinator';
import { DiscoveredPrdSet } from './prd-set-discovery';
import { DependencyGraphBuilder, ExecutionLevel } from './dependency-graph';
import { PrdCoordinator, PrdState } from './prd-coordinator';
import { PrerequisiteValidator } from './prerequisite-validator';
import { ValidationScriptExecutor } from './validation-script-executor';
import { PrdSetProgressTracker } from './prd-set-progress-tracker';
import { PrdSetErrorHandler } from './prd-set-error-handler';
import { PrdSetMetrics } from './prd-set-metrics';
import { createConfigContext, applyPrdSetConfig, ConfigContext } from './config-merger';
import { logger } from './logger';

export interface PrdSetMetadata {
  setId: string;
  prdPaths: string[];
  startTime?: string;
  // Config overlay for the entire PRD set
  configOverlay?: ConfigOverlay;
}

export interface PrdSetExecutionOptions {
  parallel?: boolean;
  maxConcurrent?: number;
}

export interface PrdSetExecutionResult {
  status: 'complete' | 'blocked' | 'failed';
  completedPrds: string[];
  failedPrds: string[];
  executionLevels: ExecutionLevel[];
  errors: string[];
}

/**
 * PRD Set Orchestrator
 *
 * Orchestrates autonomous execution of entire PRD sets with dependency-aware scheduling.
 * Supports hierarchical configuration merging (Project -> PRD Set -> PRD -> Phase).
 */
export class PrdSetOrchestrator {
  private baseConfig: Config;
  private configContext: ConfigContext;
  private workflowEngine: WorkflowEngine;
  private coordinator: PrdCoordinator;
  private graphBuilder: DependencyGraphBuilder;
  private prerequisiteValidator: PrerequisiteValidator;
  private progressTracker: PrdSetProgressTracker;
  private errorHandler: PrdSetErrorHandler;
  private prdSetMetrics: PrdSetMetrics;
  private debug: boolean;

  constructor(config: Config, debug: boolean = false) {
    this.baseConfig = config;
    this.configContext = createConfigContext(config);
    this.workflowEngine = new WorkflowEngine(config);
    this.coordinator = new PrdCoordinator('.devloop/prd-set-state.json', debug);
    this.graphBuilder = new DependencyGraphBuilder(debug);
    this.prerequisiteValidator = new PrerequisiteValidator(
      new ValidationScriptExecutor(debug),
      debug
    );
    this.progressTracker = new PrdSetProgressTracker(this.coordinator, '.devloop/prd-set-metrics.json', debug);
    this.errorHandler = new PrdSetErrorHandler(this.coordinator, debug);
    this.prdSetMetrics = new PrdSetMetrics('.devloop/prd-set-metrics.json');
    this.debug = debug;

    // Register cleanup handlers for graceful shutdown
    this.registerCleanupHandlers();

    // Finalize any stale in-progress PRD sets from previous runs
    this.prdSetMetrics.finalizeInProgressSets();
  }

  /**
   * Get the current effective config (with PRD set overlay applied)
   */
  getEffectiveConfig(): Config {
    return this.configContext.effectiveConfig;
  }

  /**
   * Register handlers for process termination to ensure metrics are finalized
   */
  private registerCleanupHandlers(): void {
    const cleanup = () => {
      if (this.debug) {
        logger.debug('[PrdSetOrchestrator] Process termination - finalizing metrics');
      }
      // Finalize any in-progress PRD sets
      this.prdSetMetrics.finalizeInProgressSets();
    };

    process.once('SIGTERM', cleanup);
    process.once('SIGINT', cleanup);
  }

  /**
   * Execute entire PRD set
   */
  async executePrdSet(
    discoveredSet: DiscoveredPrdSet,
    options: PrdSetExecutionOptions = {}
  ): Promise<PrdSetExecutionResult> {
    const { parallel = true, maxConcurrent = 2 } = options;

    if (this.debug) {
      logger.debug(`[PrdSetOrchestrator] Starting execution of PRD set: ${discoveredSet.setId}`);
    }

    // Apply PRD set config overlay if available
    if (discoveredSet.configOverlay) {
      applyPrdSetConfig(this.configContext, discoveredSet.configOverlay);
      logger.debug(`[PrdSetOrchestrator] Applied PRD set config overlay for ${discoveredSet.setId}`);

      // Update workflow engine with effective config
      // Note: WorkflowEngine uses config internally, so we may need to recreate it
      // For now, we store the effective config for use by individual PRD executions
    }

    // Initialize PRD set coordination
    await this.coordinator.coordinatePrdSet(discoveredSet.prdSet);

    // Build dependency graph
    const graph = this.graphBuilder.buildGraph(discoveredSet.prdSet);

    // Detect cycles
    if (this.graphBuilder.detectCycles(graph)) {
      throw new Error('Dependency cycle detected in PRD set');
    }

    // Resolve execution levels
    const executionLevels = this.graphBuilder.resolveExecutionLevels(graph);

    if (this.debug) {
      logger.debug(`[PrdSetOrchestrator] Resolved ${executionLevels.length} execution levels`);
      executionLevels.forEach((level, idx) => {
        logger.debug(`  Level ${idx}: ${level.prds.join(', ')}`);
      });
    }

    const result: PrdSetExecutionResult = {
      status: 'complete',
      completedPrds: [],
      failedPrds: [],
      executionLevels,
      errors: [],
    };

    // Track start time
    const startTime = new Date();
    result.executionLevels = executionLevels;

    // Start PRD set metrics tracking
    const prdSetMetadata: PrdSetMetadata = {
      setId: discoveredSet.setId,
      prdPaths: discoveredSet.prdSet.prds.map(p => p.path),
      startTime: startTime.toISOString(),
    };
    this.prdSetMetrics.startPrdSetExecution(discoveredSet.setId, prdSetMetadata);

    // Execute PRDs level by level
    for (const level of executionLevels) {
      if (this.debug) {
        logger.debug(`[PrdSetOrchestrator] Executing level ${level.level}: ${level.prds.join(', ')}`);
      }

      // Generate progress report
      const progressReport = await this.progressTracker.generateReport(discoveredSet, executionLevels);
      progressReport.startTime = startTime;
      await this.progressTracker.saveMetrics(progressReport);

      // Validate prerequisites for all PRDs in this level
      for (const prdId of level.prds) {
        const prd = discoveredSet.prdSet.prds.find(p => p.id === prdId);
        if (!prd) {
          result.errors.push(`PRD not found: ${prdId}`);
          result.failedPrds.push(prdId);
          continue;
        }

        try {
          const prereqResult = await this.prerequisiteValidator.validatePrerequisites(prd.metadata);
          if (!prereqResult.success) {
            result.errors.push(`Prerequisites failed for PRD ${prdId}: ${prereqResult.errors.join(', ')}`);
            result.failedPrds.push(prdId);
            await this.coordinator.updatePrdState(prdId, { status: 'blocked' });
            continue;
          }
        } catch (error: any) {
          result.errors.push(`Prerequisite validation error for PRD ${prdId}: ${error.message}`);
          result.failedPrds.push(prdId);
          await this.coordinator.updatePrdState(prdId, { status: 'blocked' });
          continue;
        }
      }

      // Collect PRDs eligible for execution in this level
      type PrdExecutor = () => Promise<{ prdId: string; result: PrdExecutionResult }>;
      const executorFunctions: Array<{ prdId: string; executor: PrdExecutor }> = [];

      for (const prdId of level.prds) {
        // Skip if already failed
        if (result.failedPrds.includes(prdId)) {
          continue;
        }

        const prd = discoveredSet.prdSet.prds.find(p => p.id === prdId);
        if (!prd) {
          continue;
        }

        // Check if dependencies are complete
        const dependencies = this.extractDependencies(prd.metadata);
        let allDepsComplete = true;
        for (const depId of dependencies) {
          const depState = await this.coordinator.getPrdState(depId);
          if (depState?.status !== 'complete') {
            allDepsComplete = false;
            break;
          }
        }

        if (!allDepsComplete) {
          if (this.debug) {
            logger.debug(`[PrdSetOrchestrator] PRD ${prdId} waiting for dependencies`);
          }
          await this.coordinator.updatePrdState(prdId, { status: 'blocked' });
          continue;
        }

        // Create execution function (NOT called yet - stored as reference)
        const executePrd: PrdExecutor = async () => {
          // Update state to running when actually starting
          await this.coordinator.updatePrdState(prdId, { status: 'running' });

          try {
            if (this.debug) {
              logger.debug(`[PrdSetOrchestrator] Executing PRD: ${prdId}`);
            }

            // CRITICAL FIX: Pass parent PRD's execution config to workflow engine
            // Child PRDs don't have their own execution section, so inherit from parent
            const parentExecution = discoveredSet.manifest.parentPrd.metadata.execution;
            if (parentExecution) {
              (this.workflowEngine as any).parentPrdExecutionConfig = parentExecution;
              if (this.debug) {
                logger.debug(`[PrdSetOrchestrator] Inherited parent execution config: targetModule=${parentExecution.targetModule}`);
              }
            }

            const prdResult = await this.workflowEngine.runAutonomousPrd(prd.path);

            // Record PRD completion in metrics
            const workflowPrdMetrics = (this.workflowEngine as any).prdMetrics;
            if (workflowPrdMetrics) {
              const prdMetricsData = workflowPrdMetrics.getPrdMetrics(prdResult.prdId);
              if (prdMetricsData) {
                this.prdSetMetrics.recordPrdCompletion(prdId, prdMetricsData);
              }
            }

            if (prdResult.status === 'complete') {
              await this.coordinator.updatePrdState(prdId, {
                status: 'complete',
                endTime: new Date(),
              });
              return { prdId, result: prdResult };
            } else {
              const error = new Error(`PRD ${prdId} execution ${prdResult.status}`);
              await this.errorHandler.handlePrdError(
                prdId,
                error,
                {
                  maxRetries: 0, // Don't retry here, handled by workflow engine
                },
                async () => {
                  // Retry function (not used with maxRetries: 0)
                  return await this.workflowEngine.runAutonomousPrd(prd.path);
                }
              );
              throw error;
            }
          } catch (error: any) {
            await this.errorHandler.propagateError(prdId, error, result);
            throw error;
          }
        };

        // Store executor function reference (not called yet)
        executorFunctions.push({ prdId, executor: executePrd });
      }

      // Execute PRDs with proper concurrency control
      if (executorFunctions.length > 0) {
        const concurrentLimit = parallel ? Math.min(maxConcurrent, executorFunctions.length) : 1;

        if (this.debug) {
          logger.debug(`[PrdSetOrchestrator] Executing ${executorFunctions.length} PRDs with concurrency limit ${concurrentLimit}`);
        }

        // Process in batches, starting each batch only after the previous completes
        for (let i = 0; i < executorFunctions.length; i += concurrentLimit) {
          const batch = executorFunctions.slice(i, i + concurrentLimit);

          // Start batch execution (now we actually call the executor functions)
          const batchPromises = batch.map(item => item.executor());

          const batchResults = await Promise.allSettled(batchPromises);

          for (let j = 0; j < batchResults.length; j++) {
            const settled = batchResults[j];
            const prdId = batch[j].prdId;

            if (settled.status === 'fulfilled') {
              result.completedPrds.push(settled.value.prdId);
            } else {
              result.failedPrds.push(prdId);
              result.errors.push(`PRD ${prdId} execution failed: ${settled.reason?.message || 'Unknown error'}`);
            }
          }
        }
      }

      // Check if we should continue
      if (result.failedPrds.length > 0 && result.completedPrds.length === 0) {
        result.status = 'failed';
        break;
      }
    }

    // Determine final status
    if (result.failedPrds.length > 0) {
      result.status = result.completedPrds.length > 0 ? 'blocked' : 'failed';
    } else if (result.completedPrds.length === discoveredSet.prdSet.prds.length) {
      result.status = 'complete';
    } else {
      result.status = 'blocked';
    }

    // Complete PRD set metrics tracking
    const finalStatus = result.status === 'complete' ? 'completed' :
                       result.status === 'failed' ? 'failed' : 'blocked';
    this.prdSetMetrics.completePrdSetExecution(discoveredSet.setId, finalStatus);

    // Auto-generate report after completion
    try {
      const { PrdReportGenerator } = require('./prd-report-generator');
      const reportPath = await PrdReportGenerator.autoGenerateReport(discoveredSet.setId);
      if (reportPath && this.debug) {
        logger.debug(`[PrdSetOrchestrator] Auto-generated report: ${reportPath}`);
      }
    } catch (error) {
      logger.warn(`[PrdSetOrchestrator] Failed to auto-generate report: ${error}`);
    }

    return result;
  }

  /**
   * Extract PRD dependencies from metadata
   */
  private extractDependencies(metadata: any): string[] {
    const dependencies: string[] = [];
    const dependsOn = metadata.relationships?.dependsOn || [];

    for (const dep of dependsOn) {
      if (typeof dep === 'string') {
        dependencies.push(dep);
      } else if (dep.prd) {
        dependencies.push(dep.prd);
      }
    }

    return dependencies;
  }
}

