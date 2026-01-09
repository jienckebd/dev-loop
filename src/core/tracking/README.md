# Tracking System

This directory contains progress tracking, observation tracking, and feature usage tracking.

## Structure

- **progress-tracker.ts** - ProgressTracker for real-time progress updates
- **observation-tracker.ts** - ObservationTracker for tracking observations (failure patterns, efficiency issues, etc.)
- **feature-tracker.ts** - FeatureTracker for tracking PRD feature usage and performance
- **schema-tracker.ts** - SchemaTracker for tracking schema operations (create, update, delete, validate)
- **prd-tracker.ts** - PrdTracker for tracking PRD completion status
- **performance-monitor.ts** - PerformanceMonitor for monitoring execution performance

## Key Features

- **Real-time Progress**: Event-driven progress tracking with progress bars
- **Observation Tracking**: Tracks failure patterns, efficiency issues, validation trends
- **Feature Usage**: Tracks which PRD features are used and their performance
- **Schema Operations**: Tracks all schema operations and their performance
- **PRD Status**: Tracks PRD completion status across all tasks

## Usage

```typescript
import { ProgressTracker } from './tracking/progress-tracker';
import { ObservationTracker } from './tracking/observation-tracker';
import { FeatureTracker } from './tracking/feature-tracker';

// Track progress
const progressTracker = new ProgressTracker();
progressTracker.emitProgress({ type: 'task-start', taskId: '123' });

// Track observations
const observationTracker = new ObservationTracker();
await observationTracker.recordObservation(observation);
```

## Related Files

- `src/core/metrics/` - Metrics data (often used with tracking)
- `src/core/reporting/` - Reports use tracking data

