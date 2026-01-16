# Pattern Schema Migration Guide

## Overview

The pattern system has been unified from multiple separate systems into a single `PatternLibraryManager`. This guide explains the migration process and how to handle existing pattern files.

## Migration Path

### From PatternLearningSystem (v1 schema)

**Old Format**: `.devloop/patterns.json`
```json
{
  "version": 1,
  "lastUpdated": "2025-01-15T10:00:00Z",
  "patterns": [
    {
      "id": "preserve-helpers",
      "pattern": "Removed existing helper",
      "guidance": "NEVER remove helpers",
      "occurrences": 5,
      "lastSeen": "2025-01-15T10:00:00Z",
      "files": ["test.ts"],
      "projectTypes": ["drupal"]
    }
  ]
}
```

**New Format**: `.devloop/pattern-library.json` (errorPatterns section)
```json
{
  "errorPatterns": [
    {
      "id": "preserve-helpers",
      "pattern": "Removed existing helper",
      "guidance": "NEVER remove helpers",
      "occurrences": 5,
      "lastSeen": "2025-01-15T10:00:00Z",
      "files": ["test.ts"],
      "projectTypes": ["drupal"]
    }
  ]
}
```

### From PatternLoader (v2 schema)

**Old Format**: `.devloop/patterns.json`
```json
{
  "version": "2.0",
  "updatedAt": "2025-01-15T10:00:00Z",
  "patterns": [
    {
      "id": "pattern-id",
      "createdAt": "2025-01-15T10:00:00Z",
      "lastUsedAt": "2025-01-15T10:00:00Z",
      "relevanceScore": 0.9,
      "expiresAt": null,
      "prdId": "prd-123",
      "framework": "drupal",
      "category": "schema",
      "pattern": "pattern text",
      "examples": [],
      "metadata": {}
    }
  ]
}
```

**New Format**: `.devloop/pattern-library.json` (prdPatterns section)
```json
{
  "prdPatterns": [
    {
      "id": "pattern-id",
      "createdAt": "2025-01-15T10:00:00Z",
      "lastUsedAt": "2025-01-15T10:00:00Z",
      "relevanceScore": 0.9,
      "expiresAt": null,
      "prdId": "prd-123",
      "framework": "drupal",
      "category": "schema",
      "pattern": "pattern text",
      "examples": [],
      "metadata": {}
    }
  ]
}
```

## Automatic Migration

Migration happens automatically:

1. **On First Use**: When `PatternLearningSystem` or `PatternLoader` is first used
2. **Transparent**: Old files are read, patterns migrated, new file created
3. **Backward Compatible**: Old files are preserved (not deleted)
4. **One-Time**: Migration only happens once per file

## Manual Migration

If you want to manually migrate:

1. **Backup old files**:
   ```bash
   cp .devloop/patterns.json .devloop/patterns.json.backup
   ```

2. **Delete new file** (if exists):
   ```bash
   rm .devloop/pattern-library.json
   ```

3. **Run init or build-prd-set**: Migration will re-run automatically

4. **Verify migration**: Check `.devloop/pattern-library.json` contains your patterns

## Migration Verification

After migration, verify:

1. **Pattern count matches**: All patterns from old file should be in new file
2. **Data integrity**: Pattern fields should be preserved
3. **No duplicates**: Same pattern shouldn't appear twice

## Rollback

If migration causes issues:

1. **Restore old file**:
   ```bash
   cp .devloop/patterns.json.backup .devloop/patterns.json
   ```

2. **Delete new file**:
   ```bash
   rm .devloop/pattern-library.json
   ```

3. **System will re-migrate** on next use

## Schema Compatibility

### PatternLearningSystem Compatibility

- Old v1 schema patterns are converted to `ErrorPattern` format
- All fields are preserved
- Built-in patterns are included automatically

### PatternLoader Compatibility

- Old v2 schema patterns are converted to `PrdPattern` format
- All fields are preserved
- Filtering logic works the same way

## Post-Migration

After migration:

1. **Old files can be deleted**: They're no longer used
2. **New file is authoritative**: All pattern operations use `.devloop/pattern-library.json`
3. **No data loss**: All pattern data is preserved
4. **Performance**: Unified storage is more efficient

## Troubleshooting Migration

### Migration Not Happening

- Check old file exists at `.devloop/patterns.json`
- Check file permissions (must be readable)
- Check JSON syntax is valid
- Run with `--debug` to see migration logs

### Patterns Missing After Migration

- Check migration logs for errors
- Verify old file had valid patterns
- Check new file was created successfully
- Restore from backup and re-migrate

### Duplicate Patterns

- Duplicates are automatically merged
- Occurrence counts are combined
- Files lists are merged
- No action needed

## Best Practices

1. **Backup before migration**: Always backup old pattern files
2. **Verify after migration**: Check pattern counts match
3. **Keep old files temporarily**: Don't delete until verified
4. **Monitor first use**: Watch for migration errors on first run
