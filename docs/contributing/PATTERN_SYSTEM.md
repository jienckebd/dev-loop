---
title: Pattern System Developer Guide
description: Architecture and implementation of the unified PatternLibraryManager
category: contributing
keywords: [patterns, PatternLibraryManager, architecture, implementation]
related: [users/PATTERNS, MIGRATION_PATTERNS]
---

# Pattern System Developer Guide

## Architecture

The pattern system has been unified into a single `PatternLibraryManager` that handles all pattern types:

```
PatternLibraryManager (unified storage)
├── ErrorPatterns (from PatternLearningSystem)
├── PRDPatterns (from PatternLoader)
├── CodePatterns (from CodebaseAnalyzer)
├── SchemaPatterns (from CodebaseAnalyzer)
└── TestPatterns (from CodebaseAnalyzer)
```

## Pattern Library Schema

All patterns are stored in `.devloop/pattern-library.json` with this structure:

```typescript
{
  errorPatterns?: ErrorPattern[];
  prdPatterns?: PrdPattern[];
  codePatterns?: CodePattern[];
  schemaPatterns?: SchemaPattern[];
  testPatterns?: TestPattern[];
  metadata?: {
    lastAnalyzed: string;
    totalPatterns: number;
    frameworkDistribution?: Record<string, number>;
  };
}
```

## Pattern Types

### ErrorPattern
```typescript
{
  id: string;
  pattern: string; // Regex pattern
  guidance: string; // Guidance text
  occurrences: number;
  lastSeen: string;
  files?: string[];
  projectTypes?: string[];
  injectionCount?: number;
  preventionCount?: number;
  lastInjected?: string;
}
```

### PrdPattern
```typescript
{
  id: string;
  createdAt: string;
  lastUsedAt: string;
  relevanceScore: number; // 0-1
  expiresAt?: string | null;
  prdId?: string;
  framework?: string;
  category: string;
  pattern: string;
  examples?: string[];
  metadata?: Record<string, any>;
}
```

### CodePattern
```typescript
{
  id: string;
  type: 'schema' | 'plugin' | 'service' | 'test' | 'config' | 'entity' | 'form' | 'other';
  signature: string;
  files: string[];
  occurrences: number;
  discoveredAt: string;
  lastUsedAt?: string;
  frameworkHints?: string[];
  suggestedAbstraction?: string;
}
```

## Adding New Pattern Types

1. **Extend the schema** in `src/config/schema/pattern-library.ts`:
   ```typescript
   export const newPatternSchema = z.object({
     // ... pattern fields
   });
   ```

2. **Add to PatternLibrary schema**:
   ```typescript
   export const patternLibrarySchema = z.object({
     // ... existing patterns
     newPatterns: z.array(newPatternSchema).optional(),
   });
   ```

3. **Add methods to PatternLibraryManager**:
   ```typescript
   addNewPattern(pattern: NewPattern): void { ... }
   getNewPatterns(): NewPattern[] { ... }
   ```

4. **Update persistence** in `prune()` and `mergeFrom()` methods

## Using PatternLibraryManager

### Basic Usage
```typescript
import { PatternLibraryManager } from '../analysis/pattern-library-manager';

const manager = new PatternLibraryManager({
  projectRoot: process.cwd(),
  debug: false,
});

// Load patterns
await manager.load();

// Add patterns
manager.addErrorPattern({ ... });
manager.addCodePattern({ ... });

// Save
await manager.save();
```

### Filtering PRD Patterns
```typescript
const filtered = await manager.filterPrdPatterns({
  retentionDays: 180,
  relevanceThreshold: 0.5,
  lastUsedDays: 90,
  framework: 'drupal',
  category: 'schema',
  excludeExpired: true,
});
```

### Pruning Old Patterns
```typescript
const prunedCount = await manager.prune(180); // 180 days retention
```

## Migration from Legacy Systems

### PatternLearningSystem Migration
- Old: `.devloop/patterns.json` (v1 schema)
- New: `.devloop/pattern-library.json` (errorPatterns)
- Migration: Automatic on first load
- PatternLearningSystem now delegates to PatternLibraryManager

### PatternLoader Migration
- Old: `.devloop/patterns.json` (v2 schema)
- New: `.devloop/pattern-library.json` (prdPatterns)
- Migration: Automatic on first load
- PatternLoader now delegates to PatternLibraryManager

## Integration Points

### PatternLearningSystem
- Uses PatternLibraryManager for storage
- Converts between LearnedPattern and ErrorPattern formats
- Maintains backward compatibility with old patterns.json

### PatternLoader
- Uses PatternLibraryManager.filterPrdPatterns() for filtering
- Converts between PatternEntry and PrdPattern formats
- Handles schema validation during migration

### CodebaseAnalyzer
- Persists discovered patterns to PatternLibraryManager
- Saves code, schema, and test patterns
- Patterns are discovered during codebase analysis

## Testing

When testing pattern system changes:
1. Test migration from old formats
2. Test filtering logic
3. Test pruning behavior
4. Test pattern matching and relevance scoring
5. Verify backward compatibility

## Performance Considerations

- Patterns are loaded lazily (on first access)
- Filtering is done in-memory after load
- Pruning happens asynchronously
- Large pattern libraries (>10k patterns) may need optimization
