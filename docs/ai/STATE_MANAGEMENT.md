# State Management in Dev-Loop

## Overview

Dev-loop uses a unified state management system that consolidates execution state and metrics into two main files:

- **`execution-state.json`** - All execution-related state (workflow, PRDs, sessions, etc.)
- **`metrics.json`** - All metrics and insights (hierarchical organization)

## Architecture

### Unified State Manager

The `UnifiedStateManager` class (`src/core/state/StateManager.ts`) provides:

- **Immer Integration**: Immutable state updates using producers
- **Zod Validation**: Schema validation on read/write
- **Atomic Writes**: Temp file + rename pattern for safety
- **File Locking**: Prevents race conditions in concurrent access
- **Type Safety**: Full TypeScript support with inferred types

### Execution State Schema

Location: `src/config/schema/execution-state.ts`

The execution state consolidates:

- **Active Context**: Currently active PRD set, PRD, phase, task
- **PRD Set States**: Execution status for each PRD set
- **PRD States**: Execution status for each PRD
- **Contribution Tracking**: File creation and investigation task tracking
- **Contribution Mode**: Contribution mode activation state
- **Sessions**: Cursor session management

### Metrics Schema

Location: `src/config/schema/metrics.ts` and `src/config/schema/runtime.ts`

The metrics file uses a hierarchical structure:

- **Runs**: Run-level metrics (task executions)
- **PRD Sets**: PRD set-level metrics
- **PRDs**: PRD-level metrics
- **Phases**: Phase-level metrics (nested by PRD)
- **Features**: Feature-level metrics
- **Parallel**: Parallel execution metrics
- **Schema**: Schema operation metrics
- **Insights**: Enhanced performance insights (new)

#### Enhanced Insights

The metrics file includes insights for better execution analysis:

- **Efficiency**: Tokens per success, iterations to success, failure patterns
- **Trends**: Token usage, execution time, success rate trends over time
- **Bottlenecks**: Slowest operations, most retried tasks, context size impact
- **Quality**: Test coverage progress, validation pass rate, first-time success rate
- **Resources**: Context window usage, files per task, token distribution

## File Locations

All state files are located in `.devloop/` directory at project root:

- `.devloop/execution-state.json` - Unified execution state (replaces state.json, prd-set-state.json, cursor-sessions.json, retry-counts.json, contribution-mode.json, evolution-state.json)
- `.devloop/metrics.json` - Unified hierarchical metrics (replaces prd-set-metrics.json, prd-metrics.json, phase-metrics.json, feature-metrics.json, schema-metrics.json, parallel-metrics.json)
- `.devloop/patterns.json` - Learned patterns (managed via UnifiedStateManager)
- `.devloop/observations.json` - System observations (managed via UnifiedStateManager)
- `.devloop/test-results.json/test-results.json` - Test results (unchanged)

## Usage

### Basic Usage

```typescript
import { UnifiedStateManager } from 'dev-loop/src/core/state/StateManager';

const stateManager = new UnifiedStateManager();
await stateManager.initialize();

// Get execution state
const state = await stateManager.getExecutionState();

// Update execution state (with Immer)
await stateManager.updateExecutionState((draft) => {
  draft.active.prdSetId = 'my-prd-set';
  draft.active.workflowState = 'running';
});

// Get metrics
const metrics = await stateManager.getMetrics();

// Update metrics (with Immer)
await stateManager.updateMetrics((draft) => {
  draft.runs.push({
    timestamp: new Date().toISOString(),
    status: 'completed',
    // ... other metrics
  });
});
```

### Convenience Methods

```typescript
// Get active context
const context = await stateManager.getActiveContext();

// Set active context
await stateManager.setActiveContext({
  prdSetId: 'my-prd-set',
  prdId: 'my-prd',
  workflowState: 'running',
});

// Get active PRD set
const prdSet = await stateManager.getActivePRDSet();

// Get active PRD
const prd = await stateManager.getActivePRD();

// Update task status
await stateManager.updateTaskStatus('task-123', 'completed');

// Increment retry count
await stateManager.incrementRetryCount('task-123');

// Record metrics at any level
await stateManager.recordMetrics('prdSet', 'my-prd-set', {
  setId: 'my-prd-set',
  status: 'in-progress',
  startTime: new Date().toISOString(),
  // ... other metrics
});
```

## Migration from Old Files

The following files were consolidated:

**Execution State** (consolidated into `execution-state.json`):
- `state.json` → `execution-state.json.active`
- `prd-set-state.json` → `execution-state.json.prdSets`
- `evolution-state.json` → `execution-state.json.contribution`
- `contribution-mode.json` → `execution-state.json.contributionMode`
- `cursor-sessions.json` → `execution-state.json.sessions`
- `retry-counts.json` → `execution-state.json.prds[prdId].retryCounts`

**Metrics** (consolidated into `metrics.json`):
- `prd-set-metrics.json` → `metrics.json.prdSets`
- `prd-metrics.json` → `metrics.json.prds`
- `phase-metrics.json` → `metrics.json.phases`
- `feature-metrics.json` → `metrics.json.features`
- `parallel-metrics.json` → `metrics.json.parallel`
- `schema-metrics.json` → `metrics.json.schema`

Old files are deleted on first use of the new system.

## Schema Validation

All state files are validated using Zod schemas:

- `executionStateFileSchema` - Validates execution state structure
- `metricsFileSchema` - Validates metrics structure (from runtime.ts)
- Insights schemas - Validate insights data

Invalid data is rejected with clear error messages.

## Thread Safety

The StateManager uses file locking to prevent race conditions:

- In-process locking using Promise-based locks
- File-based locking for cross-process safety
- Automatic stale lock cleanup (locks older than 30 seconds)
- Retry logic for transient read failures

## Performance Considerations

- Atomic writes ensure file integrity
- Immer provides efficient immutable updates
- Schema validation happens on read (not every access)
- Large metrics files are handled efficiently with Immer's structural sharing

## Best Practices

1. **Use Immer Producers**: Always use `updateExecutionState` or `updateMetrics` with producers for updates
2. **Initialize First**: Always call `initialize()` before using the manager
3. **Handle Errors**: Wrap operations in try-catch for validation errors
4. **Use Convenience Methods**: Use provided convenience methods for common operations
5. **Don't Mutate Directly**: Never mutate state objects directly - always use update methods

## Patterns and Observations Integration

Patterns and observations are managed through UnifiedStateManager methods for consistency:

```typescript
// Get patterns
const patterns = await stateManager.getPatterns();

// Add a new pattern
await stateManager.addPattern({
  id: 'pattern-1',
  pattern: 'error pattern text',
  guidance: 'guidance text',
  occurrences: 0,
  lastSeen: new Date().toISOString(),
  files: [],
  projectTypes: [],
});

// Update patterns (with filtering support)
await stateManager.updatePatterns((draft) => {
  const pattern = draft.patterns.find(p => p.id === 'pattern-1');
  if (pattern) {
    pattern.occurrences++;
    pattern.lastSeen = new Date().toISOString();
  }
});

// Get observations
const observations = await stateManager.getObservations();

// Add a new observation
await stateManager.addObservation({
  id: 'obs-1',
  type: 'failure-pattern',
  severity: 'high',
  createdAt: new Date().toISOString(),
  relevanceScore: 0.9,
  expiresAt: null,
  prdId: 'my-prd',
  phaseId: 1,
  taskId: 'task-1',
  category: 'error',
  observation: 'Observation text',
  description: 'Description',
  resolved: false,
});

// Update observations
await stateManager.updateObservations((draft) => {
  const obs = draft.observations.find(o => o.id === 'obs-1');
  if (obs) {
    obs.resolved = true;
    obs.resolvedAt = new Date().toISOString();
  }
});
```

## Examples

### Setting Active Context

```typescript
await stateManager.setActiveContext({
  prdSetId: 'notification-system',
  prdId: 'notification-system-phase1',
  phaseId: 1,
  taskId: 'REQ-1.1',
  workflowState: 'executing-ai',
});
```

### Tracking File Creation

```typescript
await stateManager.updateExecutionState((draft) => {
  const prdId = draft.active.prdId;
  if (prdId && !draft.contribution.fileCreation[prdId]) {
    draft.contribution.fileCreation[prdId] = {
      requested: [],
      created: [],
      missing: [],
      wrongLocation: [],
    };
  }
  if (prdId) {
    draft.contribution.fileCreation[prdId].requested.push('path/to/file.php');
    draft.contribution.fileCreation[prdId].created.push('path/to/file.php');
  }
});
```

### Recording Metrics

```typescript
await stateManager.recordMetrics('run', 'run-123', {
  timestamp: new Date().toISOString(),
  taskId: 'REQ-1.1',
  status: 'completed',
  timing: {
    aiCallMs: 1500,
    testRunMs: 200,
    totalMs: 1700,
  },
  tokens: {
    input: 5000,
    output: 1000,
  },
});
```

### Updating Insights

```typescript
await stateManager.updateMetrics((draft) => {
  if (!draft.insights) draft.insights = {};
  if (!draft.insights.efficiency) draft.insights.efficiency = {};
  
  // Calculate tokens per success
  const successfulRuns = draft.runs.filter(r => r.status === 'completed');
  const totalTokens = successfulRuns.reduce((sum, r) => sum + (r.tokens?.input || 0), 0);
  draft.insights.efficiency.tokensPerSuccess = totalTokens / successfulRuns.length;
  
  // Track trends
  if (!draft.insights.trends) draft.insights.trends = {};
  if (!draft.insights.trends.tokenUsageTrend) draft.insights.trends.tokenUsageTrend = [];
  draft.insights.trends.tokenUsageTrend.push({
    date: new Date().toISOString(),
    tokens: totalTokens,
  });
});
```
