# Utilities

This directory contains shared utilities used across the dev-loop codebase.

## Structure

- **logger.ts** - Centralized logging system with file and console output
- **dependency-graph.ts** - DependencyGraphBuilder for building execution dependency graphs
- **event-stream.ts** - Event stream for workflow events
- **cost-calculator.ts** - CostCalculator for calculating AI token costs
- **output-formatter.ts** - OutputFormatter for formatting workflow results
- **agent-ipc.ts** - AgentIPC system for inter-process communication (Unix domain sockets)
- **template-manager.ts** - TemplateManager for managing code generation templates
- **playwright-mcp-integration.ts** - Playwright MCP integration for TDD workflows
- **string-matcher.ts** - String matching utilities for fuzzy matching and similarity

## Key Features

- **Centralized Logging**: Unified logging with configurable output (file, console, MCP mode)
- **Dependency Analysis**: Builds dependency graphs for execution ordering
- **Event Streaming**: Emits workflow events for monitoring and integration
- **Cost Calculation**: Calculates AI token usage and costs
- **String Matching**: Fuzzy matching and Levenshtein distance for code patching

## Usage

```typescript
import { logger } from './utils/logger';
import { emitEvent } from './utils/event-stream';
import { findFuzzyMatch, calculateSimilarity } from './utils/string-matcher';

// Logging
logger.info('Workflow started');
logger.debug('Debug information', { data });

// Event streaming
emitEvent({ type: 'task-complete', taskId: '123' });

// String matching
const match = findFuzzyMatch(content, searchString);
const similarity = calculateSimilarity(str1, str2);
```

## State Management

State is managed by LangGraph checkpoints and the handoff mechanism:
- **LangGraph checkpoints**: Stored in `.devloop/checkpoints/`
- **Handoff context**: Generated in `.devloop/handoff.md`
- **Learnings**: Persisted in `.devloop/progress.md`

## Related Files

- All other core modules depend on utilities in this directory

