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

# PatternLoader Troubleshooting

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

## Configuration

Configure pattern learning in `devloop.config.js`:

```javascript
module.exports = {
  prdBuilding: {
    learningFiles: {
      enabled: true,
      patterns: '.devloop/patterns.json',
      filtering: {
        relevanceThreshold: 0.5,  // Minimum relevance score (0-1)
        retentionDays: 180,       // Keep entries for 180 days
        lastUsedDays: 90,         // Filter by last use (90 days)
      },
    },
  },
  patternLearning: {
    enabled: true,
    patternsPath: '.devloop/patterns.json',
  },
};
```

## Related Documentation

- [PRD Building Guide](../users/PRD_BUILDING.md) - How patterns are used in PRD building
- [Metrics Guide](../users/METRICS.md) - Pattern learning metrics
