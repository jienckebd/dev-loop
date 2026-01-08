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
dev-loop report --all
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

### Feature Usage
- Features used during execution
- Feature performance metrics
- Success rates per feature
- Token usage per feature

### Schema Operations
- Schema operations performed
- Success rates
- Operation types and durations
- Error analysis

### Detailed Metrics
- Timing breakdown
- Token usage
- Cost calculation
- Efficiency metrics

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
dev-loop report --all --format json
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




