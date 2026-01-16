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
- **build.ts** - Build metrics (PRD set building)
- **aggregator.ts** - Unified metrics aggregator (combines all systems)
- **correlation-analyzer.ts** - Cross-system correlation analysis

## Key Concepts

- **Hierarchical Metrics**: Metrics are tracked at multiple levels (PRD Set → PRD → Phase → Task)
- **Persistent Storage**: Metrics are saved to `.devloop/` directory (e.g., `prd-metrics.json`, `prd-set-metrics.json`)
- **Type Safety**: All metrics types are defined in `types.ts` with full TypeScript support
- **Config Overlay Support**: PRD set and PRD metrics include config overlay information

## Unified Metrics Architecture

The metrics system has been unified through `MetricsAggregator`:

```
MetricsAggregator (unified interface)
├── BuildMetrics (PRD building)
├── PatternMetrics (pattern effectiveness)
└── ExecutionIntelligenceCollector (task execution, PRD insights, provider performance)
```

The aggregator provides:
- Unified load/save operations
- Cross-system correlation analysis
- Provider/model recommendations
- Config effectiveness insights

## Usage

### Individual Metrics Systems

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

### Unified Metrics Aggregator

```typescript
import { MetricsAggregator } from '../metrics/aggregator';
import { CorrelationAnalyzer } from '../metrics/correlation-analyzer';

// Initialize aggregator
const aggregator = new MetricsAggregator({
  projectRoot: process.cwd(),
});

// Load all metrics
const unified = await aggregator.loadAll();

// Get correlation insights
const analyzer = aggregator.getCorrelationAnalyzer();
const correlations = await analyzer.analyze();

// Get recommendations
const recommendations = await analyzer.getRecommendations();
```

## Related Files

- `src/core/tracking/` - Progress and observation tracking
- `src/config/merger.ts` - Handles config overlay merging for metrics

