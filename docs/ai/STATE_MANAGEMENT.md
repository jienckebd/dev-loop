# State Management in Dev-Loop

## Overview

Dev-loop uses a LangGraph-based state management system with the "Ralph pattern" - fresh context per iteration with persistent learnings.

## Architecture

### LangGraph StateGraph

The core execution flow uses LangGraph's StateGraph for workflow orchestration:

```
┌─────────────────────────────────────────────────────────┐
│                    IterationRunner                       │
│  (Fresh context orchestration - Ralph pattern)          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   ┌─────────────┐     ┌─────────────┐     ┌───────────┐ │
│   │ ContextHandoff │──▶│ LangGraph   │──▶│ Learnings │ │
│   │ (handoff.md)   │   │ StateGraph  │   │ Manager   │ │
│   └─────────────┘     └──────┬──────┘   └───────────┘ │
│                              │                         │
│                    ┌─────────▼─────────┐              │
│                    │  FileCheckpointer  │              │
│                    │  (checkpoints/)    │              │
│                    └───────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `IterationRunner` | `src/core/execution/iteration-runner.ts` | Fresh context outer loop |
| `ContextHandoff` | `src/core/execution/context-handoff.ts` | Handoff document generation |
| `LearningsManager` | `src/core/execution/learnings-manager.ts` | Learnings persistence |
| `FileCheckpointer` | `src/core/execution/langgraph/checkpointer.ts` | LangGraph state persistence |
| `TaskMasterBridge` | `src/core/execution/task-bridge.ts` | Task management and retry counts |

## State Files

All state files are in `.devloop/` directory:

| File | Purpose | Manager |
|------|---------|---------|
| `checkpoints/*.json` | LangGraph workflow state | FileCheckpointer |
| `handoff.md` | Context for fresh iterations | ContextHandoff |
| `progress.md` | Learnings and progress | LearningsManager |
| `learned-patterns.md` | Discovered patterns | LearningsManager |
| `retry-counts.json` | Task retry tracking | TaskMasterBridge |
| `execution-state.json` | PRD coordination | PrdCoordinator |
| `metrics.json` | Execution metrics | Metrics classes |

## The Ralph Pattern

The execution model follows "Ralph's pattern" of fresh AI context per iteration:

1. **Generate Handoff** - Create context document from current state
2. **Execute Iteration** - Run single workflow iteration with LangGraph
3. **Persist Learnings** - Save discoveries to progress.md
4. **Update Patterns** - Store reusable patterns
5. **Check Completion** - Continue or stop based on results

```typescript
// IterationRunner.runWithFreshContext()
while (iteration < maxIterations) {
  // 1. Generate handoff context
  const handoff = await this.contextHandoff.generate();
  
  // 2. Execute single iteration with fresh LangGraph state
  const result = await this.executeIteration(handoff);
  
  // 3. Persist learnings
  await this.learningsManager.persist(result.learnings);
  
  // 4. Check completion
  if (result.complete) break;
  
  iteration++;
}
```

## LangGraph Workflow State

The workflow state during execution includes:

```typescript
interface WorkflowState {
  threadId: string;
  task: Task | null;
  context: TaskContext | null;
  changes: CodeChanges | null;
  testResults: TestResult | null;
  status: WorkflowStatus;
  error: string | null;
  retryCount: number;
  handoffContext: HandoffContext;
}
```

State transitions are managed by LangGraph nodes:
- `fetchTask` - Get next pending task
- `generateChanges` - AI code generation
- `applyChanges` - Apply code patches
- `runTests` - Execute tests
- `analyzeResults` - Process test output
- `handleSuccess` - Mark task complete
- `handleFailure` - Create fix tasks or retry

## Checkpointing

LangGraph checkpoints enable:
- **Recovery** - Resume from last checkpoint on restart
- **Debugging** - Inspect state at any point
- **Branching** - Explore different execution paths

```typescript
// Checkpoints stored per thread
// .devloop/checkpoints/{threadId}/{stepId}.json
const checkpointer = createFileCheckpointer('.devloop/checkpoints');
const graph = createWorkflowGraph().compile({ checkpointer });
```

## Learnings Persistence

Learnings are persisted to markdown files for AI consumption:

### progress.md
Contains execution history and learnings:
```markdown
# Progress

## Completed Tasks
- [x] REQ-1.1: Implemented user authentication

## Learnings
- Pattern: Always validate input before processing
- Discovery: Configuration uses hierarchical merging
```

### learned-patterns.md
Contains reusable patterns:
```markdown
# Learned Patterns

## Error Handling
- Always wrap async operations in try-catch
- Log errors with context before re-throwing

## Code Style
- Use early returns for guard clauses
- Prefer const over let
```

## Task and Retry Management

Tasks are managed via `TaskMasterBridge`:

```typescript
const bridge = new TaskMasterBridge(config);

// Get pending tasks
const tasks = await bridge.getPendingTasks();

// Update task status
await bridge.updateTaskStatus(taskId, 'in-progress');

// Track retries (stored in retry-counts.json)
await bridge.incrementRetryCount(taskId);
const retries = await bridge.getRetryCount(taskId);
```

## PRD Coordination

PRD sets use `PrdCoordinator` for multi-PRD execution:

```typescript
const coordinator = new PrdCoordinator(config);

// Initialize PRD set
await coordinator.coordinatePrdSet(prdSet);

// Track PRD state
await coordinator.updatePrdState(prdId, { status: 'running' });

// Set active PRD set for task filtering
await coordinator.setActivePrdSetId(setId);
```

## Parallel Execution

PRD set orchestration supports parallel execution:

```typescript
const orchestrator = new PrdSetOrchestrator(config);

// Execute PRD set with parallel runners
const result = await orchestrator.executePrdSet(prdSet, {
  parallel: true,
  maxConcurrent: 3,
});
```

Each PRD gets a fresh `IterationRunner` instance for isolation.

## Best Practices

1. **Use IterationRunner** - Default entry point for workflow execution
2. **Generate Handoffs** - Always create context document before iterations
3. **Persist Learnings** - Save patterns and discoveries for future use
4. **Check Retry Counts** - Use TaskMasterBridge for retry tracking
5. **Enable Checkpoints** - Use FileCheckpointer for recovery

## Migration from Legacy State

The old state management (StateManager, UnifiedStateManager) has been replaced:

| Old | New |
|-----|-----|
| `StateManager.getState()` | `TaskMasterBridge.getAllTasks()` |
| `StateManager.updateState()` | LangGraph state transitions |
| `UnifiedStateManager.recordMetrics()` | Metrics classes |
| `UnifiedStateManager.getPatterns()` | `LearningsManager.getPatterns()` |
| Workflow state object | LangGraph `WorkflowState` |
| Daemon mode | Parallel `IterationRunner` instances |
