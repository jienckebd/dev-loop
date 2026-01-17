---
title: Documentation Index
description: Master index for all dev-loop documentation - start here for discovery
category: index
audience: ai
keywords: [index, discovery, navigation, documentation, overview]
---

# Dev-Loop Documentation Index

**AI Agents**: Start here to discover documentation. Use frontmatter metadata (title, description, category, keywords, related) to find relevant docs.

## Quick Navigation by Task

| Task | Primary Doc | Category |
|------|-------------|----------|
| Create a PRD | [ai/PRD_TEMPLATE.md](ai/PRD_TEMPLATE.md) | ai |
| Validate PRD schema | [ai/PRD_SCHEMA.md](ai/PRD_SCHEMA.md) | ai |
| Configure dev-loop | [users/CONFIG.md](users/CONFIG.md) | users |
| Set up project | [users/INIT_COMMAND.md](users/INIT_COMMAND.md) | users |
| Understand architecture | [contributing/ARCHITECTURE.md](contributing/ARCHITECTURE.md) | contributing |
| Debug JSON parsing | [troubleshooting/json-parsing.md](troubleshooting/json-parsing.md) | troubleshooting |
| Configure phase hooks | [users/PHASE_HOOKS.md](users/PHASE_HOOKS.md) | users |
| Check metrics | [users/METRICS.md](users/METRICS.md) | users |
| Generate reports | [users/REPORTS.md](users/REPORTS.md) | users |
| Contribute to dev-loop | [contributing/README.md](contributing/README.md) | contributing |

## Documentation Structure

```
docs/
├── INDEX.md                    # This file - master navigation
├── ai/                         # AI agent documentation
│   ├── INDEX.md               # AI-specific navigation
│   ├── METADATA.md            # Frontmatter system reference
│   ├── PRD_SCHEMA.md          # PRD schema reference
│   ├── PRD_TEMPLATE.md        # PRD creation template
│   ├── PRD_FEATURES.md        # Advanced PRD features
│   ├── STATE_MANAGEMENT.md    # State and Ralph pattern
│   └── README.md              # AI onboarding guide
├── users/                      # End-user documentation
│   ├── README.md              # User guide overview
│   ├── CONFIG.md              # Configuration reference
│   ├── INIT_COMMAND.md        # Project setup
│   ├── METRICS.md             # Metrics system
│   ├── REPORTS.md             # Report generation
│   ├── PATTERNS.md            # Pattern system
│   ├── PHASE_HOOKS.md         # Framework hooks
│   ├── ARCHIVE.md             # Archive command
│   └── PRD_BUILDING.md        # Building PRDs
├── contributing/               # Contributor documentation
│   ├── README.md              # Contributor overview
│   ├── ARCHITECTURE.md        # System architecture
│   ├── EVENT_STREAMING.md     # Event system
│   ├── PATTERN_SYSTEM.md      # Pattern implementation
│   ├── STATE_DEPENDENCIES.md  # State file mapping
│   └── [other guides]
├── architecture/               # Architecture deep-dives
│   └── ipc.md                 # IPC system
├── troubleshooting/            # Problem solving
│   ├── README.md              # Troubleshooting overview
│   ├── json-parsing.md        # JSON parsing issues
│   └── patterns.md            # Pattern issues
├── JSON_SCHEMA_SOLUTION.md     # JSON schema approach
├── MIGRATION_PATTERNS.md       # Pattern migration
└── CURSOR_INTEGRATION.md       # Cursor IDE integration
```

## Categories

### ai/ - AI Agent Documentation
For AI agents creating PRDs and understanding dev-loop behavior.

| Document | Purpose |
|----------|---------|
| [PRD_SCHEMA.md](ai/PRD_SCHEMA.md) | Complete schema reference for PRD frontmatter |
| [PRD_TEMPLATE.md](ai/PRD_TEMPLATE.md) | Starting template for new PRDs |
| [PRD_FEATURES.md](ai/PRD_FEATURES.md) | Advanced features: error guidance, test generation |
| [STATE_MANAGEMENT.md](ai/STATE_MANAGEMENT.md) | Ralph pattern and state architecture |
| [METADATA.md](ai/METADATA.md) | Frontmatter metadata system reference |
| [INDEX.md](ai/INDEX.md) | AI-specific lookup tables |

### users/ - End-User Documentation
For humans using dev-loop to execute PRDs.

| Document | Purpose |
|----------|---------|
| [CONFIG.md](users/CONFIG.md) | devloop.config.js reference |
| [INIT_COMMAND.md](users/INIT_COMMAND.md) | `dev-loop init` setup |
| [METRICS.md](users/METRICS.md) | Metrics and EventMetricBridge |
| [REPORTS.md](users/REPORTS.md) | Report generation |
| [PHASE_HOOKS.md](users/PHASE_HOOKS.md) | Framework hooks (module-enable, cache-rebuild) |
| [PATTERNS.md](users/PATTERNS.md) | Pattern learning system |
| [ARCHIVE.md](users/ARCHIVE.md) | State cleanup and archival |
| [PRD_BUILDING.md](users/PRD_BUILDING.md) | Building PRD sets |

### contributing/ - Contributor Documentation
For developers contributing to dev-loop codebase.

| Document | Purpose |
|----------|---------|
| [ARCHITECTURE.md](contributing/ARCHITECTURE.md) | System architecture and components |
| [EVENT_STREAMING.md](contributing/EVENT_STREAMING.md) | Event stream and EventMetricBridge |
| [PATTERN_SYSTEM.md](contributing/PATTERN_SYSTEM.md) | PatternLibraryManager internals |
| [STATE_DEPENDENCIES.md](contributing/STATE_DEPENDENCIES.md) | State file mapping |
| [CONTRIBUTION_MODE.md](contributing/CONTRIBUTION_MODE.md) | Outer agent contribution mode |
| [EXECUTION_MODES.md](contributing/EXECUTION_MODES.md) | PRD set vs single PRD execution |

### troubleshooting/ - Problem Solving
For debugging common issues.

| Document | Purpose |
|----------|---------|
| [json-parsing.md](troubleshooting/json-parsing.md) | JSON response format and parsing errors |
| [patterns.md](troubleshooting/patterns.md) | Pattern system issues |

## Frontmatter Reference

All documentation files use YAML frontmatter for discovery:

```yaml
---
title: Document Title
description: One-line description
category: users|ai|contributing|architecture|troubleshooting|migration
keywords: [searchable, terms]
related: [path/to/related, docs]
---
```

**Discovery tips for AI agents:**
1. Search `keywords` array for task-relevant terms
2. Use `category` to filter by audience
3. Follow `related` links for deeper context
4. The `description` field summarizes content

## See Also

- [README.md](../README.md) - Main dev-loop README with architecture overview
- [ai/METADATA.md](ai/METADATA.md) - Detailed frontmatter system reference
