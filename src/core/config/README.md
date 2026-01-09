# Configuration Management

This directory contains configuration merging functionality for hierarchical configuration overlays.

## Structure

- **merger.ts** - HierarchicalConfigurationMerger for merging config overlays at multiple levels

## Hierarchical Configuration Merging

The config merger merges configuration overlays in the following order:

1. Project Config (from `devloop.config.js`)
2. Framework Config (from base config)
3. PRD Set Config (from `index.md.yml` or `prd-set-config.json`)
4. PRD Config (from PRD frontmatter `config:` section)
5. Phase Config (from `requirements.phases[].config`)

Later levels override earlier levels. Deep merge for nested objects. Special handling for arrays that should be concatenated vs replaced.

## Array Merge Behavior

Certain arrays are concatenated (not replaced):
- `framework.rules`
- `codebase.searchDirs`
- `codebase.excludeDirs`
- `codebase.ignoreGlobs`
- `hooks.preTest`
- `hooks.postApply`

All other arrays are replaced by overlay values.

## Usage

```typescript
import { createConfigContext, applyPrdSetConfig } from './config/merger';

// Create config context with base config
const context = createConfigContext(baseConfig);

// Apply PRD set config overlay
const mergedConfig = applyPrdSetConfig(context, prdSetConfigOverlay);

// Apply PRD config overlay
const finalConfig = applyPrdSetConfig(context, prdConfigOverlay);
```

## Related Files

- `src/config/schema/overlays.ts` - Defines `ConfigOverlay` schema using `.partial().passthrough()` pattern
- `src/core/prd/set/orchestrator.ts` - Uses config merger for PRD set execution
- `src/config/schema/` - Modular schema structure for configuration validation

