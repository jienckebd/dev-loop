# Execution System

This directory contains workflow orchestration and task execution functionality.

## Structure

- **workflow.ts** - WorkflowEngine class (main orchestration loop)
- **task-bridge.ts** - TaskMasterBridge (wrapper around task-master-ai MCP)
- **intervention.ts** - InterventionSystem for hybrid mode approval flows
- **improvement-suggester.ts** - ImprovementSuggester for evolution mode insights
- **rollback-manager.ts** - RollbackManager for rollback functionality

## Key Features

- **Workflow Orchestration**: Main TDD loop (fetch task → generate code → run tests → analyze logs)
- **Task Management**: Bridge to Task Master MCP for task operations
- **Intervention Support**: Hybrid mode with approval workflows
- **Evolution Mode**: Improvement suggestions based on observations
- **Rollback Support**: Rollback functionality for failed executions

## Usage

```typescript
import { WorkflowEngine } from './execution/workflow';
import { TaskMasterBridge } from './execution/task-bridge';

// Initialize workflow engine
const engine = new WorkflowEngine(config);
const result = await engine.runOnce();

// Task management
const taskBridge = new TaskMasterBridge(config);
const task = await taskBridge.getTask(taskId);
```

## Related Files

- `src/core/prd/set/orchestrator.ts` - PRD set orchestration (higher level)
- `src/core/testing/` - Test execution
- `src/core/analysis/` - Error analysis and pattern learning

