# Reporting System

This directory contains report generation functionality for PRD and PRD set execution.

## Structure

- **generator.ts** - Unified report generator (general PRD execution reports)
- **prd-report-generator.ts** - PRD set report generator (comprehensive reports for PRD sets)

## Key Features

- **Multiple Formats**: Supports markdown, JSON, and HTML report formats
- **Hierarchical Reports**: Generates reports at PRD set, PRD, and phase levels
- **Comprehensive Metrics**: Includes metrics, timing, token usage, test results
- **PRD Set Reports**: Specialized comprehensive reports for PRD set execution

## Usage

```typescript
import { ReportGenerator } from './reporting/generator';
import { PrdReportGenerator } from './reporting/prd-report-generator';

// Generate PRD report
const generator = new ReportGenerator();
const outputPath = await generator.generatePrdReport(prdId, { format: 'markdown' });

// Generate PRD set report
const prdSetGenerator = new PrdReportGenerator();
const report = await prdSetGenerator.generateReport(prdSetId, { format: 'html' });
```

## Related Files

- `src/core/metrics/` - Metrics data used in reports
- `src/core/tracking/` - Progress and observation data

