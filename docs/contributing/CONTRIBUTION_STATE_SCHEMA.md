---
title: "Contribution Mode State Schema"
type: "reference"
category: "contributing"
audience: "both"
keywords: ["contribution", "state", "schema", "boundaries", "validation"]
related_docs:
  - "CONTRIBUTION_MODE.md"
prerequisites:
  - "CONTRIBUTION_MODE.md"
estimated_read_time: 10
contribution_mode: true
---

# Contribution Mode State Schema

Reference documentation for the contribution mode state file (`.devloop/contribution-mode.json`).

## File Location

```
.devloop/contribution-mode.json
```

## Schema

```typescript
interface ContributionModeState {
  active: boolean;
  prdPath: string;
  startedAt: string; // ISO 8601 timestamp
  outerAgentBoundaries: {
    allowed: string[];      // Array of path patterns (regex or glob)
    forbidden: string[];     // Array of path patterns (regex or glob)
  };
  innerAgentBoundaries: {
    allowed: string[];       // Array of path patterns (regex or glob)
    forbidden: string[];     // Array of path patterns (regex or glob)
  };
  rulesVersion: string;      // Version of rules schema
  rulesSource: string;       // Path to project rules file (e.g., ".cursor/rules/dev-loop.mdc")
  metadata?: {
    projectRoot?: string;    // Project root directory
    devLoopVersion?: string; // Dev-loop version
    lastUpdated?: string;    // ISO 8601 timestamp
  };
}
```

## Example

```json
{
  "active": true,
  "prdPath": ".taskmaster/docs/my_prd.md",
  "startedAt": "2025-01-20T10:00:00Z",
  "outerAgentBoundaries": {
    "allowed": [
      "node_modules/dev-loop/",
      ".taskmaster/",
      ".devloop/",
      "devloop.config.js"
    ],
    "forbidden": [
      "docroot/",
      "tests/",
      "config/",
      "script/"
    ]
  },
  "innerAgentBoundaries": {
    "allowed": [
      "docroot/",
      "tests/",
      "config/",
      "script/"
    ],
    "forbidden": [
      "node_modules/dev-loop/",
      ".taskmaster/tasks/tasks.json",
      ".devloop/contribution-mode.json",
      "devloop.config.js"
    ]
  },
  "rulesVersion": "1.0.0",
  "rulesSource": ".cursor/rules/dev-loop.mdc",
  "metadata": {
    "projectRoot": "/Users/bry/sys/drupal/instance/sysf",
    "devLoopVersion": "0.40.0",
    "lastUpdated": "2025-01-20T10:05:00Z"
  }
}
```

## Path Pattern Matching

Boundaries use path patterns that can be:

1. **Literal paths**: Exact file or directory paths
   - `"devloop.config.js"` - Matches exactly this file
   - `".taskmaster/"` - Matches this directory and all subdirectories

2. **Glob patterns**: Unix-style glob patterns
   - `"node_modules/dev-loop/**"` - Matches all files under this directory
   - `"*.config.js"` - Matches all files ending in `.config.js`

3. **Regex patterns**: Regular expressions (when prefixed with `regex:`)
   - `"regex:^docroot/modules/share/.*\\.php$"` - Matches PHP files in custom modules
   - `"regex:^tests/playwright/.*\\.spec\\.ts$"` - Matches Playwright test files

## Validation Rules

### On Contribution Mode Start

1. Create state file if it doesn't exist
2. Validate that project rules file exists (if specified in `rulesSource`)
3. Extract boundaries from project rules
4. Merge with default boundaries
5. Store validated boundaries in state file

### On Code Changes

1. Check if contribution mode is active (`active: true`)
2. Determine agent type (outer or inner) based on context
3. Validate file path against appropriate boundaries:
   - Must match at least one `allowed` pattern
   - Must not match any `forbidden` pattern
4. Reject changes that violate boundaries
5. Log boundary violations for debugging

### On Contribution Mode Stop

1. Archive state file (move to `.devloop/contribution-mode.json.archive`)
2. Add completion timestamp
3. Validate that all changes were within boundaries
4. Generate audit report (optional)

## Default Boundaries

If no project-specific rules are found, dev-loop uses default boundaries:

### Outer Agent (Default)

```json
{
  "allowed": [
    "node_modules/dev-loop/",
    ".taskmaster/",
    ".devloop/",
    "devloop.config.js"
  ],
  "forbidden": [
    "docroot/",
    "tests/",
    "config/",
    "script/"
  ]
}
```

### Inner Agent (Default)

```json
{
  "allowed": [
    "docroot/",
    "tests/",
    "config/",
    "script/"
  ],
  "forbidden": [
    "node_modules/dev-loop/",
    ".taskmaster/tasks/tasks.json",
    ".devloop/contribution-mode.json",
    "devloop.config.js"
  ]
}
```

## State File Lifecycle

1. **Created**: When contribution mode starts
2. **Updated**: When boundaries are validated or rules change
3. **Archived**: When contribution mode stops
4. **Deleted**: When contribution mode is reset

## Error Handling

### Invalid State File

If state file is corrupted or invalid:

1. Log error
2. Attempt to recover from backup (if exists)
3. If recovery fails, prompt user to restart contribution mode
4. Create new state file with default boundaries

### Boundary Violations

When a boundary violation is detected:

1. Log violation with details (file path, agent type, matched patterns)
2. Reject the change
3. Provide clear error message to user
4. Suggest how to fix (update rules or move file)

## Related Documentation

- [Contribution Mode Guide](CONTRIBUTION_MODE.md) - Complete contribution mode documentation
- [Development Workflow](DEVELOPMENT_WORKFLOW.md) - How to make changes
