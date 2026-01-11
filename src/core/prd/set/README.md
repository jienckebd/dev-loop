# PRD Set Management

This directory contains PRD set discovery, validation, orchestration, and execution management.

## Structure

- **discovery.ts** - Discovers PRD sets from `index.md.yml` files or directory scanning
- **validator.ts** - Validates PRD sets at multiple levels (set, PRD, phase)
- **orchestrator.ts** - Orchestrates PRD set execution with parallel processing
- **generator.ts** - Generates PRD set structures and `index.md.yml` files
- **progress-tracker.ts** - Tracks PRD set execution progress
- **error-handler.ts** - Handles PRD set-level errors and recovery

## PRD Set Discovery

PRD sets can be discovered in two ways:

1. **From `index.md.yml` file** (preferred):
   - Contains PRD set manifest with parent PRD and child PRDs
   - Includes config overlay for the entire PRD set
   - Structure defined by `PrdSetManifest` interface

2. **From directory scanning** (fallback):
   - Scans directory for PRD files
   - Auto-detects relationships based on file structure
   - Creates PRD set structure automatically

## PRD Set Validation

Validation occurs at three levels:

- **Set Level**: Validates manifest structure, PRD references, config overlay
- **PRD Level**: Validates individual PRD schemas
- **Phase Level**: Validates phase definitions and phase-level config overlays

## PRD Set Orchestration

The orchestrator:
- Executes PRDs in parallel when independent (up to `maxConcurrent` limit)
- Respects dependencies between PRDs
- Merges hierarchical configuration overlays (Project → Framework → PRD Set → PRD → Phase)
- Tracks PRD set-level metrics and progress
- Handles errors at PRD set level

## Usage

```typescript
import { PrdSetDiscovery } from './prd/set/discovery';
import { PrdSetValidator } from './prd/set/validator';
import { PrdSetOrchestrator } from './prd/set/orchestrator';

// Discover PRD set
const discovery = new PrdSetDiscovery();
const prdSet = await discovery.discoverPrdSet('.taskmaster/planning/my-set');

// Validate PRD set
const validator = new PrdSetValidator();
const validationResult = await validator.validate(prdSet);

// Execute PRD set
const orchestrator = new PrdSetOrchestrator(config);
const result = await orchestrator.executePrdSet(prdSet, { parallel: true, maxConcurrent: 2 });
```

## Related Files

- `src/core/prd/parser/manifest-parser.ts` - Parses `index.md.yml` files
- `src/config/merger.ts` - Handles hierarchical config merging
- `src/core/metrics/prd-set.ts` - PRD set-level metrics tracking

