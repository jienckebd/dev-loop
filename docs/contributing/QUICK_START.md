---
title: "Quick Start: Contribution Mode"
type: "guide"
category: "contributing"
audience: "both"
keywords: ["quick-start", "getting-started", "examples", "scenarios", "contribution"]
related_docs:
  - "CONTRIBUTION_MODE.md"
  - "EXECUTION_MODES.md"
  - "OUTER_AGENT_MONITORING.md"
  - "GETTING_STARTED.md"
prerequisites: []
estimated_read_time: 10
contribution_mode: true
---

# Quick Start: Contribution Mode

Quick-start guide for common contribution mode scenarios using the IterationRunner architecture.

## Scenario 1: PRD Set Execution

**Use case**: Working on PRDs with continuous iteration until complete.

### Setup

```bash
# Terminal 1: Start contribution mode
npx dev-loop contribution start --prd .taskmaster/docs/my-prd.md

# Terminal 2: Execute PRD set (IterationRunner with fresh context per iteration)
npx dev-loop prd-set execute .taskmaster/planning/my-set/
```

### What Happens

1. IterationRunner generates `handoff.md` with current context
2. LangGraph executes single workflow iteration
3. Learnings persist to `progress.md`
4. Check if complete - if not, repeat with fresh context
5. Exit when all tasks done and tests pass

### Monitoring

**Option A: Manual Polling**
```typescript
let lastEventId = null;

while (true) {
  const { events, lastEventId: newLastEventId } = await devloop_events_poll({
    since: lastEventId,
    types: ['contribution:issue_detected', 'task:blocked'],
    severity: ['warn', 'error', 'critical'],
    limit: 50
  });
  
  for (const event of events) {
    console.log(`[${event.severity}] ${event.type}`);
  }
  
  lastEventId = newLastEventId;
  await sleep(5000);
}
```

**Option B: Automated Monitoring**
```javascript
// devloop.config.js
mcp: {
  eventMonitoring: {
    enabled: true,
    pollingInterval: 5000,
    thresholds: {
      'task:blocked': { count: 1, autoAction: true, confidence: 0.7 },
      'contribution:issue_detected': { count: 1, autoAction: true, confidence: 0.8 }
    }
  }
}
```

### Expected Behavior

- Each iteration gets fresh AI context (Ralph pattern)
- Learnings accumulate in `progress.md` across iterations
- Exits when PRD is 100% complete
- Stop execution: `npx dev-loop stop` or `Ctrl+C`

## Scenario 2: PRD Set Execution (Parallel IterationRunners)

**Use case**: Executing multiple related PRDs with parallel processing.

### Setup

```bash
# Terminal 1: Start contribution mode
npx dev-loop contribution start --prd .taskmaster/planning/my-set/index.md.yml

# Terminal 2: Execute PRD set (parallel IterationRunners per PRD)
npx dev-loop prd-set execute .taskmaster/planning/my-set --debug
```

### What Happens

1. PrdSetOrchestrator discovers PRDs in set
2. DependencyGraphBuilder determines execution levels
3. For each level, parallel IterationRunners execute concurrently
4. Each PRD gets fresh context isolation
5. Results aggregated when all complete

### Expected Output

```
Executing PRD set: my-set
  PRDs in set: 5
  Mode: Parallel execution (fresh IterationRunner per PRD)

Level 0: Executing 2 PRDs in parallel
  ✓ PRD-A completed (15 iterations, 8 tasks)
  ✓ PRD-B completed (12 iterations, 6 tasks)

Level 1: Executing 3 PRDs in parallel
  ✓ PRD-C completed (10 iterations, 5 tasks)
  ...

Execution Complete:
  All PRDs executed using parallel IterationRunner instances.
```

## Scenario 3: Unattended Execution with Automated Monitoring

**Use case**: Long-running execution with automatic issue resolution.

### Configuration

```javascript
// devloop.config.js
module.exports = {
  iteration: {
    maxIterations: 100,
    contextThreshold: 90,
    autoHandoff: true,
    persistLearnings: true,
  },
  mcp: {
    eventMonitoring: {
      enabled: true,
      pollingInterval: 5000,
      thresholds: {
        'json:parse_failed': {
          count: 3,
          windowMs: 600000,
          autoAction: true,
          confidence: 0.8
        },
        'task:blocked': {
          count: 1,
          autoAction: true,
          confidence: 0.7
        },
        'contribution:issue_detected': {
          count: 1,
          autoAction: true,
          confidence: 0.8
        }
      },
      actions: {
        autoExecute: ['json:parse_failed', 'task:blocked', 'contribution:issue_detected'],
        maxInterventionsPerHour: 10
      }
    }
  }
};
```

### Execution

```bash
# Start contribution mode
npx dev-loop contribution start --prd <path>

# Execute PRD set
npx dev-loop prd-set execute <path>

# To stop
npx dev-loop stop
```

### Monitoring Status

```typescript
// Check monitoring status
const { status, metrics, effectiveness } = await devloop_event_monitor_status();

console.log(`Monitoring: ${status.isRunning ? 'Active' : 'Inactive'}`);
console.log(`Interventions: ${metrics.totalInterventions} (${(metrics.successRate * 100).toFixed(1)}% success)`);
```

## Scenario 4: Debugging Specific Issues

**Use case**: Investigating a specific problem or pattern.

### Setup

```bash
# Start with debug logging
npx dev-loop prd-set execute <path> --debug
```

### Focused Monitoring

```typescript
// Monitor specific event types
const { events } = await devloop_events_poll({
  types: ['json:parse_failed', 'task:blocked'],
  taskId: 'REQ-1.1',
  limit: 100
});

events.forEach(event => {
  console.log(`[${event.timestamp}] ${event.type}`);
  console.log(`  Severity: ${event.severity}`);
  console.log(`  Data: ${JSON.stringify(event.data, null, 2)}`);
});
```

### Check State Files

```bash
# View current handoff context
cat .devloop/handoff.md

# View accumulated learnings
cat .devloop/progress.md

# View discovered patterns
cat .devloop/learned-patterns.md

# Check retry counts
cat .devloop/retry-counts.json
```

## Scenario 5: Multi-Terminal Workflow

**Use case**: Using multiple terminals for separation of concerns.

### Terminal Layout

**Terminal 1: Contribution Mode**
```bash
npx dev-loop contribution start --prd <path>
npx dev-loop contribution status
```

**Terminal 2: Execution**
```bash
# Execute PRD set
npx dev-loop prd-set execute <path> --debug
```

**Terminal 3: Monitoring**
```bash
# Follow logs
tail -f .devloop/progress.md

# Or use MCP tools in Cursor
# devloop_events_poll, devloop_event_monitor_status
```

**Terminal 4: Dev-Loop Development (Optional)**
```bash
cd node_modules/dev-loop
npm run build

git add .
git commit -m "fix: enhance error handling"
```

## Common Workflow Patterns

### Pattern A: Development Session

```bash
# 1. Start contribution mode
npx dev-loop contribution start --prd <path>

# 2. Start execution in background
npx dev-loop prd-set execute <path> > /tmp/execution.log 2>&1 &

# 3. Monitor progress
tail -f .devloop/progress.md

# 4. When issue detected:
#    - Review .devloop/handoff.md for context
#    - Fix dev-loop code
#    - Rebuild: cd node_modules/dev-loop && npm run build
```

### Pattern B: Unattended Execution

```bash
# 1. Configure automated monitoring in devloop.config.js
# 2. Start execution
npx dev-loop contribution start --prd <path>
npx dev-loop prd-set execute <path>

# 3. Check periodically:
cat .devloop/progress.md | tail -50
```

### Pattern C: Debug Session

```bash
# 1. Start with debug
npx dev-loop prd-set execute <path> --debug 2>&1 | tee /tmp/debug.log

# 2. Review checkpoints
ls -la .devloop/checkpoints/

# 3. Analyze learnings
cat .devloop/learned-patterns.md
```

## Tips for Efficient Execution

1. **Use fresh context**: IterationRunner resets AI context each iteration
2. **Review learnings**: Check `progress.md` for accumulated insights
3. **Monitor patterns**: Check `learned-patterns.md` for reusable solutions
4. **State recovery**: Checkpoints enable crash recovery
5. **Parallel PRDs**: Use PRD sets for concurrent execution
6. **Event polling**: Poll every 5-10s for active monitoring

## Next Steps

After running through these quick-start scenarios:

1. Review [Contribution Mode Guide](CONTRIBUTION_MODE.md) for complete workflow
2. Study [Execution Modes Guide](EXECUTION_MODES.md) for detailed mode comparison
3. Read [Outer Agent Monitoring Guide](OUTER_AGENT_MONITORING.md) for monitoring best practices
4. Check [Event Streaming Guide](EVENT_STREAMING.md) for event architecture
5. Explore [Architecture Guide](ARCHITECTURE.md) for codebase structure

## Related Documentation

- [Contribution Mode Guide](CONTRIBUTION_MODE.md) - Two-agent architecture
- [Execution Modes Guide](EXECUTION_MODES.md) - PRD set execution
- [Outer Agent Monitoring Guide](OUTER_AGENT_MONITORING.md) - Monitoring practices
- [Event Streaming Guide](EVENT_STREAMING.md) - Event streaming architecture
- [Getting Started Guide](GETTING_STARTED.md) - Development environment setup
