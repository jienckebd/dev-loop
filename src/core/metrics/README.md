# Metrics System

This directory contains the metrics tracking system for dev-loop, organized hierarchically from task-level to PRD set-level metrics.

## Structure

- **types.ts** - Type definitions and interfaces for all metrics types (PrdSetMetricsData, PrdMetricsData, PhaseMetricsData, etc.)
- **debug.ts** - Task-level debug metrics (RunMetrics, DebugMetrics class)
- **prd.ts** - PRD-level metrics (PrdMetrics class)
- **prd-set.ts** - PRD set-level metrics (PrdSetMetrics class)
- **phase.ts** - Phase-level metrics (PhaseMetrics class)
- **observation.ts** - Observation-specific metrics
- **pattern.ts** - Pattern-specific metrics
- **parallel.ts** - Parallel execution metrics
- **analyzer.ts** - Metrics analyzer for insights and trends

## Key Concepts

- **Hierarchical Metrics**: Metrics are tracked at multiple levels (PRD Set → PRD → Phase → Task)
- **Persistent Storage**: Metrics are saved to `.devloop/` directory (e.g., `prd-metrics.json`, `prd-set-metrics.json`)
- **Type Safety**: All metrics types are defined in `types.ts` with full TypeScript support
- **Config Overlay Support**: PRD set and PRD metrics include config overlay information

## Usage

```typescript
import { PrdMetrics } from '../metrics/prd';
import { PrdSetMetrics } from '../metrics/prd-set';
import { PhaseMetrics } from '../metrics/phase';

// Track PRD-level metrics
const prdMetrics = new PrdMetrics();
prdMetrics.recordTask(prdId, taskId, runMetrics);

// Track PRD set-level metrics
const prdSetMetrics = new PrdSetMetrics();
prdSetMetrics.recordPrdExecution(setId, prdId, prdMetricsData);
```

## Related Files

- `src/core/tracking/` - Progress and observation tracking
- `src/core/config/merger.ts` - Handles config overlay merging for metrics

