# PRD System

This directory contains PRD parsing, coordination, validation, and set management functionality.

## Structure

### parser/
- **parser.ts** - PrdParser class for parsing PRD files
- **config-parser.ts** - PrdConfigParser for parsing PRD config overlays
- **manifest-parser.ts** - PrdManifestParser for parsing PRD set manifests (index.md.yml)
- **planning-doc-parser.ts** - PlanningDocParser for parsing planning documents

### set/
- **discovery.ts** - PrdSetDiscovery for discovering PRD sets from index.md.yml or directory scanning
- **validator.ts** - PrdSetValidator for validating PRD sets at multiple levels
- **orchestrator.ts** - PrdSetOrchestrator for orchestrating PRD set execution with parallel processing
- **generator.ts** - PrdSetGenerator for generating PRD set structures
- **progress-tracker.ts** - PrdSetProgressTracker for tracking PRD set execution progress
- **error-handler.ts** - PrdSetErrorHandler for handling PRD set-level errors

### coordination/
- **coordinator.ts** - PrdCoordinator for coordinating PRD execution
- **context.ts** - PrdContext and PrdContextManager for managing PRD context and requirements

### validation/
- **cross-prd-validator.ts** - CrossPrdValidator for validating cross-PRD dependencies

## Key Features

- **PRD Parsing**: Parses PRD frontmatter and extracts metadata, requirements, phases
- **PRD Set Discovery**: Discovers PRD sets from `index.md.yml` files or directory scanning
- **PRD Set Orchestration**: Executes PRD sets with parallel processing and dependency awareness
- **Configuration Overlays**: Supports hierarchical config overlays at PRD set, PRD, and phase levels
- **Cross-PRD Validation**: Validates dependencies and relationships across PRDs

## Usage

```typescript
import { PrdParser } from './prd/parser/parser';
import { PrdSetDiscovery } from './prd/set/discovery';
import { PrdSetOrchestrator } from './prd/set/orchestrator';

// Parse PRD
const parser = new PrdParser(aiProvider);
const prd = await parser.parse(prdPath);

// Discover PRD set
const discovery = new PrdSetDiscovery();
const prdSet = await discovery.discoverPrdSet(directoryPath);

// Orchestrate PRD set execution
const orchestrator = new PrdSetOrchestrator(config);
const result = await orchestrator.executePrdSet(prdSet);
```

## Related Files

- `src/core/config/merger.ts` - Handles hierarchical config merging for PRD sets
- `src/core/metrics/prd-set.ts` - PRD set-level metrics

