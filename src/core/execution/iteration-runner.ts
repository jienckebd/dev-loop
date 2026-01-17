/**
 * IterationRunner - Fresh Context Outer Loop (Ralph Pattern)
 *
 * The DEFAULT entry point for workflow execution.
 * Implements Ralph's pattern of fresh AI context per iteration:
 * 1. Generate handoff document (current state)
 * 2. Execute single workflow iteration with LangGraph
 * 3. Persist learnings to progress.md
 * 4. Update patterns file with discoveries
 * 5. Check completion or continue
 */

import { Config } from '../../config/schema/core';
import { TaskMasterBridge } from './task-bridge';
import { LearningsManager, Pattern } from './learnings-manager';
import { ContextHandoff, HandoffContext } from './context-handoff';
import { SpecKitContext } from '../prd/parser/planning-doc-parser';
import {
  createWorkflowGraph,
  createInitialGraphState,
  generateThreadId,
  createFileCheckpointer,
  WorkflowState,
  CrossPrdCheckpointer,
} from './langgraph';
import { AIProviderFactory } from '../../providers/ai/factory';
import { CodeContextProvider } from '../analysis/code/context-provider';
import { logger } from '../utils/logger';
import { emitEvent } from '../utils/event-stream';
import {
  EventMetricBridge,
  initializeEventMetricBridge,
  getEventMetricBridge
} from '../metrics/event-metric-bridge';
import { PrdMetrics } from '../metrics/prd';
import { PrdSetMetrics } from '../metrics/prd-set';
import { PhaseHookExecutor, findPhaseFilePath } from './phase-hook-executor';

export interface IterationConfig {
  /** Maximum iterations before stopping */
  maxIterations: number;
  /** Context usage threshold (0-100) for auto-handoff */
  contextThreshold: number;
  /** Enable automatic handoff when context threshold reached */
  autoHandoff: boolean;
  /** Persist learnings to progress.md */
  persistLearnings: boolean;
  /** Update patterns file with discoveries */
  updatePatterns: boolean;
  /** Iteration-based handoff interval (every N iterations) */
  handoffInterval: number;
}

export interface IterationResult {
  status: 'complete' | 'max-iterations' | 'failed' | 'stalled';
  iterations: number;
  duration: number;
  tasksCompleted: number;
  tasksFailed: number;
  patternsDiscovered: number;
  error?: string;
  /** Accumulated metrics across all iterations */
  metrics?: {
    tokensUsed?: { input: number; output: number };
    testsRun?: number;
    testsPassed?: number;
    testsFailed?: number;
    filesChanged?: number;
  };
}

const DEFAULT_CONFIG: IterationConfig = {
  maxIterations: 100,
  contextThreshold: 90,
  autoHandoff: true,
  persistLearnings: true,
  updatePatterns: true,
  handoffInterval: 5,
};

/**
 * IterationRunner - The default entry point for workflow execution
 *
 * Creates a fresh LangGraph workflow per iteration, implementing
 * Ralph's pattern of clean context per iteration.
 */
export class IterationRunner {
  private learningsManager: LearningsManager;
  private contextHandoff: ContextHandoff;
  private taskBridge: TaskMasterBridge;
  private iterationConfig: IterationConfig;
  private specKitContext?: SpecKitContext;
  private sharedCheckpointer?: CrossPrdCheckpointer;
  private eventMetricBridge?: EventMetricBridge;
  private prdMetrics: PrdMetrics;
  private prdSetMetrics: PrdSetMetrics;
  private iteration = 0;
  private tasksCompleted = 0;
  private tasksFailed = 0;
  private patternsDiscovered = 0;

  /** Track retry counts per task to prevent infinite loops */
  private taskRetryCount: Map<string, number> = new Map();
  private readonly maxTaskRetries = 3;

  /** Track completed phases to trigger hooks only once */
  private completedPhases: Set<string> = new Set();
  private phaseHookExecutor?: PhaseHookExecutor;

  /** Accumulated metrics across all iterations */
  private accumulatedMetrics = {
    tokensInput: 0,
    tokensOutput: 0,
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    filesChanged: 0,
  };

  constructor(
    private config: Config,
    iterationConfig: Partial<IterationConfig> = {},
    specKitContext?: SpecKitContext,
    sharedCheckpointer?: CrossPrdCheckpointer
  ) {
    this.iterationConfig = { ...DEFAULT_CONFIG, ...iterationConfig };
    this.specKitContext = specKitContext;
    this.sharedCheckpointer = sharedCheckpointer;
    this.learningsManager = new LearningsManager(config);
    this.contextHandoff = new ContextHandoff(config, {
      threshold: this.iterationConfig.contextThreshold,
      iterationInterval: this.iterationConfig.handoffInterval,
    });
    this.taskBridge = new TaskMasterBridge(config);

    // Initialize metrics
    this.prdMetrics = new PrdMetrics();
    this.prdSetMetrics = new PrdSetMetrics();

    // Initialize event-metric bridge for enhanced metrics collection
    this.eventMetricBridge = initializeEventMetricBridge({
      prdMetrics: this.prdMetrics,
      prdSetMetrics: this.prdSetMetrics,
      enabled: true,
      debug: config.debug,
    });

    // Initialize phase hook executor
    this.phaseHookExecutor = new PhaseHookExecutor(config, config.debug);
  }

  /**
   * Run PRD with fresh context per iteration (Ralph pattern)
   *
   * This is the main entry point that orchestrates:
   * 1. Fresh LangGraph workflow per iteration
   * 2. Handoff document generation
   * 3. Learnings persistence
   * 4. Pattern discovery and persistence
   */
  async runWithFreshContext(prdPath?: string): Promise<IterationResult> {
    const startTime = Date.now();

    // Start event-metric bridge for enhanced metrics collection
    if (this.eventMetricBridge) {
      this.eventMetricBridge.start();
      logger.debug('[IterationRunner] Started event-metric bridge');
    }

    emitEvent('iteration:started', {
      prdPath,
      maxIterations: this.iterationConfig.maxIterations,
      timestamp: new Date().toISOString(),
    });

    logger.info(`[IterationRunner] Starting fresh-context execution`);

    try {
      while (!await this.isComplete()) {
        this.iteration++;
        this.contextHandoff.setIteration(this.iteration);

        // Check max iterations
        if (this.iteration > this.iterationConfig.maxIterations) {
          logger.warn(`[IterationRunner] Max iterations reached: ${this.iterationConfig.maxIterations}`);
          return this.buildResult('max-iterations', startTime);
        }

        logger.info(`[IterationRunner] === Iteration ${this.iteration} ===`);

        // 1. Generate handoff document (captures state for fresh context)
        const handoff = await this.contextHandoff.generateHandoff(this.iteration);

        // 2. Execute iteration with fresh LangGraph workflow
        const result = await this.executeIteration(handoff);

        // 2.5. Accumulate metrics from this iteration
        if (result.metrics) {
          this.accumulatedMetrics.tokensInput += result.metrics.tokensUsed?.input || 0;
          this.accumulatedMetrics.tokensOutput += result.metrics.tokensUsed?.output || 0;
          this.accumulatedMetrics.testsRun += result.metrics.testsRun || 0;
          this.accumulatedMetrics.testsPassed += result.metrics.testsPassed || 0;
          this.accumulatedMetrics.testsFailed += result.metrics.testsFailed || 0;
          this.accumulatedMetrics.filesChanged += result.metrics.filesChanged || 0;
        }

        // 3. Persist learnings (Ralph's progress.txt pattern)
        if (this.iterationConfig.persistLearnings) {
          await this.persistIterationLearnings(result);
        }

        // 4. Update patterns with discoveries (Ralph's AGENTS.md pattern)
        if (this.iterationConfig.updatePatterns && result.learnings?.length) {
          await this.updatePatterns(result);
        }

        // 5. Track results and update task status
        if (result.status === 'complete' && result.task) {
          this.tasksCompleted++;
          // Mark task as done in TaskBridge
          await this.taskBridge.updateTaskStatus(String(result.task.id), 'done');
          // Clear retry count on success
          this.taskRetryCount.delete(String(result.task.id));
          logger.info(`[IterationRunner] Task ${result.task.id} marked as done`);

          // Check for phase completion and execute hooks
          await this.checkPhaseCompletionAndExecuteHooks(result);
        } else if (result.status === 'failed' && result.task) {
          const taskId = String(result.task.id);
          const currentRetries = (this.taskRetryCount.get(taskId) || 0) + 1;
          this.taskRetryCount.set(taskId, currentRetries);

          logger.warn(`[IterationRunner] Task ${taskId} failed (attempt ${currentRetries}/${this.maxTaskRetries}): ${result.error || 'Unknown error'}`);

          if (currentRetries >= this.maxTaskRetries) {
            // Mark task as blocked after too many retries
            this.tasksFailed++;
            await this.taskBridge.updateTaskStatus(taskId, 'blocked');
            this.taskRetryCount.delete(taskId);
            logger.error(`[IterationRunner] Task ${taskId} marked as blocked after ${this.maxTaskRetries} failed attempts`);

            // Emit task:blocked event
            emitEvent('task:blocked', {
              taskId,
              prdId: result.prdId,
              phaseId: result.phaseId,
              attempts: currentRetries,
              lastError: result.error || 'Unknown error',
            }, {
              taskId,
              prdId: result.prdId,
              phaseId: result.phaseId ? Number(result.phaseId) : undefined,
              severity: 'error',
            });
          }
          // If not yet at max retries, task stays pending and will be retried next iteration
        }

        // 6. Check for handoff (iteration-based or context threshold)
        if (await this.contextHandoff.shouldTriggerHandoff()) {
          await this.contextHandoff.triggerHandoff();
        }

        // 7. Check for stall
        if (result.metrics?.stallDetected) {
          logger.warn('[IterationRunner] Workflow stalled');
          return this.buildResult('stalled', startTime, result.error);
        }
      }

      logger.info(`[IterationRunner] All tasks complete after ${this.iteration} iterations`);

      // Share qualified patterns for cross-PRD access
      try {
        // Get prdSetId from sharedCheckpointer if available
        const prdSetId = this.sharedCheckpointer
          ? (await this.sharedCheckpointer.getSharedState()).prdSetId
          : 'default';
        const targetModule = (this.config as any).targetModule as string | undefined;

        await this.learningsManager.shareQualifiedPatterns(prdSetId, targetModule);
      } catch (patternError) {
        logger.warn(`[IterationRunner] Failed to share patterns: ${patternError}`);
      }

      return this.buildResult('complete', startTime);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[IterationRunner] Error: ${errorMessage}`);
      return this.buildResult('failed', startTime, errorMessage);
    } finally {
      // Stop event-metric bridge
      if (this.eventMetricBridge) {
        this.eventMetricBridge.stop();
        logger.debug('[IterationRunner] Stopped event-metric bridge');
      }
    }
  }

  /**
   * Execute a single iteration with fresh LangGraph workflow
   */
  private async executeIteration(handoff: HandoffContext): Promise<WorkflowState> {
    // Create fresh AI provider
    const aiProvider = AIProviderFactory.create(this.config);

    // Create fresh code context provider
    const codeContextProvider = new CodeContextProvider(this.config.debug);

    // Use shared checkpointer if available (for cross-PRD coordination),
    // otherwise create fresh file-based checkpointer
    const checkpointer = this.sharedCheckpointer || createFileCheckpointer({
      debug: this.config.debug,
    });

    // Get iteration config for parallel execution
    const iterationCfg = (this.config as any).iteration || {};
    const maxConcurrency = iterationCfg.maxConcurrency || 1;
    const parallelThreshold = iterationCfg.parallelThreshold || 2;

    // Create fresh workflow graph
    const graph = createWorkflowGraph({
      aiProvider,
      taskBridge: this.taskBridge,
      config: this.config,
      codeContextProvider,
      checkpointer,
      debug: this.config.debug,
      maxConcurrency,
      parallelThreshold,
    });

    // Create initial state with handoff context
    const initialState = createInitialGraphState(handoff);

    // Generate unique thread ID for this iteration
    const threadId = generateThreadId(`iter-${this.iteration}`);

    try {
      // Invoke the graph
      const result = await graph.invoke(initialState, {
        configurable: { thread_id: threadId },
      });

      return result as WorkflowState;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[IterationRunner] Iteration ${this.iteration} failed: ${errorMessage}`);

      // Return failed state
      return {
        task: null,
        context: null,
        codeChanges: null,
        validationResult: null,
        applyResult: null,
        testResult: null,
        logAnalysis: null,
        fixTask: null,
        status: 'failed',
        error: errorMessage,
        metrics: undefined,
        learnings: [],
        filesModified: [],
        handoffContext: handoff,
        prdId: undefined,
        phaseId: undefined,
        prdSetId: undefined,
        dependencyLevel: undefined,
        parallelTasks: [],
        parallelResults: [],
      };
    }
  }

  /**
   * Persist iteration learnings to progress.md
   */
  private async persistIterationLearnings(result: WorkflowState): Promise<void> {
    await this.learningsManager.persistIteration({
      iteration: this.iteration,
      result: {
        taskId: result.task?.id,
        completed: result.status === 'complete',
        error: result.error,
        learnings: result.learnings?.map(l => l.guidance),
        patterns: result.learnings
          ?.filter(l => l.type === 'pattern')
          .map(l => ({
            name: l.name,
            guidance: l.guidance,
            occurrences: l.occurrences || 1,
            lastSeen: new Date().toISOString(),
          })),
        filesModified: result.filesModified,
      },
      duration: 0, // Duration tracked at run level
    });
  }

  /**
   * Update patterns file with discoveries
   */
  private async updatePatterns(result: WorkflowState): Promise<void> {
    const patterns: Pattern[] = result.learnings
      ?.filter(l => l.type === 'pattern')
      .map(l => ({
        name: l.name,
        guidance: l.guidance,
        occurrences: l.occurrences || 1,
        lastSeen: new Date().toISOString(),
      })) || [];

    if (patterns.length > 0) {
      this.patternsDiscovered += patterns.length;
      await this.learningsManager.updateRulesFile(patterns);
    }
  }

  /**
   * Check if all tasks are complete
   */
  private async isComplete(): Promise<boolean> {
    const pending = await this.taskBridge.getPendingTasks();
    return pending.length === 0;
  }

  /**
   * Check if a phase is complete and execute onPhaseComplete hooks
   *
   * A phase is complete when all tasks in that phase are done or blocked.
   * Only executes hooks once per phase.
   */
  private async checkPhaseCompletionAndExecuteHooks(result: WorkflowState): Promise<void> {
    // Need prdId and phaseId to check phase completion
    if (!result.prdId || !result.phaseId) {
      logger.debug('[IterationRunner] Task result missing prdId or phaseId, skipping phase hook check');
      return;
    }

    const phaseKey = `${result.prdId}-phase-${result.phaseId}`;

    // Skip if already processed
    if (this.completedPhases.has(phaseKey)) {
      return;
    }

    try {
      // Get all tasks for this phase
      const allTasks = await this.taskBridge.getAllTasks();
      const phaseTasks = allTasks.filter((t: any) => {
        try {
          const details = t.details ? JSON.parse(t.details) : {};
          return details.prdId === result.prdId &&
                 (details.phaseId === result.phaseId || String(details.phaseId) === String(result.phaseId));
        } catch {
          return false;
        }
      });

      // Check if all phase tasks are complete (done or blocked)
      const phaseComplete = phaseTasks.length > 0 && phaseTasks.every((t: any) =>
        t.status === 'done' || t.status === 'blocked'
      );

      if (!phaseComplete) {
        logger.debug(`[IterationRunner] Phase ${phaseKey} not yet complete: ${phaseTasks.filter((t: any) => t.status === 'pending' || t.status === 'in-progress').length} tasks remaining`);
        return;
      }

      // Mark phase as completed to prevent re-execution
      this.completedPhases.add(phaseKey);

      logger.info(`[IterationRunner] Phase ${phaseKey} complete! Checking for onPhaseComplete hooks...`);

      // Emit phase:completed event
      emitEvent('phase:completed', {
        prdId: result.prdId,
        phaseId: result.phaseId,
        tasksCompleted: phaseTasks.filter((t: any) => t.status === 'done').length,
        tasksFailed: phaseTasks.filter((t: any) => t.status === 'blocked').length,
      }, {
        prdId: result.prdId,
        phaseId: typeof result.phaseId === 'number' ? result.phaseId : parseInt(String(result.phaseId), 10),
      });

      // Find phase file and execute hooks
      if (!this.phaseHookExecutor) {
        logger.debug('[IterationRunner] Phase hook executor not initialized');
        return;
      }

      // Get prdSetId from task details to find the phase file
      const taskDetails = result.task?.details ? JSON.parse(result.task.details) : {};
      const prdSetId = taskDetails.prdSetId;

      if (!prdSetId) {
        logger.debug('[IterationRunner] Task missing prdSetId, cannot find phase file');
        return;
      }

      // Look for phase file in the PRD set directory
      const prdSetDir = `.taskmaster/production/${prdSetId}`;
      const phaseFilePath = findPhaseFilePath(prdSetDir, result.prdId, result.phaseId);

      if (!phaseFilePath) {
        logger.debug(`[IterationRunner] Phase file not found for ${phaseKey} in ${prdSetDir}`);
        return;
      }

      logger.info(`[IterationRunner] Executing onPhaseComplete hooks for ${phaseFilePath}`);

      const hookResults = await this.phaseHookExecutor.executeOnPhaseComplete(phaseFilePath, {
        prdId: result.prdId,
        phaseId: result.phaseId,
      });

      if (hookResults.length > 0) {
        const successCount = hookResults.filter(r => r.success).length;
        const failCount = hookResults.filter(r => !r.success).length;
        logger.info(`[IterationRunner] Phase hooks executed: ${successCount} succeeded, ${failCount} failed`);
      }
    } catch (error) {
      logger.warn(`[IterationRunner] Error checking phase completion: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Build the final result
   */
  private buildResult(
    status: IterationResult['status'],
    startTime: number,
    error?: string
  ): IterationResult {
    const duration = Date.now() - startTime;

    emitEvent('iteration:completed', {
      status,
      iterations: this.iteration,
      duration,
      tasksCompleted: this.tasksCompleted,
      tasksFailed: this.tasksFailed,
      patternsDiscovered: this.patternsDiscovered,
      tokensInput: this.accumulatedMetrics.tokensInput,
      tokensOutput: this.accumulatedMetrics.tokensOutput,
      error,
      timestamp: new Date().toISOString(),
    });

    return {
      status,
      iterations: this.iteration,
      duration,
      tasksCompleted: this.tasksCompleted,
      tasksFailed: this.tasksFailed,
      patternsDiscovered: this.patternsDiscovered,
      error,
      metrics: {
        tokensUsed: {
          input: this.accumulatedMetrics.tokensInput,
          output: this.accumulatedMetrics.tokensOutput,
        },
        testsRun: this.accumulatedMetrics.testsRun,
        testsPassed: this.accumulatedMetrics.testsPassed,
        testsFailed: this.accumulatedMetrics.testsFailed,
        filesChanged: this.accumulatedMetrics.filesChanged,
      },
    };
  }

  /**
   * Get current iteration count
   */
  getIteration(): number {
    return this.iteration;
  }

  /**
   * Get discovered patterns
   */
  getDiscoveredPatterns(): Pattern[] {
    return this.learningsManager.getQualifiedPatterns();
  }
}

/**
 * Create an IterationRunner with default configuration
 */
export function createIterationRunner(
  config: Config,
  iterationConfig?: Partial<IterationConfig>
): IterationRunner {
  return new IterationRunner(config, iterationConfig);
}
