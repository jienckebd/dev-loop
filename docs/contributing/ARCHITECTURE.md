---
title: "Dev-Loop Architecture"
type: "reference"
category: "contributing"
audience: "both"
keywords: ["architecture", "codebase", "structure", "components", "plugins", "framework"]
related_docs:
  - "README.md"
  - "DEVELOPMENT_WORKFLOW.md"
prerequisites: []
estimated_read_time: 30
contribution_mode: true
---

# Dev-Loop Architecture

Overview of dev-loop's codebase structure and core components.

## Directory Structure

```
dev-loop/
├── src/
│   ├── cli/              # CLI commands
│   │   └── commands/     # Individual command implementations
│   ├── core/             # Core business logic
│   ├── frameworks/       # Framework plugins (Drupal, Django, React)
│   ├── mcp/              # MCP server implementation
│   │   └── tools/        # MCP tool registrations
│   ├── providers/        # AI, test runner, log analyzer providers
│   ├── templates/        # Code generation templates
│   └── config/           # Configuration loading and schema
├── docs/
│   ├── ai/               # AI agent documentation (PRD creation)
│   ├── users/            # User documentation
│   └── contributing/     # Contribution documentation (this directory)
└── dist/                 # Compiled JavaScript (generated)
```

## Core Components

### WorkflowEngine

**Location:** `src/core/workflow-engine.ts`

Main orchestration loop that manages the test-driven development cycle:
- Fetches tasks from Task Master
- Executes AI code generation
- Applies code changes
- Runs tests
- Analyzes logs
- Creates fix tasks on failure

### TaskMasterBridge

**Location:** `src/core/task-bridge.ts`

Wrapper around task-master-ai MCP for task management:
- Fetch pending tasks
- Update task status
- Get task details

### StateManager

**Location:** `src/core/state-manager.ts`

Manages workflow state persistence:
- Saves state to `.devloop/` directory
- Handles state recovery on restart
- Tracks execution history

### CodeContextProvider

**Location:** `src/core/code-context-provider.ts`

Extracts code context for AI prompts:
- File signatures
- Import statements
- Error context
- Related files

### ValidationGate

**Location:** `src/core/validation-gate.ts`

Pre-apply validation:
- Syntax checking
- Basic error detection
- Change validation

### PatternLearningSystem

**Location:** `src/core/pattern-learner.ts`

Learns from successful and failed task executions:
- Extracts patterns
- Stores in `.devloop/patterns.json`
- Injects guidance into AI prompts

### ParallelMetrics

**Location:** `src/core/parallel-metrics.ts`

Tracks concurrent agent execution and coordination:
- Records agent start/completion times
- Tracks concurrency levels (max, average)
- Calculates parallel efficiency (vs sequential execution)
- Measures agent overlap time and coordination statistics
- Stores metrics in `.devloop/parallel-metrics.json`

### ProgressTracker

**Location:** `src/core/progress-tracker.ts`

Provides real-time progress updates during execution:
- Event-driven progress tracking
- Task-level and overall progress reporting
- Emits progress events for UI integration
- Tracks task start/completion/failure states

### SessionBoundaryManager

**Location:** `src/providers/ai/session-boundary-manager.ts`

Enforces session and context boundary rules for all execution scenarios:
- Parallel task session isolation
- Fix task session reuse
- Cross-PRD dependency handling
- PRD set execution boundaries
- Context snapshotting enforcement

### BaseSessionManager

**Location:** `src/providers/ai/session-manager.ts`

Provider-agnostic base class for session management:
- Unified session interface for all AI providers
- History management and pruning
- Session lifecycle management
- Context continuity across tasks

### ContextBuilder

**Location:** `src/providers/ai/context-builder.ts`

Unified context building for all AI providers:
- Combines codebase context, task details, and session history
- Consistent context format across providers
- Session history integration
- File-specific and pattern guidance inclusion

### AgentInterface

**Location:** `src/providers/ai/agent-interface.ts`

Model-agnostic interface for AI agent interactions:
- Abstract provider-specific differences
- Unified code generation interface
- Consistent error handling
- Provider-agnostic session management

### TimeoutHandler

**Location:** `src/providers/ai/timeout-handler.ts`

Provider-agnostic timeout handling:
- Configurable timeouts per provider
- Progressive timeout extension on activity
- Heartbeat monitoring
- Timeout error handling

### ReportGenerator

**Location:** `src/core/report-generator.ts`

Generates comprehensive execution reports:
- Parallel execution analysis
- Session management metrics
- Agent breakdown tables
- Parallel efficiency calculations
- Token usage and cost estimation

## Framework Plugins

**Location:** `src/frameworks/`

Plugins provide framework-specific behavior:
- **Drupal** - Drupal 10/11 with DDEV
- **Django** - Django 5+ with Docker/DRF
- **React** - React + TypeScript + Vite
- **Generic** - Fallback for any project
- **Composite** - Multi-framework projects

Each plugin implements `FrameworkPlugin` interface with:
- Detection logic
- Templates
- Error patterns
- File discovery rules

## Provider System

**Location:** `src/providers/`

### AI Providers

- **Anthropic** - Claude API
- **OpenAI** - GPT API
- **Gemini** - Google Gemini API
- **Ollama** - Local models

### Test Runners

- **Playwright** - Browser automation
- **Cypress** - E2E testing

### Log Analyzers

- **PatternMatcher** - Regex-based analysis
- **AILogAnalyzer** - AI-powered analysis

## MCP Integration

**Location:** `src/mcp/`

MCP (Model Context Protocol) server for AI assistant integration:

- **server.ts** - Main MCP server entry point
- **tools/** - Tool registrations:
  - `core.ts` - Core workflow tools
  - `debug.ts` - Debugging tools
  - `control.ts` - Control tools
  - `contribution.ts` - Contribution mode tools

## Configuration

**Location:** `src/config/`

- **schema.ts** - Zod schema for config validation
- **loader.ts** - Config file loading
- **defaults.ts** - Default configuration

## Contribution Mode

When in contribution mode, you (outer agent) can edit:
- `node_modules/dev-loop/src/` - Core code
- `.taskmaster/` - Tasks and PRDs
- `devloop.config.js` - Project config

Inner agent (dev-loop) edits:
- Project code (e.g., `docroot/`, `tests/`)

Boundaries are enforced via `.cursorrules` or project rules.

## Parallel Execution System

Dev-loop implements true parallel execution using dependency level grouping:

### Dependency Level Grouping

Tasks are grouped by dependency level using topological sorting:
- Tasks with no dependencies execute first
- Tasks dependent on completed tasks execute next
- Multiple tasks at the same level execute concurrently
- Maximum concurrency is controlled by `autonomous.maxConcurrency` config

**Location:** `src/core/workflow-engine.ts` - `runOnce()` method and `groupTasksByDependencyLevel()`

### Concurrency Control

- Tasks within a dependency level are executed in parallel (up to `maxConcurrency`)
- Remaining tasks in a level are queued for the next iteration
- Parallel execution is tracked by `ParallelMetrics`
- Each parallel task gets isolated context snapshot

### Coordination Statistics

ParallelMetrics tracks:
- Maximum concurrent agents
- Average concurrency over time
- Agent overlap time (time agents run simultaneously)
- Sequential time (gaps between agent executions)
- Total agent run time
- Parallel efficiency percentage

## Session Management System

Dev-loop uses a provider-agnostic session management system for context persistence:

### Provider-Agnostic Design

- **BaseSessionManager** - Abstract base class with common functionality
- **CursorSessionManager** - Cursor-specific implementation
- Future providers can implement their own session managers

### Session Boundary Specifications

Session boundaries are explicitly defined for all execution scenarios:

1. **Parallel Tasks** - Separate sessions with optional shared base context
   - Each task gets isolated session: `{prdId}-{phaseId}-{taskId}`
   - Context is snapshotted at task start to prevent race conditions

2. **Fix Tasks** - Reuse original task's session
   - Fix attempts are appended to session history
   - History is pruned after max retries

3. **Cross-PRD Dependencies** - Isolated sessions with selective context injection
   - Each PRD has isolated session: `{prdSetId}-{prdId}`
   - Only completed PRDs' context is injected

4. **Context Snapshotting** - Module-scoped file system state snapshot
   - Snapshot taken at task start
   - Only includes files that existed at snapshot time
   - Prevents seeing files created by parallel tasks

### Session Lifecycle

- Sessions are created on first task execution
- Persist until PRD/phase completion or max age exceeded
- History is pruned based on `maxHistoryItems` config
- Session statistics are tracked (calls, errors, JSON parsing failures)

**Location:** `src/providers/ai/session-manager.ts` and `src/providers/ai/cursor-session-manager.ts`

## Context Discovery System

Enhanced context discovery with PRD/phase scoping and relevance ranking:

### PRD/Phase Scoping

Context discovery is scoped to the target module based on PRD/phase context:
- Files from target module get higher relevance scores
- Files from other modules are excluded or deprioritized
- Module name is extracted from PRD ID (e.g., "PERF-PHASE-1" → "bd_perf")

### Relevance Ranking

Files are ranked by relevance:
- Target module files get highest priority
- Semantic similarity to task description
- Import relationships
- Recent modification time

### Context Snapshotting

Context is snapshotted at task start for parallel execution:
- Prevents race conditions from seeing files created by parallel tasks
- Module-scoped (only files in `docroot/modules/share/{module}/`)
- Live updates are disabled during parallel execution

**Location:** `src/core/code-context-provider.ts` and `src/core/workflow-engine.ts` - `getCodebaseContext()`

## AI Provider Reliability

Dev-loop includes comprehensive reliability features for AI provider interactions:

### Timeout Handling

Provider-agnostic timeout handler:
- Configurable timeouts per provider
- Progressive timeout extension on activity
- Heartbeat monitoring to detect idle processes
- Default timeout: 5 minutes (configurable via `config.cursor.agents.backgroundAgentTimeout`)

**Location:** `src/providers/ai/timeout-handler.ts`

### Retry Logic

Automatic retry mechanism for failed AI calls:
- 3 attempts by default (initial attempt + 2 retries)
- Strict JSON prompts on retry to improve success rate
- Enhanced JSON extraction for various response formats
- "Already complete" response detection

**Location:** `src/providers/ai/cursor.ts` - `generateCode()` method

### Enhanced JSON Parsing

Robust JSON extraction from AI responses:
- Handles raw JSON, JSON code blocks, and triple-escaped JSON
- Detects "already complete" responses without explicit CodeChanges
- Strips prefixes like "Here is the JSON:"
- Detailed error logging with context snippets

**Location:** `src/providers/ai/cursor-json-parser.ts` (shared utility)

## Key Principles

1. **Framework-agnostic** - Core must work with any framework
2. **Plugin-based** - Framework-specific code in plugins
3. **Test-driven** - All features include tests
4. **Stateful** - Tracks execution state for recovery
5. **Extensible** - Easy to add new providers/plugins
6. **Provider-agnostic** - Unified interfaces for all AI providers
7. **Parallel-first** - Designed for concurrent execution

## See Also

- [Development Workflow](DEVELOPMENT_WORKFLOW.md) - How to make changes
- [Testing](TESTING.md) - Testing guidelines
- [Root README](../../README.md) - Project overview
