---
title: "PatternLoader Troubleshooting"
type: "troubleshooting"
category: "troubleshooting"
audience: "both"
keywords: ["patternloader", "patterns", "version", "schema", "validation"]
related_docs:
  - "../users/PRD_BUILDING.md"
prerequisites: []
estimated_read_time: 5
---

# Pattern System Troubleshooting

## Unified Pattern System

The pattern system has been unified into a single `PatternLibraryManager` that handles all pattern types. Legacy `.devloop/patterns.json` files are automatically migrated to `.devloop/pattern-library.json`.

## PatternLoader Troubleshooting (Legacy)

## Version Mismatch Warnings

### Problem

You see warnings like:
```
[WARN] [PatternLoader] Schema validation errors: Invalid version: expected "2.0", got "1"
[WARN] [PatternLoader] Patterns file has unexpected version: 1. Expected v2.0.
```

### Solution

The patterns file (`.devloop/patterns.json`) uses an incorrect version format. Update the version field:

**Before:**
```json
{
  "version": 1,
  ...
}
```

**After:**
```json
{
  "version": "2.0",
  ...
}
```

### Why This Happens

- PatternLoader expects version `"2.0"` (string) per schema definition
- Older patterns files may have numeric version `1`
- SchemaValidator auto-migrates the structure but still logs warnings

### Verification

After updating, run:
```bash
npx dev-loop build-prd-set --convert <path> 2>&1 | grep -i "patternloader"
```

Expected: No output (no warnings)

## Other PatternLoader Issues

### Patterns Not Loading

If patterns aren't loading:
1. Check file exists: `.devloop/patterns.json`
2. Verify JSON syntax is valid
3. Check file permissions
4. Review PatternLoader logs for specific errors

### Pattern Relevance Issues

If patterns aren't being applied:
1. Check `relevanceThreshold` in config
2. Review pattern `relevanceScore` values
3. Verify pattern `expiresAt` dates (null = never expires)

## Pattern File Structure

The patterns file should have this structure:

```json
{
  "version": "2.0",
  "lastUpdated": "2026-01-13T14:49:57.973Z",
  "patterns": [
    {
      "id": "pattern-id",
      "createdAt": "2026-01-13T17:25:25.105Z",
      "lastUsedAt": "2026-01-13T17:25:25.105Z",
      "relevanceScore": 1,
      "expiresAt": null,
      "category": "general",
      "pattern": "pattern regex or string",
      "examples": [],
      "metadata": {}
    }
  ],
  "updatedAt": "2026-01-13T17:25:25.105Z"
}
```

## Unified Pattern System Issues

### Patterns Not Migrating

If old `.devloop/patterns.json` files aren't being migrated:

1. **Check file exists**: Verify `.devloop/patterns.json` exists
2. **Check migration**: Migration happens automatically on first use
3. **Manual migration**: Delete `.devloop/pattern-library.json` and restart - migration will re-run
4. **Verify migration**: Check that `.devloop/pattern-library.json` contains your patterns

### Pattern Library Not Loading

If `.devloop/pattern-library.json` isn't loading:

1. **Check file exists**: Verify file exists at `.devloop/pattern-library.json`
2. **Check JSON syntax**: Validate JSON is well-formed
3. **Check permissions**: Ensure file is readable
4. **Check schema**: Verify pattern library matches expected schema

### Patterns Not Being Applied

If patterns aren't being used during code generation:

1. **Check patternLearning.enabled**: Must be `true` in config
2. **Check relevance scores**: Patterns below `relevanceThreshold` are filtered
3. **Check recency**: Patterns not used in `lastUsedDays` are excluded
4. **Check expiration**: Patterns with `expiresAt` in past are excluded
5. **Check framework**: Patterns are filtered by detected framework

### Too Many Patterns

If pattern library is too large:

1. **Adjust retention**: Reduce `retentionDays` in config
2. **Adjust threshold**: Increase `relevanceThreshold` to be more selective
3. **Enable auto-prune**: Set `autoPrune: true` in filtering config
4. **Manual prune**: Delete `.devloop/pattern-library.json` and let system rediscover

## Configuration

Configure pattern learning in `devloop.config.js`:

```javascript
module.exports = {
  patternLearning: {
    enabled: true,
    patternsPath: '.devloop/pattern-library.json', // Unified storage
    useBuiltinPatterns: true,
  },
  prdBuilding: {
    learningFiles: {
      enabled: true,
      patterns: '.devloop/pattern-library.json', // Now uses unified storage
      filtering: {
        relevanceThreshold: 0.5,  // Minimum relevance score (0-1)
        retentionDays: 180,       // Keep entries for 180 days
        lastUsedDays: 90,         // Filter by last use (90 days)
        autoPrune: true,          // Auto-prune old patterns
      },
    },
  },
};
```

## Migration Notes

- **Automatic Migration**: Old `.devloop/patterns.json` (v1/v2) files are automatically migrated
- **Backward Compatibility**: PatternLearningSystem and PatternLoader maintain same APIs
- **Storage Location**: All patterns now stored in `.devloop/pattern-library.json`
- **No Data Loss**: Migration preserves all pattern data

## Related Documentation

- [PRD Building Guide](../users/PRD_BUILDING.md) - How patterns are used in PRD building
- [Metrics Guide](../users/METRICS.md) - Pattern learning metrics
