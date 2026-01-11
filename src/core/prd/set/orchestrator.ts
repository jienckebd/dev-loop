import { Config } from '../../../config/schema/core';
import { ConfigOverlay } from '../../../config/schema/overlays';
import { WorkflowEngine, PrdExecutionResult } from '../../execution/workflow';
import { PrdSet } from '../coordination/coordinator';
import { DiscoveredPrdSet } from './discovery';
import { DependencyGraphBuilder, ExecutionLevel } from '../../utils/dependency-graph';
import { PrdCoordinator, PrdState } from '../coordination/coordinator';
import { PrerequisiteValidator } from '../../validation/prerequisite-validator';
import { ValidationScriptExecutor } from '../../validation/script-executor';
import { PrdSetProgressTracker } from './progress-tracker';
import { PrdSetErrorHandler } from './error-handler';
import { PrdSetMetrics } from '../../metrics/prd-set';
import { createConfigContext, applyPrdSetConfig, ConfigContext } from '../../../config/merger';
import { logger } from '../../utils/logger';
import * as fs from 'fs-extra';
import * as path from 'path';
import { TaskMasterBridge } from '../../execution/task-bridge';

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
    this.coordinator = new PrdCoordinator('.devloop/execution-state.json', debug);
    this.graphBuilder = new DependencyGraphBuilder(debug);
    this.prerequisiteValidator = new PrerequisiteValidator(
      new ValidationScriptExecutor(debug),
      debug
    );
    this.progressTracker = new PrdSetProgressTracker(this.coordinator, '.devloop/metrics.json', debug);
    this.errorHandler = new PrdSetErrorHandler(this.coordinator, debug);
    this.prdSetMetrics = new PrdSetMetrics('.devloop/metrics.json');
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

    // Check for execution lock to prevent concurrent PRD set execution
    const lockFile = path.join(process.cwd(), '.devloop', 'prd-set-execution.lock');
    if (await fs.pathExists(lockFile)) {
      try {
        const lockData = await fs.readJson(lockFile);
        // Check if process is still running
        try {
          process.kill(lockData.pid, 0); // Signal 0 checks if process exists
          // Process exists, another PRD set is executing
          throw new Error(`Another PRD set is executing: ${lockData.setId} (started at ${lockData.startedAt}, PID: ${lockData.pid})`);
        } catch (killError: any) {
          // Process doesn't exist (stale lock), remove it
          if (this.debug) {
            logger.debug(`[PrdSetOrchestrator] Removing stale lock file from crashed process (PID: ${lockData.pid})`);
          }
          await fs.remove(lockFile);
        }
      } catch (error: any) {
        if (error.message.includes('Another PRD set is executing')) {
          throw error;
        }
        // Lock file corrupted, remove it
        if (this.debug) {
          logger.debug(`[PrdSetOrchestrator] Removing corrupted lock file`);
        }
        await fs.remove(lockFile);
      }
    }

    // Create execution lock
    await fs.ensureDir(path.dirname(lockFile));
    await fs.writeJson(lockFile, {
      setId: discoveredSet.setId,
      startedAt: new Date().toISOString(),
      pid: process.pid,
    }, { spaces: 2 });

    if (this.debug) {
      logger.debug(`[PrdSetOrchestrator] Created execution lock: ${lockFile}`);
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

    // Wrap execution in try/finally to ensure lock cleanup and task restoration
    try {

    // Create tasks for PRDs level by level
    // For unified daemon mode: PRD sets create tasks in Task Master instead of executing directly
    // Tasks will be picked up by watch mode daemon
    for (const level of executionLevels) {
      if (this.debug) {
        logger.debug(`[PrdSetOrchestrator] Creating tasks for level ${level.level}: ${level.prds.join(', ')}`);
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

        // Create task creation function (NOT called yet - stored as reference)
        // For unified daemon mode: PRD sets create tasks in Task Master instead of executing directly
        // Tasks will be picked up by watch mode daemon
        const createPrdTasks: PrdExecutor = async () => {
          // Update state when starting task creation
          await this.coordinator.updatePrdState(prdId, { status: 'running' });

          try {
            if (this.debug) {
              logger.debug(`[PrdSetOrchestrator] Creating tasks for PRD: ${prdId}`);
            }

            // Create tasks from PRD requirements in Task Master
            // Tasks will be picked up by watch mode daemon
            const taskCount = await this.workflowEngine.createTasksFromPrd(prd.path, discoveredSet.setId);

            if (this.debug) {
              logger.debug(`[PrdSetOrchestrator] Created ${taskCount} tasks for PRD: ${prdId}`);
            }

            // Mark PRD as running (tasks created, ready for execution)
            // Actual execution will be handled by watch mode daemon
            // Note: Status remains 'running' until watch mode executes tasks and marks as 'complete'
            await this.coordinator.updatePrdState(prdId, {
              status: 'running',
              startTime: new Date(),
            });

            // Return success result (tasks created, not executed)
            // Note: result.status uses 'complete' to indicate task creation complete (not execution complete)
            return {
              prdId,
              result: {
                prdId,
                status: 'complete', // Task creation complete (not execution complete)
                tasksCreated: taskCount,
                testsGenerated: 0,
                testsPassing: 0,
                testsFailing: 0,
              } as any,
            };
          } catch (error: any) {
            await this.errorHandler.propagateError(prdId, error, result);
            throw error;
          }
        };

        // Store executor function reference (not called yet)
        executorFunctions.push({ prdId, executor: createPrdTasks });
      }

      // Create tasks for PRDs with proper concurrency control
      // For unified daemon mode: PRD sets create tasks in Task Master instead of executing directly
      // Tasks will be picked up by watch mode daemon
      if (executorFunctions.length > 0) {
        const concurrentLimit = parallel ? Math.min(maxConcurrent, executorFunctions.length) : 1;

        if (this.debug) {
          logger.debug(`[PrdSetOrchestrator] Creating tasks for ${executorFunctions.length} PRDs with concurrency limit ${concurrentLimit}`);
        }

        // Process in batches, starting each batch only after the previous completes
        for (let i = 0; i < executorFunctions.length; i += concurrentLimit) {
          const batch = executorFunctions.slice(i, i + concurrentLimit);

          // Start batch task creation (now we actually call the executor functions)
          const batchPromises = batch.map(item => item.executor());

          const batchResults = await Promise.allSettled(batchPromises);

          for (let j = 0; j < batchResults.length; j++) {
            const settled = batchResults[j];
            const prdId = batch[j].prdId;

            if (settled.status === 'fulfilled') {
              result.completedPrds.push(settled.value.prdId);
            } else {
              result.failedPrds.push(prdId);
              result.errors.push(`PRD ${prdId} task creation failed: ${settled.reason?.message || 'Unknown error'}`);
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

    // Determine final status (task creation complete, not execution complete)
    // Actual execution will be handled by watch mode daemon
    if (result.failedPrds.length > 0) {
      result.status = result.completedPrds.length > 0 ? 'blocked' : 'failed';
    } else if (result.completedPrds.length === discoveredSet.prdSet.prds.length) {
      // All PRDs have tasks created successfully
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
    } finally {
      // Restore deferred tasks before removing lock
      try {
        const taskBridge = new TaskMasterBridge(this.baseConfig);
        const allTasks = await taskBridge.getAllTasks();
        // Find tasks deferred by this PRD set (check task details for deferredBy)
        const deferredByThisSet = allTasks.filter((t: any) => {
          if (t.status !== 'blocked') return false;
          try {
            const taskDetails = t.details ? JSON.parse(t.details) : {};
            return taskDetails.deferredBy === discoveredSet.setId;
          } catch {
            return false;
          }
        });

        for (const task of deferredByThisSet) {
          // Remove deferred metadata from task details
          if (task.details) {
            try {
              const taskDetails = JSON.parse(task.details);
              delete taskDetails.deferredReason;
              delete taskDetails.deferredBy;
              delete taskDetails.deferredAt;
              await taskBridge.updateTask(task.id, {
                status: 'pending',
                details: JSON.stringify(taskDetails),
              } as any);
            } catch (parseError) {
              // If details parsing fails, just restore status
              await taskBridge.updateTaskStatus(task.id, 'pending');
              if (this.debug) {
                logger.debug(`[PrdSetOrchestrator] Failed to parse task details for ${task.id}: ${parseError}`);
              }
            }
          } else {
            // No details, just restore status
            await taskBridge.updateTaskStatus(task.id, 'pending');
          }
        }

        if (deferredByThisSet.length > 0) {
          console.log(`[PrdSetOrchestrator] Restored ${deferredByThisSet.length} deferred tasks`);
        }
      } catch (restoreError) {
        logger.warn(`[PrdSetOrchestrator] Failed to restore deferred tasks: ${restoreError}`);
      }

      // Remove execution lock
      try {
        if (await fs.pathExists(lockFile)) {
          await fs.remove(lockFile);
          if (this.debug) {
            logger.debug(`[PrdSetOrchestrator] Removed execution lock: ${lockFile}`);
          }
        }
      } catch (lockError) {
        logger.warn(`[PrdSetOrchestrator] Failed to remove execution lock: ${lockError}`);
      }
    }
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

