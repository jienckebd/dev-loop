# State Dependencies Matrix

This document maps dev-loop features to their state file dependencies and expected usage patterns.

## State Management (LangGraph Architecture)

State is managed by LangGraph checkpoints and the handoff mechanism:

### Primary State Files

| File | Purpose | Managed By |
|------|---------|------------|
| `.devloop/checkpoints/*.json` | LangGraph workflow state | `FileCheckpointer` |
| `.devloop/handoff.md` | Context continuity for fresh iterations | `ContextHandoff` |
| `.devloop/progress.md` | Learnings and progress tracking | `LearningsManager` |
| `.devloop/learned-patterns.md` | Discovered patterns | `LearningsManager` |
| `.devloop/retry-counts.json` | Task retry tracking | `TaskMasterBridge` |
| `.devloop/execution-state.json` | PRD coordination state | `PrdCoordinator` |
| `.devloop/metrics.json` | Execution metrics | Metrics classes |

### Task Storage

| File | Purpose | Managed By |
|------|---------|------------|
| `.taskmaster/tasks.json` | Task definitions and status | `TaskMasterBridge` |

### Other Files

| File | Purpose |
|------|---------|
| `.devloop/patterns.json` | Legacy pattern storage |
| `.devloop/config/*.json` | Framework patterns |
| `.devloop/prd-building-checkpoints/*.json` | PRD building checkpoints |
| `.devloop/reports/*.md` | Generated reports |

## Feature State Dependencies

### Core System Features

| Feature | State Files | Implementation |
|---------|-------------|----------------|
| Workflow Execution | checkpoints/, handoff.md | LangGraph StateGraph |
| Context Handoff | handoff.md | ContextHandoff class |
| Learnings Persistence | progress.md, learned-patterns.md | LearningsManager |
| Task Management | tasks.json, retry-counts.json | TaskMasterBridge |
| PRD Coordination | execution-state.json | PrdCoordinator |
| Metrics Collection | metrics.json | Metrics classes |

### PRD Features

| Feature | State Files | Implementation |
|---------|-------------|----------------|
| PRD Set Orchestration | execution-state.json | PrdSetOrchestrator |
| Parallel Execution | checkpoints/ (per-PRD) | IterationRunner |
| Pattern Learning | learned-patterns.md | LearningsManager |
| Test Tracking | metrics.json | TestResultsTracker |

## Execution Flow

```
IterationRunner
    |
    +-- ContextHandoff.generate() -> handoff.md
    |
    +-- LangGraph StateGraph
    |       |
    |       +-- FileCheckpointer -> checkpoints/
    |       |
    |       +-- WorkflowNodes (fetch, generate, apply, test, etc.)
    |
    +-- LearningsManager.persist() -> progress.md, learned-patterns.md
```

## Key Classes

| Class | Location | Purpose |
|-------|----------|---------|
| `IterationRunner` | `src/core/execution/iteration-runner.ts` | Fresh context orchestration |
| `ContextHandoff` | `src/core/execution/context-handoff.ts` | Handoff document generation |
| `LearningsManager` | `src/core/execution/learnings-manager.ts` | Learnings persistence |
| `FileCheckpointer` | `src/core/execution/langgraph/checkpointer.ts` | LangGraph state checkpoints |
| `TaskMasterBridge` | `src/core/execution/task-bridge.ts` | Task and retry management |
| `PrdCoordinator` | `src/core/prd/coordination/coordinator.ts` | PRD execution coordination |
