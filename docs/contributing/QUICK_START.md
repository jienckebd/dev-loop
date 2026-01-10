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

Quick-start guide for common contribution mode scenarios.

## Scenario 1: Monitoring a Single PRD (Watch Mode - Unified Daemon)

**Use case**: Working on a single PRD that needs iterative improvement until complete.

**Note**: With unified daemon mode, watch mode handles both task creation (from PRD) and execution. No separate task creation step needed for single PRDs.

### Setup

```bash
# Terminal 1: Start contribution mode
npx dev-loop contribution start --prd .taskmaster/docs/my-prd.md

# Terminal 2: Start watch mode (daemon)
# Watch mode parses PRD, creates tasks in Task Master, and executes them
npx dev-loop watch --until-complete
```

### Monitoring (Choose One)

**Option A: Manual Polling**
```typescript
// Terminal 3: Monitor events manually
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
    // Handle events...
  }
  
  lastEventId = newLastEventId;
  await sleep(5000); // Poll every 5 seconds
}
```

**Option B: Automated Monitoring**
```javascript
// Configure in devloop.config.js
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

// Service starts automatically when contribution mode activates
// Monitor status:
const { status } = await devloop_event_monitor_status();
```

**Option C: Hybrid Approach**
```typescript
// Start automated monitoring
await devloop_event_monitor_start();

// Also poll manually for custom logic
let lastEventId = null;
setInterval(async () => {
  const { events, lastEventId: newLastEventId } = await devloop_events_poll({
    since: lastEventId,
    types: ['test:stalled', 'progress:stalled'],
    limit: 20
  });
  
  // Custom handling for specific events
  events.forEach(event => {
    if (event.type === 'test:stalled') {
      // Custom logic
    }
  });
  
  lastEventId = newLastEventId;
}, 5000);
```

### Expected Behavior

- Watch mode parses PRD and creates tasks in Task Master automatically
- Watch mode runs in continuous loop, executing tasks from Task Master
- Events are emitted during task execution
- Outer agent monitors events and reacts to issues
- Watch mode exits when PRD is 100% complete (all tasks done, tests passing)
- Stop execution: `npx dev-loop stop` (stops watch mode daemon)

## Scenario 2: Monitoring a PRD Set (Unified Daemon Mode)

**Use case**: Creating tasks from multiple related PRDs and executing them via unified daemon.

### Setup

```bash
# Terminal 1: Start contribution mode
npx dev-loop contribution start --prd .taskmaster/planning/my-set/index.md.yml

# Terminal 2: Create tasks from PRD set (exits immediately after task creation)
npx dev-loop prd-set execute .taskmaster/planning/my-set --debug

# Terminal 3: Execute tasks via watch mode daemon (unified daemon)
npx dev-loop watch --until-complete
```

### Monitoring

Same monitoring options as Scenario 1 (manual polling, automated monitoring, or hybrid).

**Note**: Events are emitted by watch mode daemon during task execution. PRD set execute doesn't emit events (exits immediately after task creation).

### Expected Behavior

- PRD set execute creates tasks in Task Master and exits immediately
- Watch mode daemon picks up tasks from Task Master and executes them
- Events are emitted during task execution (watch mode daemon)
- Outer agent monitors events and reacts to issues
- Watch mode exits when PRD is 100% complete (all tasks done, tests passing)
- Stop execution: `npx dev-loop stop` (stops watch mode daemon)

## Scenario 3: Unified Daemon Mode with Automated Monitoring

**Use case**: Unattended execution with automatic issue resolution using unified daemon architecture.

### Configuration

```javascript
// devloop.config.js
module.exports = {
  mcp: {
    eventMonitoring: {
      enabled: true,
      pollingInterval: 5000,
      thresholds: {
        'json:parse_failed': {
          count: 3,
          windowMs: 600000,  // 10 minutes
          autoAction: true,
          confidence: 0.8
        },
        'task:blocked': {
          count: 1,
          autoAction: true,
          confidence: 0.7
        },
        'file:boundary_violation': {
          count: 1,
          autoAction: true,
          confidence: 0.9
        },
        'contribution:issue_detected': {
          count: 1,
          autoAction: true,
          confidence: 0.8
        }
      },
      actions: {
        requireApproval: ['validation:failed'],
        autoExecute: [
          'json:parse_failed',
          'task:blocked',
          'file:boundary_violation',
          'contribution:issue_detected'
        ],
        maxInterventionsPerHour: 10
      },
      metrics: {
        trackInterventions: true,
        trackSuccessRate: true,
        trackRollbacks: true
      }
    }
  }
};
```

### Execution

```bash
# Start contribution mode
npx dev-loop contribution start --prd <path>

# For Single PRD: Watch mode handles everything
npx dev-loop watch --until-complete

# For PRD Set: Create tasks, then execute via watch mode
npx dev-loop prd-set execute <path>  # Creates tasks, exits
npx dev-loop watch --until-complete  # Executes tasks, exits when complete

# To stop execution:
npx dev-loop stop  # Stops watch mode daemon (which executes all tasks)
```

### Monitoring

The monitoring service starts automatically when contribution mode is activated (if enabled in config). Check status periodically:

```typescript
// Check monitoring status
const { status, metrics, effectiveness } = await devloop_event_monitor_status();

console.log(`Monitoring: ${status.isRunning ? 'Active' : 'Inactive'}`);
console.log(`Interventions: ${metrics.totalInterventions} (${(metrics.successRate * 100).toFixed(1)}% success)`);

// Review recent interventions
const { interventions, summary } = await devloop_event_monitor_interventions({
  limit: 10
});

interventions.forEach(intervention => {
  const status = intervention.success ? '✓' : '✗';
  console.log(`${status} ${intervention.issueType} (${intervention.strategy})`);
});
```

## Scenario 4: Debugging Specific Issues

**Use case**: Investigating a specific problem or pattern.

### Setup

```bash
# Start contribution mode
npx dev-loop contribution start --prd <path>

# Start execution
npx dev-loop watch --until-complete
```

### Focused Monitoring

```typescript
// Monitor specific event types
const { events } = await devloop_events_poll({
  types: ['json:parse_failed', 'json:parse_retry'],
  taskId: 'task-123',  // Specific task if needed
  limit: 100
});

// Analyze pattern
events.forEach(event => {
  console.log(`[${event.timestamp}] ${event.type}`);
  console.log(`  Severity: ${event.severity}`);
  console.log(`  Data: ${JSON.stringify(event.data, null, 2)}`);
});

// Check intervention effectiveness for specific issue
const { interventions } = await devloop_event_monitor_interventions({
  issueType: 'json-parsing-failure',
  limit: 20
});
```

## Scenario 5: Multi-Terminal Workflow

**Use case**: Using multiple terminals for separation of concerns.

### Terminal Layout

**Terminal 1: Contribution Mode**
```bash
# Start contribution mode
npx dev-loop contribution start --prd <path>

# Monitor contribution mode status
npx dev-loop contribution status
```

**Terminal 2: Execution**
```bash
# Start execution
npx dev-loop watch --until-complete
# OR
npx dev-loop prd-set execute <path> --debug > /tmp/execution.log 2>&1
```

**Terminal 3: Event Monitoring**
```bash
# Monitor events via script or MCP tools
# Using script:
node scripts/monitor-events.js

# Or use MCP tools directly in Cursor
# devloop_events_poll, devloop_event_monitor_status, etc.
```

**Terminal 4: Dev-Loop Development (Optional)**
```bash
# Edit dev-loop code when issues detected
cd node_modules/dev-loop
npm run build

# Commit and push changes
git add .
git commit -m "fix: enhance JSON parser for edge cases"
git push
```

## Common Workflow Patterns

### Pattern A: Development Session

```bash
# 1. Start contribution mode
npx dev-loop contribution start --prd .taskmaster/docs/my-prd.md

# 2. Start watch mode in background
npx dev-loop watch --until-complete > /tmp/watch.log 2>&1 &

# 3. Monitor events actively
# Use Cursor MCP tools or script to poll events every 3-5 seconds

# 4. When issue detected:
#    - Review event details
#    - Fix dev-loop code
#    - Rebuild: cd node_modules/dev-loop && npm run build
#    - Continue monitoring
```

### Pattern B: Unattended Execution

```bash
# 1. Configure automated monitoring in devloop.config.js
# 2. Start contribution mode
npx dev-loop contribution start --prd <path>

# 3. Start execution
npx dev-loop watch --until-complete

# 4. Check periodically:
#    - Review intervention metrics
#    - Check execution status
#    - Verify progress
```

### Pattern C: Debug Session

```bash
# 1. Start contribution mode with debug
npx dev-loop contribution start --prd <path>

# 2. Start execution with debug logging
npx dev-loop watch --until-complete --debug > /tmp/debug.log 2>&1

# 3. Monitor specific event types
# 4. Analyze patterns in logs and events
# 5. Fix issues and restart
```

## Tips for Efficient Monitoring

1. **Filter Events**: Only poll for events you care about to reduce noise
2. **Poll Interval**: Use 5-10 seconds for active monitoring, 30+ seconds for background
3. **Event Persistence**: Remember events are in-memory only - poll during execution
4. **Hybrid Approach**: Use automated monitoring for common issues, manual polling for specific cases
5. **Intervention Tracking**: Monitor intervention effectiveness to tune thresholds
6. **Multiple Terminals**: Separate concerns across terminals for clarity
7. **Log Monitoring**: Combine event polling with log monitoring for complete picture

## Next Steps

After running through these quick-start scenarios:

1. Review [Contribution Mode Guide](CONTRIBUTION_MODE.md) for complete workflow
2. Read [Execution Modes Guide](EXECUTION_MODES.md) to understand watch vs prd-set execute
3. Study [Outer Agent Monitoring Guide](OUTER_AGENT_MONITORING.md) for monitoring best practices
4. Check [Event Streaming Guide](EVENT_STREAMING.md) for event architecture details
5. Explore [Proactive Monitoring Guide](PROACTIVE_MONITORING.md) for automated intervention system

## Related Documentation

- [Contribution Mode Guide](CONTRIBUTION_MODE.md) - Complete contribution mode workflow
- [Execution Modes Guide](EXECUTION_MODES.md) - Watch mode vs PRD set execute
- [Outer Agent Monitoring Guide](OUTER_AGENT_MONITORING.md) - Monitoring best practices
- [Event Streaming Guide](EVENT_STREAMING.md) - Event streaming architecture
- [Proactive Monitoring Guide](PROACTIVE_MONITORING.md) - Automated intervention system
- [Getting Started Guide](GETTING_STARTED.md) - Development environment setup
