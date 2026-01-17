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
} from './langgraph';
import { AIProviderFactory } from '../../providers/ai/factory';
import { CodeContextProvider } from '../analysis/code/context-provider';
import { logger } from '../utils/logger';
import { emitEvent } from '../utils/event-stream';

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
 * Creates a fresh WorkflowEngine instance per iteration, implementing
 * Ralph's pattern of clean context per iteration.
 */
export class IterationRunner {
  private learningsManager: LearningsManager;
  private contextHandoff: ContextHandoff;
  private taskBridge: TaskMasterBridge;
  private iterationConfig: IterationConfig;
  private specKitContext?: SpecKitContext;
  private iteration = 0;
  private tasksCompleted = 0;
  private tasksFailed = 0;
  private patternsDiscovered = 0;

  constructor(
    private config: Config,
    iterationConfig: Partial<IterationConfig> = {},
    specKitContext?: SpecKitContext
  ) {
    this.iterationConfig = { ...DEFAULT_CONFIG, ...iterationConfig };
    this.specKitContext = specKitContext;
    this.learningsManager = new LearningsManager(config);
    this.contextHandoff = new ContextHandoff(config, {
      threshold: this.iterationConfig.contextThreshold,
      iterationInterval: this.iterationConfig.handoffInterval,
    });
    this.taskBridge = new TaskMasterBridge(config);
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

        // 3. Persist learnings (Ralph's progress.txt pattern)
        if (this.iterationConfig.persistLearnings) {
          await this.persistIterationLearnings(result);
        }

        // 4. Update patterns with discoveries (Ralph's AGENTS.md pattern)
        if (this.iterationConfig.updatePatterns && result.learnings?.length) {
          await this.updatePatterns(result);
        }

        // 5. Track results
        if (result.status === 'complete' && result.task) {
          this.tasksCompleted++;
        } else if (result.status === 'failed') {
          this.tasksFailed++;
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
      return this.buildResult('complete', startTime);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[IterationRunner] Error: ${errorMessage}`);
      return this.buildResult('failed', startTime, errorMessage);
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

    // Create fresh checkpointer (file-based for durability)
    const checkpointer = createFileCheckpointer({
      debug: this.config.debug,
    });

    // Create fresh workflow graph
    const graph = createWorkflowGraph({
      aiProvider,
      taskBridge: this.taskBridge,
      config: this.config,
      codeContextProvider,
      checkpointer,
      debug: this.config.debug,
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
