# Report Generation Guide

## Overview

Dev-loop generates comprehensive execution reports after PRD Set, PRD, or Phase completion. Reports include executive summaries, detailed metrics, test results, error analysis, and recommendations.

## Report Formats

Reports can be generated in three formats:

- **Markdown** (default): Human-readable format, great for documentation
- **JSON**: Machine-readable format for programmatic analysis
- **HTML**: Formatted for web viewing

## Usage

### Generate PRD Report

```bash
# Generate markdown report (default)
dev-loop report --prd browser_validation_test

# Generate HTML report
dev-loop report --prd browser_validation_test --format html

# Generate JSON report
dev-loop report --prd browser_validation_test --format json

# Specify output path
dev-loop report --prd browser_validation_test --output ./reports/prd-report.md
```

### Generate PRD Set Report

```bash
dev-loop report --prd-set <setId>
```

### Generate Phase Report

```bash
dev-loop report --phase <prdId>:<phaseId>
```

### Generate Latest PRD Report

```bash
dev-loop report --latest
```

### Generate All PRD Reports

```bash
dev-loop report --prd-set <setId>
```

### Compare Reports

```bash
# Compare with another PRD
dev-loop report --prd browser_validation_test --compare previous_prd
```

## Report Structure

### Executive Summary
- Status (completed/failed/blocked)
- Duration
- PRDs/Phases/Tasks completed
- Test pass rate
- Total cost

### Hierarchical Breakdown
- PRD Set → PRD → Phase → Task breakdown
- Metrics at each level
- Success rates

### PRD Set Task Counting

For PRD sets (split PRDs), task counts are correctly aggregated from all phase files:

- **Split PRD structure**: Tasks are nested under `requirements.phases[].tasks` in each phase file
- **Task aggregation**: Build reports sum tasks across all phase files
- **Backward compatibility**: Non-split PRDs with `requirements.tasks` are still supported

**Example PRD set structure:**
```yaml
# index.md.yml (parent)
prd:
  status: split
requirements:
  phases:
    - id: 1
      file: phase1_phase_1.md.yml
    - id: 2
      file: phase2_phase_2.md.yml

# phase1_phase_1.md.yml (child)
requirements:
  phases:
    - id: 1
      tasks:
        - id: REQ-1.1
        - id: REQ-1.2
```

Build reports will correctly show the total task count across all phases.

### Feature Usage

Comprehensive feature usage statistics:
- **Features used**: List of all 17 PRD features used during execution
- **Feature performance metrics**:
  - Usage count per feature
  - Success rates per feature
  - Average duration per feature
  - Token usage per feature (input and output)
- **Feature effectiveness**: Success rate analysis to identify most/least effective features
- **Feature token breakdown**: Token usage broken down by feature type (code generation, AI fallback, retry, error analysis)

### Schema Operations

Detailed schema operation analysis:
- **Operation types breakdown**: create, update, delete, validate, parse operations
- **Success rates by operation**: Percentage of successful operations for each type
- **Duration analysis**: Average and total time for each operation type
- **Schema types**: Operations grouped by schema type (entity types, field storage, config overlays, etc.)
- **Error analysis**: Errors by operation type and schema type

### Detailed Metrics
- Timing breakdown
- Token usage
- Cost calculation
- Efficiency metrics

### IPC Health Report

IPC connection health and performance:
- **Connection statistics**: Attempts, successes, failures
- **Retry analysis**: Retry count, average retry time, total retry time
- **Health check results**: Health checks performed, failures, success rate
- **Connection timing**: Average connection time, total connection time
- **Connection pool statistics**: Active connections, pending results

### Context Efficiency Report

Context building efficiency metrics:
- **Search operation efficiency**: Files found vs files used, search time
- **Context window utilization**: Percentage of AI context window used
- **File discovery patterns**: Discovery strategies used, patterns matched
- **Context build statistics**: Average build time, context size, files included/truncated

### Contribution Mode Issues Report

Automatic issue detection for contribution mode:
- **Module confusion incidents**: Files filtered due to wrong module targeting, filtered file rate
- **Session pollution events**: Sessions used across multiple modules, session IDs affected
- **Boundary violation rates**: Violation rate as % of file operations, violation patterns
- **Target module context loss**: Tasks executed without target module context, context loss rate

These metrics help the outer agent automatically detect and resolve systemic issues in contribution mode.

### Test Results
- Total tests
- Passing/failing breakdown
- Test categories
- Flaky test identification

### Error Analysis
- Error patterns
- Error frequencies
- Common errors
- Suggested fixes

### Parallel Execution Analysis

Reports include parallel execution analysis:
- Max concurrency achieved
- Average concurrency
- Parallel efficiency percentage
- Agent breakdown by task/PRD/phase
- Overlap time statistics
- Coordination metrics (wait time, sequential time, overlap time)

### Session Management Metrics

Reports track session management:
- Session history length
- History pruning statistics
- Session boundary enforcement
- Context snapshotting effectiveness
- Session lifecycle statistics
- Provider-agnostic session usage

### Recommendations
- Optimization suggestions
- Areas for improvement
- Best practices

## Report Location

Reports are saved to:
- Default: `.devloop/reports/`
- Custom: Specify with `--output` option

File naming:
- PRD Set: `prd-set-{setId}.{format}`
- PRD: `prd-{prdId}.{format}`
- Phase: `phase-{prdId}-{phaseId}.{format}`

## Configuration

Configure report settings in `devloop.config.js`:

```javascript
module.exports = {
  metrics: {
    reportsPath: '.devloop/reports',
  },
};
```

## Examples

### Generate HTML Report for Latest PRD

```bash
dev-loop report --latest --format html
```

### Generate All Reports in JSON Format

```bash
dev-loop report --prd-set <setId> --format json
```

### Compare Two PRD Executions

```bash
dev-loop report --prd browser_validation_test --compare previous_test --format markdown
```

## Best Practices

1. **Generate Reports After Completion**: Create reports immediately after PRD execution
2. **Use HTML for Presentations**: HTML format is great for sharing with stakeholders
3. **Use JSON for Analysis**: JSON format enables programmatic analysis and visualization
4. **Regular Reporting**: Generate reports regularly to track progress over time
5. **Compare Executions**: Use comparison feature to identify improvements or regressions

## Integration

Reports can be integrated into:
- CI/CD pipelines
- Documentation systems
- Monitoring dashboards
- Analytics platforms

Use JSON format for programmatic integration, or parse Markdown/HTML for human-readable reports.




