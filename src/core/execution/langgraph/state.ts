/**
 * LangGraph Workflow State Schema
 *
 * Defines the state annotation for the LangGraph StateGraph.
 * Includes support for:
 * - Core workflow state (task, context, code changes, test results)
 * - Metrics and tracking
 * - Ralph pattern: learnings, files modified, handoff context
 * - Parallel execution support
 */

import { Annotation } from '@langchain/langgraph';
import { Task, CodeChanges, TaskContext, TestResult, LogAnalysis } from '../../../types';
import { HandoffContext } from '../context-handoff';

/**
 * Workflow status representing current state in the graph
 */
export type WorkflowStatus =
  | 'pending'
  | 'fetching'
  | 'building-context'
  | 'generating'
  | 'validating'
  | 'applying'
  | 'testing'
  | 'analyzing'
  | 'creating-fix'
  | 'suggesting'
  | 'capturing-learnings'
  | 'complete'
  | 'failed';

/**
 * Validation result from pre-apply checks
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  blockers?: string[];
}

/**
 * Result of applying code changes
 */
export interface ApplyResult {
  success: boolean;
  filesModified: string[];
  filesCreated: string[];
  filesDeleted: string[];
  errors?: string[];
  rollbackAvailable: boolean;
}

/**
 * Run metrics for the current iteration
 */
export interface RunMetrics {
  startTime: number;
  endTime?: number;
  durationMs?: number;
  tokensUsed: {
    input: number;
    output: number;
  };
  filesChanged: number;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  retryCount: number;
  stallDetected: boolean;
}

/**
 * Learning captured during iteration (Ralph pattern)
 */
export interface IterationLearning {
  type: 'pattern' | 'gotcha' | 'convention';
  name: string;
  guidance: string;
  evidence?: string;
  occurrences?: number;
}

/**
 * LangGraph State Annotation
 *
 * Uses Annotation.Root to define reducers for each state field.
 * Each field specifies:
 * - reducer: How to merge new values with existing state
 * - default: Initial value for the field
 */
export const WorkflowStateAnnotation = Annotation.Root({
  // === Core Workflow State ===

  /** Current task being processed */
  task: Annotation<Task | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  /** Task context with project files and codebase context */
  context: Annotation<TaskContext | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  /** Generated code changes from AI */
  codeChanges: Annotation<CodeChanges | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  /** Validation result from pre-apply checks */
  validationResult: Annotation<ValidationResult | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  /** Result of applying code changes */
  applyResult: Annotation<ApplyResult | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  /** Test execution result */
  testResult: Annotation<TestResult | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  /** Log analysis from error investigation */
  logAnalysis: Annotation<LogAnalysis | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  /** Fix task created for failed tests */
  fixTask: Annotation<Task | null>({
    reducer: (_, b) => b,
    default: () => null,
  }),

  /** Current workflow status */
  status: Annotation<WorkflowStatus>({
    reducer: (_, b) => b,
    default: () => 'pending',
  }),

  /** Error message if workflow failed */
  error: Annotation<string | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  // === Metrics and Tracking ===

  /** Run metrics for the current iteration */
  metrics: Annotation<RunMetrics | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  // === Ralph Pattern: Learnings ===

  /** Learnings captured during this iteration (accumulator) */
  learnings: Annotation<IterationLearning[]>({
    reducer: (a, b) => [...(a || []), ...(b || [])],
    default: () => [],
  }),

  /** Files modified during this iteration (unique set) */
  filesModified: Annotation<string[]>({
    reducer: (a, b) => [...new Set([...(a || []), ...(b || [])])],
    default: () => [],
  }),

  // === Handoff Context ===

  /** Handoff context from previous iteration */
  handoffContext: Annotation<HandoffContext | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  // === Parallel Execution Support ===

  /** PRD ID for parallel execution tracking */
  prdId: Annotation<string | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  /** Phase ID within PRD */
  phaseId: Annotation<number | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  /** PRD Set ID for task namespacing */
  prdSetId: Annotation<string | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  /** Dependency level for parallel task grouping */
  dependencyLevel: Annotation<number | undefined>({
    reducer: (_, b) => b,
    default: () => undefined,
  }),

  // === Parallel Task Execution ===

  /** Tasks to execute in parallel at current dependency level */
  parallelTasks: Annotation<Task[]>({
    reducer: (_, b) => b,
    default: () => [],
  }),

  /** Aggregated results from parallel task execution */
  parallelResults: Annotation<Array<{
    taskId: string;
    success: boolean;
    filesModified: string[];
    learnings: IterationLearning[];
    error?: string;
  }>>({
    reducer: (a, b) => [...(a || []), ...(b || [])],
    default: () => [],
  }),
});

/**
 * Type alias for the workflow state
 */
export type WorkflowState = typeof WorkflowStateAnnotation.State;

/**
 * Create initial workflow state with optional overrides
 */
export function createInitialState(overrides?: Partial<WorkflowState>): Partial<WorkflowState> {
  return {
    task: null,
    context: null,
    codeChanges: null,
    validationResult: null,
    applyResult: null,
    testResult: null,
    logAnalysis: null,
    fixTask: null,
    status: 'pending',
    error: undefined,
    metrics: undefined,
    learnings: [],
    filesModified: [],
    handoffContext: undefined,
    prdId: undefined,
    phaseId: undefined,
    prdSetId: undefined,
    dependencyLevel: undefined,
    parallelTasks: [],
    parallelResults: [],
    ...overrides,
  };
}

/**
 * Check if state indicates workflow completion
 */
export function isWorkflowComplete(state: WorkflowState): boolean {
  return state.status === 'complete' || state.status === 'failed';
}

/**
 * Check if state indicates a recoverable error
 */
export function isRecoverableError(state: WorkflowState): boolean {
  return state.status === 'failed' && !!state.fixTask;
}
