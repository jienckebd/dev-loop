# Metrics Guide

## Overview

Dev-loop collects comprehensive metrics at multiple hierarchical levels to track execution performance, costs, and outcomes. This guide explains the metrics system and how to use it.

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

### Features
- Features used
- Feature usage count
- Feature success rate
- Feature duration
- Feature token usage

### Schema Operations
- Schema operations (create, update, delete, validate, parse)
- Operation types
- Schema types
- Success rate
- Duration

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

Metrics are stored in:
- `.devloop/metrics.json` - Task-level metrics
- `.devloop/prd-set-metrics.json` - PRD set metrics
- `.devloop/prd-metrics.json` - PRD metrics
- `.devloop/phase-metrics.json` - Phase metrics
- `.devloop/feature-metrics.json` - Feature usage metrics
- `.devloop/schema-metrics.json` - Schema operation metrics
- `.devloop/observation-metrics.json` - Observation metrics
- `.devloop/pattern-metrics.json` - Pattern metrics
- `.devloop/parallel-metrics.json` - Parallel execution metrics
- `.devloop/test-results/` - Test results tracking
- `.devloop/error-analysis.json` - Error analysis data

Reports are generated in:
- `.devloop/reports/` - Generated reports

## Configuration

Configure metrics paths in `devloop.config.js`:

```javascript
module.exports = {
  metrics: {
    enabled: true,
    path: '.devloop/metrics.json',
    prdSetMetricsPath: '.devloop/prd-set-metrics.json',
    prdMetricsPath: '.devloop/prd-metrics.json',
    phaseMetricsPath: '.devloop/phase-metrics.json',
    featureMetricsPath: '.devloop/feature-metrics.json',
    schemaMetricsPath: '.devloop/schema-metrics.json',
    observationMetricsPath: '.devloop/observation-metrics.json',
    patternMetricsPath: '.devloop/pattern-metrics.json',
    parallelMetricsPath: '.devloop/parallel-metrics.json',
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




