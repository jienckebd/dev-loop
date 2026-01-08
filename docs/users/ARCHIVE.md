# Archive Command Guide

## Overview

The `archive` command moves Task Master and dev-loop JSON state files to an archive location, preserving execution history and freeing up space in the active state directories. The enhanced archive command also cleans up background agent processes, deletes Cursor agent files, and resets cursor sessions.

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

## Enhanced Archive Command

The archive command now performs comprehensive cleanup:

1. **Kills background agent processes** - Terminates any hanging Cursor background agent processes
   ```bash
   pkill -f "cursor.*agent"
   ```

2. **Deletes Cursor agent files** - Removes agent configuration files from `.cursor/agents/*.md`
   - These files are not archived, they are deleted completely
   - Agent files are optional and can be regenerated

3. **Resets cursor sessions** - Resets `.devloop/cursor-sessions.json` to initial state
   - Archives existing sessions first
   - Creates fresh session file for next execution

4. **Archives chat requests and instructions** - Moves Cursor chat files to archive:
   - `files-private/cursor/chat-requests.json`
   - `files-private/cursor/chat-instructions/`
   - `files-private/cursor/completed/`

5. **Resets all state files** - Archives and resets all dev-loop and task-master state files

### Background Agent Cleanup

The archive command automatically terminates hanging background agent processes:

```bash
npx dev-loop archive
# Automatically kills: pkill -f "cursor.*agent"
```

This prevents background processes from consuming resources after execution completes or if execution is interrupted.

## Notes

- Archiving does not delete original files (they are copied, not moved), except for agent files which are deleted
- Compressed archives require `tar` command to be available
- Archive timestamps use ISO format for easy sorting
- Archives preserve all execution history and metrics
- Background agent processes are terminated to prevent resource leaks
- Cursor agent files (`.cursor/agents/*.md`) are deleted, not archived




