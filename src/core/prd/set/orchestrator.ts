import { Config } from '../../../config/schema/core';
import { ConfigOverlay } from '../../../config/schema/overlays';
import { IterationRunner, IterationResult } from '../../execution/iteration-runner';
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
import { SpecKitContext, ResolvedClarification, ResearchFinding, ConstitutionRules } from '../parser/planning-doc-parser';
import { emitEvent } from '../../utils/event-stream';
import { parse as yamlParse } from 'yaml';
import { Task, TaskStatus } from '../../../types';
import { CrossPrdCheckpointer, createCrossPrdCheckpointer } from '../../execution/langgraph/cross-prd-checkpointer';

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
   * Load spec-kit context from PRD set .speckit/ folder
   * Emits events and tracks metrics for observability
   */
  private async loadSpecKitContext(prdSetPath: string): Promise<SpecKitContext | null> {
    const specKitDir = path.join(prdSetPath, '.speckit');
    const startTime = Date.now();

    if (!await fs.pathExists(specKitDir)) {
      if (this.debug) {
        logger.debug(`[PrdSetOrchestrator] No .speckit/ folder found at ${prdSetPath}`);
      }
      return null;
    }

    try {
      const [clarifications, research, constitution] = await Promise.all([
        fs.readJson(path.join(specKitDir, 'clarifications.json')).catch(() => [] as ResolvedClarification[]),
        fs.readJson(path.join(specKitDir, 'research.json')).catch(() => [] as ResearchFinding[]),
        fs.readJson(path.join(specKitDir, 'constitution.json')).catch(() => null as ConstitutionRules | null),
      ]);

      const loadTimeMs = Date.now() - startTime;

      // Emit event for observability
      emitEvent('speckit:context_loaded', {
        prdSetPath,
        setId: path.basename(prdSetPath),
        clarificationsCount: clarifications.length,
        researchCount: research.length,
        hasConstitution: !!constitution,
        loadTimeMs,
      }, { severity: 'info' });

      logger.info(`[PrdSetOrchestrator] Loaded spec-kit context: ${clarifications.length} clarifications, ${research.length} research findings (${loadTimeMs}ms)`);

      return { clarifications, research, constitution };
    } catch (error) {
      emitEvent('speckit:load_failed', {
        prdSetPath,
        setId: path.basename(prdSetPath),
        error: error instanceof Error ? error.message : String(error),
      }, { severity: 'warn' });

      logger.warn(`[PrdSetOrchestrator] Failed to load spec-kit context: ${error}`);
      return null;
    }
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
    }

    // Create shared checkpointer for cross-PRD coordination
    const sharedCheckpointer = createCrossPrdCheckpointer({
      prdSetId: discoveredSet.setId,
      debug: this.debug,
    });

    // Load spec-kit context if available (will be passed to IterationRunner)
    const specKitContext = await this.loadSpecKitContext(discoveredSet.directory);

    // Initialize PRD set coordination
    await this.coordinator.coordinatePrdSet(discoveredSet.prdSet);

    // Set active.prdSetId in execution state so task filtering works correctly
    await this.coordinator.setActivePrdSetId(discoveredSet.setId);
    logger.info(`[PrdSetOrchestrator] Set active PRD set: ${discoveredSet.setId}`);

    // Populate tasks.json from PRD phase files before execution
    // This is critical: IterationRunner uses TaskMasterBridge which reads from tasks.json
    const taskPopulationResult = await this.populateTasksFromPrdSet(discoveredSet);
    if (taskPopulationResult.tasksCreated > 0) {
      logger.info(`[PrdSetOrchestrator] Populated ${taskPopulationResult.tasksCreated} tasks from PRD set`);
    }
    if (taskPopulationResult.errors.length > 0) {
      logger.warn(`[PrdSetOrchestrator] Task population errors: ${taskPopulationResult.errors.join(', ')}`);
    }

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

    // Execute PRDs level by level with parallel fresh-context execution
    for (const level of executionLevels) {
      if (this.debug) {
        logger.debug(`[PrdSetOrchestrator] Executing level ${level.level}: ${level.prds.join(', ')}`);
      }

      // Generate progress report
      const progressReport = await this.progressTracker.generateReport(discoveredSet, executionLevels);
      progressReport.startTime = startTime;
      await this.progressTracker.saveMetrics(progressReport);

      // Validate prerequisites for all PRDs in this level (unless skipped in config)
      const skipPrerequisiteValidation = this.baseConfig.autonomous?.skipPrerequisiteValidation;
      if (!skipPrerequisiteValidation) {
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
      } else if (this.debug) {
        logger.debug('[PrdSetOrchestrator] Skipping prerequisite validation (config: skipPrerequisiteValidation=true)');
      }

      // Collect PRDs eligible for execution in this level
      type PrdExecutor = () => Promise<{ prdId: string; result: IterationResult }>;
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

        // Create PRD executor function using IterationRunner (Ralph pattern)
        // Each PRD gets a fresh IterationRunner for parallel execution with fresh context
        const executePrd: PrdExecutor = async () => {
          // Update state when starting PRD execution
          await this.coordinator.updatePrdState(prdId, { status: 'running' });

          try {
            if (this.debug) {
              logger.debug(`[PrdSetOrchestrator] Executing PRD with fresh context: ${prdId}`);
            }

            // Create fresh IterationRunner per PRD (Ralph pattern)
            // Pass specKitContext if available for design decisions injection
            // Pass sharedCheckpointer for cross-PRD checkpoint coordination
            const runner = new IterationRunner(this.baseConfig, {
              maxIterations: 100,
              contextThreshold: 90,
              autoHandoff: true,
              persistLearnings: true,
              updatePatterns: true,
              handoffInterval: 5,
            }, specKitContext || undefined, sharedCheckpointer);

            // Execute PRD with fresh context
            const iterResult = await runner.runWithFreshContext(prd.path);

            if (this.debug) {
              logger.debug(`[PrdSetOrchestrator] PRD ${prdId} completed: ${iterResult.status} (${iterResult.tasksCompleted} tasks, ${iterResult.iterations} iterations)`);
            }

            // Update PRD state based on execution result
            await this.coordinator.updatePrdState(prdId, {
              status: iterResult.status === 'complete' ? 'complete' : 'failed',
              endTime: new Date(),
            });

            // Mark PRD complete in shared checkpointer for cross-PRD coordination
            if (iterResult.status === 'complete') {
              await sharedCheckpointer.markPrdComplete(prdId, {
                tasksCompleted: iterResult.tasksCompleted,
                tasksFailed: iterResult.tasksFailed || 0,
                tokensUsed: (iterResult.metrics?.tokensUsed?.input || 0) + (iterResult.metrics?.tokensUsed?.output || 0),
              });
            }

            return {
              prdId,
              result: iterResult,
            };
          } catch (error: any) {
            await this.coordinator.updatePrdState(prdId, { status: 'failed' });
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

          // Start batch task creation (now we actually call the executor functions)
          const batchPromises = batch.map(item => item.executor());

          const batchResults = await Promise.allSettled(batchPromises);

          for (let j = 0; j < batchResults.length; j++) {
            const settled = batchResults[j];
            const prdId = batch[j].prdId;

            if (settled.status === 'fulfilled') {
              const { prdId: completedPrdId, result: iterResult } = settled.value;

              // Record PRD completion with metrics from IterationResult
              this.prdSetMetrics.recordPrdCompletion(completedPrdId, {
                prdId: completedPrdId,
                prdVersion: '1.0.0',
                prdSetId: discoveredSet.setId,
                startTime: new Date().toISOString(),
                status: iterResult.status === 'complete' ? 'completed' : 'failed',
                duration: iterResult.duration,
                tokens: {
                  totalInput: iterResult.metrics?.tokensUsed?.input || 0,
                  totalOutput: iterResult.metrics?.tokensUsed?.output || 0,
                },
                tests: {
                  total: iterResult.metrics?.testsRun || 0,
                  passing: iterResult.metrics?.testsPassed || 0,
                  failing: iterResult.metrics?.testsFailed || 0,
                  passRate: (iterResult.metrics?.testsRun || 0) > 0
                    ? (iterResult.metrics?.testsPassed || 0) / (iterResult.metrics?.testsRun || 0) : 0,
                },
                tasks: {
                  total: iterResult.tasksCompleted + iterResult.tasksFailed,
                  completed: iterResult.tasksCompleted,
                  failed: iterResult.tasksFailed,
                  successRate: (iterResult.tasksCompleted + iterResult.tasksFailed) > 0
                    ? iterResult.tasksCompleted / (iterResult.tasksCompleted + iterResult.tasksFailed) : 0,
                },
                phases: { total: 1, completed: 1, failed: 0, successRate: 1, phaseMetrics: [] },
                timing: { totalMs: iterResult.duration, avgPhaseMs: iterResult.duration, avgTaskMs: 0, avgAiCallMs: 0, avgTestRunMs: 0 },
                errors: { total: iterResult.tasksFailed, byCategory: {}, byType: {} },
                efficiency: { tokensPerTask: 0, iterationsPerTask: iterResult.iterations / Math.max(1, iterResult.tasksCompleted), avgRetries: 0 },
                features: { used: [], featureMetrics: {} },
                schema: { operations: [], schemaMetrics: { totalOperations: 0, operationsByType: {}, operationsBySchemaType: {}, successRate: 0, avgDuration: 0, errors: { total: 0, byOperation: {}, bySchemaType: {} } } },
                observations: { total: 0, byType: {}, bySeverity: {}, resolutionRate: 0 },
                patterns: { totalMatched: iterResult.patternsDiscovered, byType: {}, effectiveness: 0, successRate: 0 },
              });

              result.completedPrds.push(completedPrdId);
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
      // All PRDs completed successfully
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
      const { PrdReportGenerator } = require('../../reporting/prd-report-generator');
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

  /**
   * Populate tasks.json from PRD phase files
   *
   * Extracts tasks from all PRD phase files in the discovered set
   * and creates them in tasks.json for TaskMasterBridge to find.
   * Each task includes prdSetId in details for filtering.
   */
  private async populateTasksFromPrdSet(
    discoveredSet: DiscoveredPrdSet
  ): Promise<{ tasksCreated: number; errors: string[] }> {
    const taskBridge = new TaskMasterBridge(this.baseConfig);
    const errors: string[] = [];
    let tasksCreated = 0;

    if (this.debug) {
      logger.debug(`[PrdSetOrchestrator] Populating tasks from PRD set: ${discoveredSet.setId}`);
    }

    // Process all PRDs in the set (parent + children)
    for (const prd of discoveredSet.prdSet.prds) {
      try {
        const prdPath = prd.path;
        if (!prdPath || !await fs.pathExists(prdPath)) {
          if (this.debug) {
            logger.debug(`[PrdSetOrchestrator] PRD file not found: ${prdPath}`);
          }
          continue;
        }

        // Read and parse the PRD file
        const content = await fs.readFile(prdPath, 'utf-8');
        const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!frontmatterMatch) {
          if (this.debug) {
            logger.debug(`[PrdSetOrchestrator] No YAML frontmatter in ${prdPath}`);
          }
          continue;
        }

        const prdYaml = yamlParse(frontmatterMatch[1]);
        const phases = prdYaml.requirements?.phases || [];

        for (const phase of phases) {
          const phaseTasks = phase.tasks || [];
          const phaseId = phase.id;

          for (const taskDef of phaseTasks) {
            try {
              // Skip tasks that already exist
              const existingTask = await taskBridge.getTask(taskDef.id);
              if (existingTask) {
                if (this.debug) {
                  logger.debug(`[PrdSetOrchestrator] Task ${taskDef.id} already exists, skipping`);
                }
                continue;
              }

              // Map MoSCoW priority to Task Master priority
              // MoSCoW: must, should, could, wont -> Task Master: critical, high, medium, low
              const priorityMap: Record<string, string> = {
                'must': 'critical',
                'should': 'high',
                'could': 'medium',
                'wont': 'low',
                // Also support direct Task Master priorities
                'critical': 'critical',
                'high': 'high',
                'medium': 'medium',
                'low': 'low',
              };
              const rawPriority = (taskDef.priority || 'medium').toLowerCase();
              const mappedPriority = (priorityMap[rawPriority] || 'medium') as 'low' | 'medium' | 'high' | 'critical';

              // Create task with prdSetId for filtering
              const task: Omit<Task, 'status'> & { status?: TaskStatus } = {
                id: taskDef.id,
                title: taskDef.title || `Task ${taskDef.id}`,
                description: taskDef.description || '',
                priority: mappedPriority,
                status: 'pending' as TaskStatus,
                // Store prdSetId, prdId, phaseId in details for filtering
                details: JSON.stringify({
                  prdSetId: discoveredSet.setId,
                  prdId: prd.id,
                  phaseId: phaseId,
                  acceptanceCriteria: taskDef.acceptanceCriteria,
                  targetFiles: taskDef.targetFiles,
                  validation: taskDef.validation,
                }),
              };

              // Add dependencies if present
              if (taskDef.dependencies && Array.isArray(taskDef.dependencies)) {
                (task as any).dependencies = taskDef.dependencies;
              }

              await taskBridge.createTask(task);
              tasksCreated++;

              if (this.debug) {
                logger.debug(`[PrdSetOrchestrator] Created task: ${taskDef.id} (PRD: ${prd.id}, Phase: ${phaseId})`);
              }
            } catch (taskError: any) {
              errors.push(`Failed to create task ${taskDef.id}: ${taskError.message}`);
            }
          }
        }
      } catch (prdError: any) {
        errors.push(`Failed to process PRD ${prd.id}: ${prdError.message}`);
      }
    }

    if (this.debug) {
      logger.debug(`[PrdSetOrchestrator] Task population complete: ${tasksCreated} tasks created, ${errors.length} errors`);
    }

    // Emit event for metrics (use prdId for PRD set-level events)
    emitEvent('prd_set:tasks_populated', {
      prdSetId: discoveredSet.setId,
      tasksCreated,
      errors: errors.length,
    }, { prdId: discoveredSet.setId });

    return { tasksCreated, errors };
  }
}

