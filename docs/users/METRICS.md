# Metrics Guide

## Overview

Dev-loop collects comprehensive metrics at multiple hierarchical levels to track execution performance, costs, and outcomes. This guide explains the metrics system and how to use it.

## Unified Metrics System

The metrics system has been unified through `MetricsAggregator` which combines insights from:

1. **BuildMetrics** - PRD set building metrics (timing, AI calls, tokens, quality)
2. **PatternMetrics** - Pattern learning system effectiveness
3. **ExecutionIntelligenceCollector** - Task execution patterns, PRD generation insights, provider performance

### MetricsAggregator

The `MetricsAggregator` provides:
- Unified access to all metrics systems
- Cross-system correlation analysis
- Provider/model performance recommendations
- Config effectiveness insights

### Correlation Analysis

The `CorrelationAnalyzer` identifies relationships across metrics:
- **Pattern Effectiveness**: Which patterns correlate with successful builds
- **Provider Performance**: Which AI providers/models work best for different task types
- **Config Effectiveness**: Which config settings lead to better outcomes

Use correlation analysis to:
- Optimize provider/model selection
- Identify most effective patterns
- Tune configuration for better results

## Hierarchical Metrics

Metrics are collected at four levels:

1. **PRD Set Level**: Aggregates metrics across all PRDs in a set
2. **PRD Level**: Aggregates metrics across all phases in a PRD
3. **Phase Level**: Aggregates metrics across all tasks in a phase
4. **Task Level**: Individual task execution metrics

## Metric Categories

### Timing Metrics
- Total execution time
- Average time per PRD/Phase/Task
- AI call time
- Test run time
- Log analysis time

### Token Usage
- Input tokens
- Output tokens
- Total cost (calculated based on provider pricing)

### Test Results
- Total tests
- Passing tests
- Failing tests
- Pass rate
- Test categories

### Code Changes
- Files created
- Files modified
- Patches applied
- Patches failed

### Errors
- Error count
- Errors by category (validation, test, log, timeout, patch, ai, feature, schema)
- Errors by type
- Error patterns

### Efficiency
- Tokens per task
- Iterations per task
- Average retries

### Intervention
- Total interventions
- Success rate
- Successful, failed, and rolled back interventions
- Effectiveness by issue type and event type
- Timing metrics (detection, fix, validation time)
- Pattern analysis (most/least effective strategies, common failure modes)
- Threshold tracking (exceeded count, prevented count, false positives)

### Features

All 17 documented PRD features are now tracked with comprehensive metrics:
- Features used (all 17 features tracked)
- Feature usage count
- Feature success rate
- Feature duration
- Feature token usage

Tracked features include: code generation, test generation, log analysis, codebase discovery, error guidance, pattern learning, validation, schema operations, configuration overlays, context management, framework plugins, session management, IPC communication, error analysis, and more.

Feature metrics help identify which dev-loop capabilities are being utilized and their effectiveness.

### Schema Operations

Comprehensive tracking of all schema operations:
- **Operation types**: create, update, delete, validate, parse
- **Schema types**: entity types, field storage, form displays, view displays, config overlays, etc.
- **Success rate**: Percentage of successful operations
- **Duration**: Average and total time for each operation type
- **Error tracking**: Errors by operation type and schema type

Schema operations are tracked when PRD config overlays are validated, when entity/field schemas are created or modified, and during schema validation processes. These metrics help monitor the performance and reliability of schema-related operations.

### Observations
- Observation count
- Observations by type
- Observations by severity
- Observation resolution rate

### Parallel Execution Metrics

Parallel metrics track concurrent agent execution:
- Max concurrent agents
- Average concurrency
- Parallel efficiency (vs sequential)
- Agent overlap time
- Coordination statistics
- Agent breakdown by task/PRD/phase

View parallel metrics:
```bash
dev-loop metrics --parallel
```

### Session Management Metrics

Session metrics track provider-agnostic session usage:
- Session history length
- History pruning statistics
- Session boundary enforcement
- Context snapshotting effectiveness
- Session lifecycle statistics

**Session Creation Logging:**

Session management uses appropriate log levels to reduce noise:
- **New session creation**: Logged at debug level (expected behavior)
- **Session resume**: Logged at debug level when successful
- **Session errors**: Logged at warning/error level only for actual issues

To see session creation logs, enable debug logging in your configuration. This helps distinguish between expected session lifecycle events and actual problems.

### Intervention Metrics

Intervention metrics track all automated interventions performed by the proactive event monitoring system and their outcomes. These metrics enable analysis and continuous improvement of intervention strategies.

**Location:** `.devloop/metrics.json` (unified metrics file)

**Metrics Structure:**

```typescript
interface InterventionMetrics {
  totalInterventions: number;
  successfulInterventions: number;
  failedInterventions: number;
  rolledBackInterventions: number;
  successRate: number;
  byIssueType: Record<string, {
    count: number;
    successful: number;
    failed: number;
    rolledBack: number;
    avgFixTimeMs: number;
    effectiveness: number;  // success / (success + failed + rolledBack)
  }>;
  byEventType: Record<string, {
    interventions: number;
    preventedIssues: number;
    avgPreventionTimeMs: number;
  }>;
  patterns: {
    mostEffectiveStrategies: Array<{ strategy: string; successRate: number }>;
    leastEffectiveStrategies: Array<{ strategy: string; successRate: number }>;
    commonFailureModes: Array<{ issueType: string; failureReason: string; count: number }>;
  };
  timing: {
    avgDetectionTimeMs: number;    // Time from event to intervention
    avgFixTimeMs: number;          // Time from intervention to fix applied
    avgValidationTimeMs: number;   // Time to validate fix effectiveness
    totalTimeMs: number;
  };
  thresholds: {
    exceededCount: number;         // Number of times thresholds were exceeded
    preventedCount: number;        // Number of issues prevented by interventions
    falsePositives: number;        // Interventions that weren't needed
  };
}
```

**Key Metrics:**

- **Total Interventions**: Total number of automated interventions attempted
- **Success Rate**: Percentage of successful interventions (successful / total)
- **Rollback Rate**: Percentage of interventions that were rolled back (rolledBack / total)
- **False Positive Rate**: Percentage of interventions that weren't needed (falsePositives / total)
- **Average Intervention Time**: Average time from event detection to fix application
- **Effectiveness by Issue Type**: Success rate for each issue type (json-parsing, task-blocked, boundary-violation, etc.)
- **Effectiveness by Event Type**: Success rate and prevented issues per event type
- **Pattern Analysis**: Most/least effective strategies, common failure modes

**Viewing Intervention Metrics:**

```bash
# View intervention metrics
dev-loop metrics --interventions

# View intervention metrics as JSON
dev-loop metrics --interventions --json
```

**Accessing via MCP Tool:**

```typescript
// Get intervention metrics
const { metrics, effectiveness } = await devloop_event_monitor_status();

console.log(`Total Interventions: ${metrics.totalInterventions}`);
console.log(`Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
console.log(`Successful: ${metrics.successfulInterventions}`);
console.log(`Failed: ${metrics.failedInterventions}`);
console.log(`Rolled Back: ${metrics.rolledBackInterventions}`);

// Get effectiveness analysis
const { overallSuccessRate, mostEffectiveStrategies, issueTypesNeedingImprovement } = effectiveness;

console.log(`Overall Success Rate: ${(overallSuccessRate * 100).toFixed(1)}%`);

console.log('\nMost Effective Strategies:');
mostEffectiveStrategies.forEach(s => {
  console.log(`  ${s.strategy}: ${(s.successRate * 100).toFixed(1)}%`);
});

console.log('\nIssue Types Needing Improvement:');
issueTypesNeedingImprovement.forEach(issue => {
  console.log(`  ${issue.issueType}: ${(issue.effectiveness * 100).toFixed(1)}% effective`);
});

// Get intervention records
const { interventions, summary } = await devloop_event_monitor_interventions({
  limit: 20
});

console.log(`\nRecent Interventions (${interventions.length}):`);
interventions.forEach(intervention => {
  const status = intervention.success ? '✓' : '✗';
  const fix = intervention.fixApplied ? 'fix applied' : 'no fix';
  console.log(`${status} ${intervention.issueType} (${intervention.strategy}) - ${fix}`);
  if (intervention.error) {
    console.log(`  Error: ${intervention.error}`);
  }
});
```

**Metrics Validation Targets:**

Target metrics for effective proactive monitoring:

- **Success Rate**: > 70% (successful interventions / total interventions)
- **Rollback Rate**: < 10% (rollbacks / total interventions)
- **False Positive Rate**: < 5% (false positives / total interventions)
- **Average Detection Time**: < 30 seconds (time from event to intervention trigger)
- **Average Fix Time**: < 2 minutes (time from intervention trigger to fix applied)
- **Average Validation Time**: < 1 minute (time to validate fix effectiveness)
- **Threshold Detection Accuracy**: > 90% (correctly identifying issues requiring intervention)
- **Issue Prevention Rate**: > 60% (issues prevented / threshold exceeded)

**Pattern Analysis:**

The system automatically analyzes intervention patterns every 10 interventions:

- **Most Effective Strategies**: Top 5 strategies by success rate
- **Least Effective Strategies**: Bottom 5 strategies by success rate
- **Common Failure Modes**: Top 10 failure mode patterns (issue type + error reason)

This analysis helps identify:
- Strategies that work well and should be used more
- Strategies that need improvement
- Common failure patterns that need better handling

**Use Cases:**

- Monitor intervention effectiveness over time
- Identify strategies that need improvement
- Track false positive rate to adjust thresholds
- Measure intervention impact on issue prevention
- Analyze timing metrics to optimize intervention speed
- Identify patterns in intervention failures

### IPC Metrics

IPC (Inter-Process Communication) metrics track connection health and performance for background agent communication:
- Connection attempts, successes, and failures
- Health checks performed and failures
- Retry statistics (count, average time, total time)
- Average connection time
- Connection pool statistics

These metrics help monitor the reliability of the IPC system used for Cursor IDE integration and background agent communication.

### Context Metrics

Context building metrics track how efficiently codebase context is assembled for AI agents:
- Total context builds and average build time
- Average context size (characters)
- Files included and truncated statistics
- Context window utilization (percentage of AI context window used)
- Search operations efficiency:
  - Total search operations
  - Average search time
  - Files found vs files used
  - Search efficiency ratio (files used / files found)

These metrics help optimize context building to maximize relevant information while minimizing token usage.

### Codebase Metrics

Codebase operation metrics track file discovery, search, and indexing performance:
- Search operations:
  - Total searches, average time, success rate
  - Patterns used (regex, glob, etc.)
  - Files found per search
- File discovery:
  - Total discoveries, average time
  - Files discovered
  - Patterns matched and discovery strategies used
- File operations:
  - Reads, writes, deletes with timing
  - Error rates
- Indexing:
  - Operations count and timing
  - Cache hit rates
  - Files indexed
- Path resolution:
  - Operations, resolved vs failed
  - Symlinks encountered

### Contribution Mode Issue Detection

Contribution mode metrics include automatic issue detection to alert the outer agent when systemic problems occur:

**Module Confusion Detection**
- Tracks file filtering rate per target module
- Alerts when agents target wrong modules (filtered file rate > 10%)
- Records incidents with task ID, target module, wrong module, and timestamp

**Session Pollution Detection**
- Detects when sessions are shared across PRD sets with different target modules
- Tracks sessions with multiple modules
- Records incidents with session ID, modules, and task IDs

**Boundary Violation Monitoring**
- Tracks boundary violation rate (% of file operations)
- Alerts when violation rate exceeds threshold (>5%)
- Records violation patterns for analysis

**Target Module Context Loss Detection**
- Monitors tasks executed without target module context
- Alerts when context loss rate exceeds threshold (>1%)
- Tracks total tasks vs tasks without target module

These metrics enable the outer agent in contribution mode to automatically detect and fix issues like those observed in the restructure-schema-validation session.

### Patterns
- Pattern matches
- Pattern effectiveness
- Pattern usage count
- Pattern success rate

## CLI Commands

### View Metrics

```bash
# Show task-level metrics (default)
dev-loop metrics

# Show PRD set metrics
dev-loop metrics --prd-set <setId>

# Show PRD metrics
dev-loop metrics --prd <prdId>

# Show phase metrics
dev-loop metrics --phase <prdId>:<phaseId>

# Compare two PRDs or PRD sets
dev-loop metrics --compare <id1>:<id2>

# Show trends over time
dev-loop metrics --trends

# Show feature usage metrics
dev-loop metrics --features

# Show schema operation metrics
dev-loop metrics --schema

# Show parallel execution metrics
dev-loop metrics --parallel

# Show observation metrics
dev-loop metrics --observations

# Show intervention metrics
dev-loop metrics --interventions

# Output as JSON
dev-loop metrics --json
```

### Generate Reports

```bash
# Generate PRD report
dev-loop report --prd <prdId>

# Generate PRD set report
dev-loop report --prd-set <setId>

# Generate phase report
dev-loop report --phase <prdId>:<phaseId>

# Generate report for latest PRD
dev-loop report --latest

# Generate reports for all PRDs
dev-loop report --all

# Specify format (json, markdown, html)
dev-loop report --prd <prdId> --format html

# Compare with another PRD
dev-loop report --prd <prdId> --compare <otherPrdId>
```

## Cost Tracking

Dev-loop automatically calculates costs based on:
- Provider (Anthropic, OpenAI, Gemini, etc.)
- Model used
- Token usage (input and output)

Costs are tracked at all hierarchical levels and included in reports.

Supported providers:
- **Anthropic**: Claude models (Sonnet, Opus, Haiku)
- **OpenAI**: GPT models (GPT-4o, GPT-4 Turbo, GPT-3.5 Turbo)
- **Gemini**: Gemini Pro, Gemini Ultra
- **Ollama**: Local models (no cost)
- **Cursor**: Auto provider (no cost)

## File Locations

Metrics are stored in a unified hierarchical structure:

- `.devloop/metrics.json` - **Unified hierarchical metrics file** containing:
  - `runs` - Task-level metrics (run executions)
  - `prdSets` - PRD set-level metrics
  - `prds` - PRD-level metrics
  - `phases` - Phase-level metrics (nested by PRD)
  - `features` - Feature usage metrics
  - `parallel` - Parallel execution metrics
  - `schema` - Schema operation metrics
  - `insights` - Enhanced performance insights (efficiency, trends, bottlenecks, quality, resources)
  - `summary` - Aggregated summary metrics

Additional files:
- `.devloop/test-results.json/test-results.json` - Test execution results
- `.devloop/test-results/` - Test results tracking
- `.devloop/reports/` - Generated reports

See [`docs/ai/STATE_MANAGEMENT.md`](../ai/STATE_MANAGEMENT.md) for complete documentation on the unified state management system.

Reports are generated in:
- `.devloop/reports/` - Generated reports

## Configuration

Configure metrics in `devloop.config.js`:

```javascript
module.exports = {
  metrics: {
    enabled: true,
    path: '.devloop/metrics.json', // Unified hierarchical metrics file
    testResultsPath: '.devloop/test-results',
    reportsPath: '.devloop/reports',
    costTracking: {
      enabled: true,
      provider: 'anthropic', // Auto-detect from config
    },
  },
};
```

## Best Practices

1. **Regular Monitoring**: Check metrics after each PRD execution to identify trends
2. **Cost Management**: Monitor token usage and costs to optimize AI provider selection
3. **Error Analysis**: Review error patterns to identify common issues
4. **Feature Optimization**: Track feature usage to identify unused or problematic features
5. **Test Quality**: Monitor test pass rates and flaky tests to improve test reliability

## Examples

### View PRD Execution Summary

```bash
dev-loop metrics --prd browser_validation_test --summary
```

### Generate HTML Report

```bash
dev-loop report --prd browser_validation_test --format html
```

### Compare Two PRD Executions

```bash
dev-loop metrics --compare browser_validation_test:previous_prd
```

### Track Feature Usage

```bash
dev-loop metrics --features
```




