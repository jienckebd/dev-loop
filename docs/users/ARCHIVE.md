# Archive Command Guide

## Overview

The `archive` command moves Task Master and dev-loop JSON state files to an archive location, preserving execution history and freeing up space in the active state directories.

## Usage

### Basic Archive

```bash
# Archive state files for a PRD
dev-loop archive --prd-name browser_validation_test
```

This creates an archive at:
```
.devloop/archive/browser_validation_test/2026-01-05T19-30-45/
```

### Custom Archive Path

```bash
# Specify custom archive path
dev-loop archive --prd-name browser_validation_test --archive-path ./backups
```

### Compressed Archive

```bash
# Create compressed .tar.gz archive
dev-loop archive --prd-name browser_validation_test --compress
```

## Archive Structure

Archives preserve the original file structure:

```
.devloop/archive/
  └── {{ prd_name }}/
      └── {{ timestamp }}/
          ├── devloop/
          │   ├── state.json
          │   ├── metrics.json
          │   ├── observations.json
          │   ├── patterns.json
          │   ├── retry-counts.json
          │   ├── contribution-mode.json
          │   ├── evolution-state.json
          │   ├── prd-set-metrics.json
          │   ├── prd-metrics.json
          │   ├── phase-metrics.json
          │   ├── feature-metrics.json
          │   ├── schema-metrics.json
          │   ├── observation-metrics.json
          │   ├── pattern-metrics.json
          │   └── prd-context/
          │       └── *.json
          └── taskmaster/
              ├── state.json
              ├── config.json
              └── tasks/
                  └── *.json
```

## Files Archived

### Dev-Loop State Files
- `.devloop/state.json`
- `.devloop/metrics.json`
- `.devloop/observations.json`
- `.devloop/patterns.json`
- `.devloop/retry-counts.json`
- `.devloop/contribution-mode.json`
- `.devloop/evolution-state.json`
- `.devloop/prd-context/*.json`
- All metrics files (prd-set, prd, phase, feature, schema, observation, pattern)

### Task Master State Files
- `.taskmaster/state.json`
- `.taskmaster/config.json`
- `.taskmaster/tasks/*.json`

## Configuration

Configure archive settings in `devloop.config.js`:

```javascript
module.exports = {
  archive: {
    enabled: true,
    defaultPath: '.devloop/archive',
    compress: false, // Optional: create .tar.gz archives
    preserveStructure: true,
  },
};
```

## Best Practices

1. **Archive After PRD Completion**: Archive state files after a PRD is successfully completed
2. **Regular Archiving**: Archive periodically to prevent state files from growing too large
3. **Compressed Archives**: Use `--compress` for long-term storage to save disk space
4. **Naming Convention**: Use descriptive PRD names for easy identification
5. **Backup Strategy**: Consider backing up archives to external storage

## Examples

### Archive Current PRD

```bash
dev-loop archive --prd-name browser_validation_test
```

### Archive and Compress

```bash
dev-loop archive --prd-name browser_validation_test --compress
```

### Archive to Custom Location

```bash
dev-loop archive --prd-name browser_validation_test --archive-path ~/backups/dev-loop
```

## Restoring from Archive

To restore archived state files:

1. Copy files from archive back to their original locations
2. Ensure file structure matches original paths
3. Restart dev-loop to use restored state

## Notes

- Archiving does not delete original files (they are copied, not moved)
- Compressed archives require `tar` command to be available
- Archive timestamps use ISO format for easy sorting
- Archives preserve all execution history and metrics




