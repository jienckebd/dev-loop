# Dev-Loop AI Agent Reference

This file provides Claude and other AI agents with essential context for working with dev-loop.

## Documentation Discovery

**Start here**: [`docs/INDEX.md`](docs/INDEX.md) - Master index with navigation tables and full documentation structure.

All documentation files include YAML frontmatter for discovery:

```yaml
---
title: Document Title
description: One-line description
category: users|ai|contributing|architecture|troubleshooting|migration
keywords: [searchable, terms]
related: [path/to/related, docs]
---
```

### Quick Reference by Task

| Task | Read This |
|------|-----------|
| Create a PRD | [`docs/ai/PRD_TEMPLATE.md`](docs/ai/PRD_TEMPLATE.md) |
| Validate PRD schema | [`docs/ai/PRD_SCHEMA.md`](docs/ai/PRD_SCHEMA.md) |
| Configure dev-loop | [`docs/users/CONFIG.md`](docs/users/CONFIG.md) |
| Debug JSON parsing | [`docs/troubleshooting/json-parsing.md`](docs/troubleshooting/json-parsing.md) |
| Understand architecture | [`docs/contributing/ARCHITECTURE.md`](docs/contributing/ARCHITECTURE.md) |
| Configure phase hooks | [`docs/users/PHASE_HOOKS.md`](docs/users/PHASE_HOOKS.md) |
| Check metrics | [`docs/users/METRICS.md`](docs/users/METRICS.md) |
| Contribute to dev-loop | [`docs/contributing/README.md`](docs/contributing/README.md) |

## Core Architecture

### Execution Model

Dev-loop uses the **Ralph pattern** - fresh AI context per iteration with persistent learnings:

```
┌─────────────────────────────────────────────┐
│              IterationRunner                │
│  (Entry point - fresh context per loop)     │
├─────────────────────────────────────────────┤
│  1. Load handoff context (from last run)    │
│  2. Fetch next pending task                 │
│  3. Build fresh context                     │
│  4. Generate code via AI                    │
│  5. Validate and apply changes              │
│  6. Run tests                               │
│  7. If fail: analyze, create fix task       │
│  8. Capture learnings                       │
│  9. Save handoff for next iteration         │
│  10. Repeat until all tasks done            │
└─────────────────────────────────────────────┘
```

### Key Components

| Component | Purpose | File |
|-----------|---------|------|
| `IterationRunner` | Main execution loop with Ralph pattern | `src/core/execution/iteration-runner.ts` |
| `PrdSetOrchestrator` | Parallel PRD execution within sets | `src/core/prd/set/orchestrator.ts` |
| `EventMetricBridge` | Automatic metrics from event stream | `src/core/metrics/event-metric-bridge.ts` |
| `PhaseHookExecutor` | Framework lifecycle hooks | `src/core/execution/phase-hook-executor.ts` |
| `CrossPrdCheckpointer` | Shared state across parallel PRDs | `src/core/execution/langgraph/cross-prd-checkpointer.ts` |
| `TaskMasterBridge` | Task management integration | `src/core/execution/task-bridge.ts` |

### LangGraph Workflow

The TDD loop is implemented as LangGraph nodes:

```
fetchTask → buildContext → generateCode → validateCode → applyChanges
                                                              ↓
                                                          runTests
                                                              ↓
                                                    ┌─────────┴─────────┐
                                                    ↓                   ↓
                                               (pass)              (fail)
                                                    ↓                   ↓
                                           captureLearnings     analyzeFailure
                                                    ↓                   ↓
                                                  done            createFixTask
                                                                        ↓
                                                                   (loop back)
```

## State Files

| File | Purpose |
|------|---------|
| `.devloop/checkpoints/*.json` | LangGraph workflow state |
| `.devloop/handoff.md` | Context for fresh iterations |
| `.devloop/progress.md` | Learnings and progress |
| `.devloop/learned-patterns.md` | Discovered patterns |
| `.devloop/metrics.json` | Execution metrics |
| `.devloop/execution-state.json` | PRD coordination state |
| `.taskmaster/tasks/tasks.json` | Task definitions |

## CLI Commands

```bash
# Execute a PRD set (parallel PRDs)
npx dev-loop prd-set execute <path-to-prd-set> [--debug]

# Run single iteration
npx dev-loop run [--debug]

# Initialize configuration
npx dev-loop init

# Archive completed state
npx dev-loop archive --prd-name <name>

# Generate report
npx dev-loop report --prd-set <path>
```

## MCP Tools

Dev-loop exposes MCP tools for AI agent integration:

- `devloop_status` - Get current progress and state
- `devloop_run` - Execute one workflow iteration
- `devloop_list_tasks` - List tasks with filtering
- `devloop_diagnostics` - Get retry counts, blocked tasks, failures
- `devloop_blocked_tasks` - Get list of blocked tasks
- `devloop_metrics_*` - Various metrics tools

## Configuration

Configuration is in `devloop.config.js` at project root. See [`docs/users/CONFIG.md`](docs/users/CONFIG.md) for full reference.

Key sections:
- `ai` - Provider, model, API keys
- `testCommand` - How to run tests
- `validation` - Code validation settings
- `targetModule` - File boundary constraints
- `framework` - Framework-specific settings (Drupal, React, etc.)

## Contribution Mode

When contributing to dev-loop itself (not using it):

1. Check [`docs/contributing/CONTRIBUTION_MODE.md`](docs/contributing/CONTRIBUTION_MODE.md)
2. Source files are in `src/`
3. After TypeScript changes: `npm run build`
4. Run tests: `npm test`

## See Also

- [README.md](README.md) - Main documentation with architecture diagram
- [docs/INDEX.md](docs/INDEX.md) - Full documentation index
- [docs/ai/METADATA.md](docs/ai/METADATA.md) - Frontmatter system reference
