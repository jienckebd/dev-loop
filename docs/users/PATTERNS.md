---
title: Pattern System User Guide
description: Discover, learn, and apply patterns across your codebase
category: users
keywords: [patterns, learning, error-patterns, code-patterns]
related: [contributing/PATTERN_SYSTEM, MIGRATION_PATTERNS]
---

# Pattern System User Guide

## Overview

The dev-loop pattern system provides a unified way to discover, learn, and apply patterns across your codebase. Patterns help the AI understand your project's conventions and avoid common mistakes.

## Pattern Types

The unified pattern system supports several pattern types:

### Error Patterns
Error patterns are learned from validation and test failures. They help prevent repeating the same mistakes.

**Storage**: `.devloop/pattern-library.json` (errorPatterns section)

**Examples**:
- "Patch not found" errors → guidance on exact string matching
- "Function not defined" errors → guidance on using existing functions
- "Import path not found" → guidance on copying exact import paths

### Code Patterns
Code patterns are discovered from your codebase structure. They represent common code structures, plugin patterns, service patterns, etc.

**Storage**: `.devloop/pattern-library.json` (codePatterns section)

**Examples**:
- Service class patterns
- Plugin registration patterns
- Entity type definition patterns

### Schema Patterns
Schema patterns are framework-specific configuration patterns (e.g., Drupal entity types, React component schemas).

**Storage**: `.devloop/pattern-library.json` (schemaPatterns section)

**Examples**:
- `bd.entity_type.*.yml` patterns
- `node.type.*.yml` patterns

### Test Patterns
Test patterns represent test structure patterns for your test framework.

**Storage**: `.devloop/pattern-library.json` (testPatterns section)

**Examples**:
- Playwright test structure
- Jest test patterns

### PRD Patterns
PRD patterns are learned from PRD building processes and represent reusable patterns for PRD generation.

**Storage**: `.devloop/pattern-library.json` (prdPatterns section)

## How Patterns Are Used

### During Code Generation
When generating code, the system:
1. Loads relevant error patterns based on task context
2. Checks codebase patterns for similar structures
3. Includes schema patterns for configuration tasks
4. Applies test patterns for test generation
5. Injects guidance into AI prompts to prevent mistakes

### During PRD Building
When building PRDs, the system:
1. Loads PRD patterns from previous successful builds
2. Filters patterns by relevance, recency, and framework
3. Uses patterns to suggest better PRD structures

## Pattern Discovery

Patterns are automatically discovered during:
- **Codebase Analysis**: When running `dev-loop init` or `dev-loop build-prd-set`
- **Error Learning**: When validation or tests fail, patterns are recorded
- **PRD Building**: Successful PRD patterns are saved for reuse

## Pattern Filtering

Patterns are automatically filtered based on:
- **Relevance Score**: Only patterns above threshold (default: 0.5) are used
- **Recency**: Patterns not used recently (default: 90 days) are excluded
- **Retention**: Patterns older than retention period (default: 180 days) are pruned
- **Framework**: Patterns are filtered by detected framework
- **Expiration**: Patterns with expiration dates are excluded if expired

## Configuration

Pattern learning can be configured in `devloop.config.js`:

```javascript
{
  patternLearning: {
    enabled: true,
    patternsPath: '.devloop/pattern-library.json',
    useBuiltinPatterns: true,
  },
  prdBuilding: {
    learningFiles: {
      patterns: '.devloop/patterns.json', // Legacy v2 format (auto-migrated)
      // ... other learning files
    },
    filtering: {
      patternsRetentionDays: 180,
      relevanceThreshold: 0.5,
      autoPrune: true,
    },
  },
}
```

## Migration from Old Formats

If you have existing pattern files:
- `.devloop/patterns.json` (v1 or v2) → automatically migrated to `.devloop/pattern-library.json`
- Migration happens on first use
- Old files are preserved but not used after migration

## Best Practices

1. **Let patterns accumulate**: The system learns over time - don't delete pattern files
2. **Review pattern effectiveness**: Check which patterns are most helpful
3. **Adjust retention**: Increase retention for stable projects, decrease for experimental ones
4. **Framework-specific patterns**: Patterns are automatically tagged with framework hints

## Troubleshooting

### Patterns Not Being Applied
- Check that `patternLearning.enabled` is `true`
- Verify pattern file exists at `.devloop/pattern-library.json`
- Check pattern relevance scores (low scores are filtered out)

### Too Many Patterns
- Adjust `relevanceThreshold` to be more selective
- Reduce `retentionDays` to prune older patterns
- Enable `autoPrune` for automatic cleanup

### Patterns Out of Date
- Patterns are automatically pruned based on `lastUsedAt`
- Manually prune by deleting `.devloop/pattern-library.json` and restarting
- Patterns will be rediscovered from codebase analysis
