/**
 * LangGraph StateGraph Definition
 *
 * Defines the workflow graph with nodes and conditional edges.
 * Supports parallel task execution within dependency levels.
 */

import { StateGraph, END, START } from '@langchain/langgraph';
import { MemorySaver, BaseCheckpointSaver } from '@langchain/langgraph';
import { WorkflowStateAnnotation, WorkflowState } from './state';
import * as nodes from './nodes';
import { AIProvider } from '../../../providers/ai/interface';
import { TaskMasterBridge } from '../task-bridge';
import { Config } from '../../../config/schema/core';
import { CodeContextProvider } from '../../analysis/code/context-provider';
import { logger } from '../../utils/logger';

export interface WorkflowGraphConfig {
  aiProvider: AIProvider;
  taskBridge: TaskMasterBridge;
  config: Config;
  codeContextProvider: CodeContextProvider;
  checkpointer?: BaseCheckpointSaver;
  debug?: boolean;
  maxConcurrency?: number;
  parallelThreshold?: number;
  // Optional component overrides
  validationGate?: {
    validate: (changes: any) => Promise<any>;
  };
  testRunner?: {
    run: (testPath?: string) => Promise<any>;
  };
  logAnalyzer?: {
    analyze: (logs: string) => Promise<any>;
  };
  rollbackManager?: {
    createCheckpoint: (files: string[]) => Promise<string>;
    rollback: (checkpointId: string) => Promise<void>;
  };
}

export type CompiledWorkflowGraph = ReturnType<typeof createWorkflowGraph>;

/**
 * Create the workflow StateGraph
 */
export function createWorkflowGraph(graphConfig: WorkflowGraphConfig) {
  const {
    aiProvider,
    taskBridge,
    config,
    codeContextProvider,
    checkpointer,
    debug,
    maxConcurrency = 1,
    parallelThreshold = 2,
    validationGate,
    testRunner,
    logAnalyzer,
    rollbackManager,
  } = graphConfig;

  if (debug) {
    logger.debug('[Graph] Creating workflow StateGraph');
  }

  // Create the graph with state annotation
  const graph = new StateGraph(WorkflowStateAnnotation)
    // === Core workflow nodes ===
    .addNode('fetchTask', nodes.fetchTask({
      taskBridge,
      config,
      maxConcurrency,
      debug,
    }))

    .addNode('buildContext', nodes.buildContext({
      config,
      codeContextProvider,
      debug,
    }))

    .addNode('generateCode', nodes.generateCode({
      aiProvider,
      config,
      debug,
    }))

    .addNode('validateCode', nodes.validateCode({
      config,
      debug,
      validationGate,
    }))

    .addNode('applyChanges', nodes.applyChanges({
      config,
      debug,
      rollbackManager,
    }))

    .addNode('runTests', nodes.runTests({
      config,
      debug,
      testRunner,
    }))

    .addNode('analyzeFailure', nodes.analyzeFailure({
      aiProvider,
      config,
      debug,
      logAnalyzer,
    }))

    .addNode('createFixTask', nodes.createFixTask({
      taskBridge,
      config,
      debug,
    }))

    .addNode('suggestImprovements', nodes.suggestImprovements({
      config,
      debug,
    }))

    // === Ralph pattern: capture learnings ===
    .addNode('captureLearnings', nodes.captureLearnings({
      config,
      debug,
    }))

    // === Linear edges ===
    .addEdge(START, 'fetchTask')

    // After fetch: check if task exists and route based on parallel task count
    .addConditionalEdges('fetchTask', (state: WorkflowState) => {
      if (!state.task && (!state.parallelTasks || state.parallelTasks.length === 0)) {
        // No tasks available
        logger.debug('[Graph] No tasks available, ending workflow');
        return 'end';
      }

      // Check if parallel execution should be used
      const taskCount = state.parallelTasks?.length || 1;
      const shouldParallel = taskCount >= parallelThreshold && maxConcurrency > 1;

      if (shouldParallel) {
        logger.info(`[Graph] Routing to parallel execution: ${taskCount} tasks at level ${state.dependencyLevel}`);
        // For now, parallel tasks are processed sequentially in this graph
        // True parallel execution happens at the IterationRunner level
        // This edge is for future LangGraph parallel branch support
      }

      return 'buildContext';
    }, {
      buildContext: 'buildContext',
      end: END,
    })

    .addEdge('buildContext', 'generateCode')

    // After generate: check if code was produced
    .addConditionalEdges('generateCode', (state: WorkflowState) => {
      if (!state.codeChanges?.files?.length) {
        // No code generated, capture learnings and end
        return 'captureLearnings';
      }
      return 'validateCode';
    }, {
      validateCode: 'validateCode',
      captureLearnings: 'captureLearnings',
    })

    // After validate: check if valid
    .addConditionalEdges('validateCode', (state: WorkflowState) => {
      if (!state.validationResult?.valid) {
        // Validation failed, analyze and create fix
        return 'analyzeFailure';
      }
      return 'applyChanges';
    }, {
      applyChanges: 'applyChanges',
      analyzeFailure: 'analyzeFailure',
    })

    // After apply: check if successful
    .addConditionalEdges('applyChanges', (state: WorkflowState) => {
      if (!state.applyResult?.success) {
        // Apply failed
        return 'analyzeFailure';
      }
      return 'runTests';
    }, {
      runTests: 'runTests',
      analyzeFailure: 'analyzeFailure',
    })

    // After tests: determine next step
    .addConditionalEdges('runTests', (state: WorkflowState) => {
      if (state.testResult?.success) {
        // Tests passed, capture learnings
        return 'captureLearnings';
      }

      // Check for stall
      const isStalled = state.metrics?.stallDetected ||
        (state.metrics?.retryCount || 0) >= 3;

      if (isStalled) {
        // Too many failures, suggest improvements
        return 'suggestImprovements';
      }

      // Analyze failure and create fix task
      return 'analyzeFailure';
    }, {
      captureLearnings: 'captureLearnings',
      analyzeFailure: 'analyzeFailure',
      suggestImprovements: 'suggestImprovements',
    })

    // After analyze: create fix task
    .addEdge('analyzeFailure', 'createFixTask')

    // After fix task: capture learnings
    .addEdge('createFixTask', 'captureLearnings')

    // After suggestions: capture learnings
    .addEdge('suggestImprovements', 'captureLearnings')

    // After learnings: end
    .addEdge('captureLearnings', END);

  // Compile with checkpointing
  const effectiveCheckpointer = checkpointer || new MemorySaver();

  if (debug) {
    logger.debug('[Graph] Compiling graph with checkpointer');
  }

  return graph.compile({ checkpointer: effectiveCheckpointer });
}

/**
 * Create initial state for graph invocation
 */
export function createInitialGraphState(
  handoffContext?: any,
  prdContext?: { prdId?: string; phaseId?: number; prdSetId?: string }
): Partial<WorkflowState> {
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
    handoffContext,
    prdId: prdContext?.prdId,
    phaseId: prdContext?.phaseId,
    prdSetId: prdContext?.prdSetId,
    parallelTasks: [],
    parallelResults: [],
  };
}

/**
 * Generate a unique thread ID for graph invocation
 */
export function generateThreadId(prefix: string = 'iteration'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}
