# Execution System

This directory contains workflow orchestration and task execution functionality.

## Structure

- **iteration-runner.ts** - IterationRunner class (main entry point, implements Ralph pattern)
- **task-bridge.ts** - TaskMasterBridge (wrapper around task-master-ai MCP)
- **langgraph/** - LangGraph workflow nodes and state management
- **context-handoff.ts** - Context handoff generation for fresh AI context
- **learnings-manager.ts** - Learnings and pattern persistence

## Key Features

- **Fresh-Context Execution**: Ralph pattern with clean AI context per iteration
- **LangGraph Orchestration**: Node-based workflow (fetch → context → generate → apply → test)
- **Task Management**: Bridge to Task Master MCP for task operations
- **Learnings Persistence**: Progress tracking and pattern discovery
- **Cross-PRD Checkpointing**: Shared state across PRD sets

## Usage

```typescript
import { IterationRunner } from './execution/iteration-runner';
import { TaskMasterBridge } from './execution/task-bridge';

// Initialize and run with fresh-context mode
const runner = new IterationRunner(config);
const result = await runner.runWithFreshContext();

// Task management
const taskBridge = new TaskMasterBridge(config);
const task = await taskBridge.getTask(taskId);
```
