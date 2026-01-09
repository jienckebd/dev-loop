# Utilities

This directory contains shared utilities used across the dev-loop codebase.

## Structure

- **logger.ts** - Centralized logging system with file and console output
- **state-manager.ts** - StateManager for workflow state persistence
- **dependency-graph.ts** - DependencyGraphBuilder for building execution dependency graphs
- **event-stream.ts** - Event stream for workflow events
- **cost-calculator.ts** - CostCalculator for calculating AI token costs
- **output-formatter.ts** - OutputFormatter for formatting workflow results
- **agent-ipc.ts** - AgentIPC system for inter-process communication (Unix domain sockets)
- **template-manager.ts** - TemplateManager for managing code generation templates
- **playwright-mcp-integration.ts** - Playwright MCP integration for TDD workflows

## Key Features

- **Centralized Logging**: Unified logging with configurable output (file, console, MCP mode)
- **State Persistence**: Saves and restores workflow state for recovery
- **Dependency Analysis**: Builds dependency graphs for execution ordering
- **Event Streaming**: Emits workflow events for monitoring and integration
- **Cost Calculation**: Calculates AI token usage and costs

## Usage

```typescript
import { logger } from './utils/logger';
import { StateManager } from './utils/state-manager';
import { emitEvent } from './utils/event-stream';

// Logging
logger.info('Workflow started');
logger.debug('Debug information', { data });

// State management
const stateManager = new StateManager(config);
await stateManager.saveState(state);
const restoredState = await stateManager.loadState();

// Event streaming
emitEvent({ type: 'task-complete', taskId: '123' });
```

## Related Files

- All other core modules depend on utilities in this directory

