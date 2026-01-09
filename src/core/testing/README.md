# Testing System

This directory contains test generation, execution, and management functionality.

## Structure

- **generator.ts** - TestGenerator class for generating tests from requirements
- **executor.ts** - TestExecutor class for running tests and collecting results
- **spec-executor.ts** - TestSpecExecutor for executing test specs with validation
- **tracker.ts** - TestResultsTracker for tracking test results across PRD sets, PRDs, phases
- **baseline.ts** - TestBaselineManager for managing test baselines
- **data.ts** - TestDataManager for managing test data

## Key Features

- **Test Generation**: Generates tests from PRD requirements using AI
- **Test Execution**: Executes tests via configured test runners (Playwright, Cypress, etc.)
- **Results Tracking**: Tracks test results hierarchically (PRD Set → PRD → Phase → Task)
- **Baseline Management**: Manages test baselines for regression detection
- **Data Management**: Manages test data and fixtures

## Usage

```typescript
import { TestGenerator } from './testing/generator';
import { TestExecutor } from './testing/executor';
import { TestResultsTracker } from './testing/tracker';

// Generate tests
const generator = new TestGenerator(aiProvider, config);
const tests = await generator.generateTests(requirement, context);

// Execute tests
const executor = new TestExecutor(testRunner);
const results = await executor.runTests(testPaths);

// Track results
const tracker = new TestResultsTracker();
tracker.recordTestResult(prdId, phaseId, taskId, results);
```

## Related Files

- `src/core/validation/` - Validation gates and scripts
- `src/core/reporting/` - Report generation for test results

