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
│   ├── core/             # Core business logic (organized into subdirectories)
│   │   ├── metrics/      # Metrics tracking system (8 files)
│   │   ├── analysis/     # Code and error analysis
│   │   │   ├── error/    # Error analysis (unified analyzer, failure-analyzer, root-cause-analyzer)
│   │   │   ├── code/     # Code intelligence (context-provider, quality-scanner, abstraction-detector, etc.)
│   │   │   └── pattern/  # Pattern learning and detection
│   │   ├── testing/      # Test execution and management (6 files)
│   │   ├── validation/   # Validation gates and scripts (6 files)
│   │   ├── generation/   # Code generation (drupal-implementation-generator, autonomous-task-generator, etc.)
│   │   ├── execution/    # Workflow and task execution (workflow.ts, task-bridge.ts, intervention.ts, etc.)
│   │   ├── reporting/    # Report generation (unified generator)
│   │   ├── tracking/     # Progress and observation tracking (6 files)
│   │   ├── prd/          # PRD parsing and management
│   │   │   ├── parser/   # PRD parsing (4 files)
│   │   │   ├── set/      # PRD set management (7 files: discovery, validator, orchestrator, generator, etc.)
│   │   │   ├── coordination/  # PRD coordination and context (2 files)
│   │   │   └── validation/    # Cross-PRD validation (1 file)
│   │   ├── monitoring/   # Proactive monitoring and intervention (5 files)
│   │   │   ├── event-monitor.ts       # EventMonitorService - continuous event polling
│   │   │   ├── issue-classifier.ts    # IssueClassifier - event classification
│   │   │   ├── action-executor.ts     # ActionExecutor - fix execution
│   │   │   └── action-strategies.ts   # Action strategies for each issue type
│   │   ├── config/       # Configuration management
│   │   │   └── merger.ts # Hierarchical config merger (schema consistency)
│   │   └── utils/        # Shared utilities (logger, state-manager, dependency-graph, event-stream, etc.)
│   ├── config/           # Configuration loading and schema
│   │   ├── schema/       # Modular schema structure (8 files: base, core, framework, prd, overlays, phase, validation, index)
│   │   ├── schema.ts     # Backward-compatible re-export wrapper
│   │   ├── loader.ts     # Config file loading
│   │   └── defaults.ts   # Default configuration
│   ├── frameworks/       # Framework plugins (Drupal, Django, React)
│   ├── mcp/              # MCP server implementation
│   │   └── tools/        # MCP tool registrations
│   ├── providers/        # AI, test runner, log analyzer providers
│   └── templates/        # Code generation templates
├── docs/
│   ├── ai/               # AI agent documentation (PRD creation)
│   ├── users/            # User documentation
│   └── contributing/     # Contribution documentation (this directory)
└── dist/                 # Compiled JavaScript (generated)
```

**Schema Modular Structure**: The configuration schema has been refactored into a modular structure:
- `src/config/schema/` contains 8 organized files handling different aspects of configuration
- `src/config/schema.ts` is a backward-compatible re-export wrapper
- See [Schema Modular Refactoring Handoff](../handoff-schema-modular-refactoring.md) for details

## Core Components

### WorkflowEngine

**Location:** `src/core/execution/workflow.ts`

Main orchestration loop that manages the test-driven development cycle:
- Fetches tasks from Task Master
- Executes AI code generation
- Applies code changes
- Runs tests
- Analyzes logs
- Creates fix tasks on failure

### TaskMasterBridge

**Location:** `src/core/execution/task-bridge.ts`

Wrapper around task-master-ai MCP for task management:
- Fetch pending tasks
- Update task status
- Get task details

### StateManager

**Location:** `src/core/utils/state-manager.ts`

Manages workflow state persistence:
- Saves state to `.devloop/` directory
- Handles state recovery on restart
- Tracks execution history

### CodeContextProvider

**Location:** `src/core/analysis/code/context-provider.ts`

Extracts code context for AI prompts:
- File signatures
- Import statements
- Error context
- Related files

### ValidationGate

**Location:** `src/core/validation/gate.ts`

Pre-apply validation:
- Syntax checking
- Basic error detection
- Change validation

### EventMonitorService

**Location:** `src/core/monitoring/event-monitor.ts`

Proactive event monitoring service:
- Continuous event polling
- Threshold-based intervention triggering
- Automated fix execution
- Intervention effectiveness monitoring

See "Monitoring & Intervention System" section above for details.

### IssueClassifier

**Location:** `src/core/monitoring/issue-classifier.ts`

Event classification system:
- Maps event types to issue categories
- Determines confidence levels
- Identifies patterns and failure reasons

See "Monitoring & Intervention System" section above for details.

### ActionExecutor

**Location:** `src/core/monitoring/action-executor.ts`

Automated intervention execution:
- Executes fix strategies
- Validates intervention effectiveness
- Supports rollback on regression

See "Monitoring & Intervention System" section above for details.

### InterventionMetricsTracker

**Location:** `src/core/metrics/intervention-metrics.ts`

Intervention metrics tracking:
- Tracks all interventions and outcomes
- Measures success rate and effectiveness
- Identifies improvement opportunities

See "Monitoring & Intervention System" section above for details.

### PatternLearningSystem

**Location:** `src/core/analysis/pattern/learner.ts`

Learns from successful and failed task executions:
- Extracts patterns
- Stores in `.devloop/patterns.json`
- Injects guidance into AI prompts

### ParallelMetrics

**Location:** `src/core/metrics/parallel.ts`

Tracks concurrent agent execution and coordination:
- Records agent start/completion times
- Tracks concurrency levels (max, average)
- Calculates parallel efficiency (vs sequential execution)
- Measures agent overlap time and coordination statistics
- Stores metrics in `.devloop/parallel-metrics.json`

### ProgressTracker

**Location:** `src/core/tracking/progress-tracker.ts`

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

**Location:** `src/core/reporting/generator.ts`

Generates comprehensive execution reports:
- Parallel execution analysis
- Session management metrics
- Agent breakdown tables
- Parallel efficiency calculations
- Token usage and cost estimation

### PRD Set Orchestration

**Location:** `src/core/prd/set/orchestrator.ts`

Orchestrates PRD set execution with parallel processing:
- Discovers PRD sets from `index.md.yml` files
- Validates PRD sets at multiple levels (set, PRD, phase)
- Executes PRDs in parallel when independent
- Manages hierarchical configuration overlays
- Tracks PRD set-level metrics and progress

### Hierarchical Config Merger

**Location:** `src/config/merger.ts`

Merges configuration overlays in hierarchical order:
- Project Config → Framework Config → PRD Set Config → PRD Config → Phase Config
- Deep merge for nested objects
- Special handling for arrays (concatenation vs replacement)
- Integrated with PRD set orchestration

### Schema System

**Location:** `src/config/schema/` (modular structure)

Configuration schema organized into 8 files:
- `base.ts` - Common schema fragments (logSourceSchema)
- `core.ts` - Core configuration schema (configSchema)
- `framework.ts` - Framework configuration schema
- `prd.ts` - PRD-related schemas (factory function)
- `overlays.ts` - Configuration overlay schemas using `.partial().passthrough()` pattern
- `phase.ts` - Phase definition schema
- `validation.ts` - Validation functions
- `index.ts` - Main entry point (re-exports everything)

Backward compatibility maintained via `src/config/schema.ts` re-export wrapper.

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
  - `events.ts` - Event streaming tools
  - `observations.ts` - Observation tools
  - `metrics.ts` - Metrics tools
  - `contribution-mode.ts` - Contribution mode status and validation tools
  - `event-monitoring.ts` - Proactive event monitoring tools (start, stop, status, configure, interventions)
  - `observation-enhanced.ts` - Enhanced observation tools (pattern detection, session analysis, context gap detection, dependency graph)
  - `playwright-tdd.ts` - Playwright TDD workflow tools
  - `codebase-query.ts` - Codebase query tools
  - `cursor-ai.ts` - Cursor AI integration tools
  - `cursor-chat.ts` - Cursor chat integration tools
  - `background-agent.ts` - Background agent tools

## Monitoring & Intervention System

**Location:** `src/core/monitoring/`

Proactive event monitoring and automated intervention system that continuously monitors events and applies corrective actions when thresholds are exceeded.

### EventMonitorService

**Location:** `src/core/monitoring/event-monitor.ts`

Continuously monitors event stream and triggers automated corrective actions:
- Polls events every N seconds (configurable, default: 5 seconds)
- Checks event counts/rates against configured thresholds
- Classifies issues and determines confidence levels
- Triggers interventions automatically (if confidence is high) or requests approval
- Monitors intervention effectiveness and rolls back if regressions occur
- Rate limiting (max interventions per hour)
- Lifecycle management (start/stop)

**Key Methods:**
- `start()` - Start monitoring service
- `stop()` - Stop monitoring service
- `getStatus()` - Get monitoring status and statistics
- `updateConfig()` - Update configuration at runtime
- `pollEvents()` - Poll events and check thresholds (private)

### IssueClassifier

**Location:** `src/core/monitoring/issue-classifier.ts`

Classifies event types into actionable categories and determines confidence levels:
- Maps event types to classification strategies
- Extracts patterns from event history
- Determines confidence levels (0-1) for automated action
- Categorizes issues (json-parsing, task-execution, boundary-enforcement, validation, contribution-mode, ipc, agent, health)
- Identifies most common failure reasons and patterns

**Classification Strategies:**
- JSON parsing issues - Analyzes failure reasons, retry patterns, AI fallback usage
- Task execution issues - Detects blocked/failed tasks, extracts failure reasons, identifies retry patterns
- Boundary enforcement issues - Detects violations vs excessive filtering, identifies module confusion
- Validation issues - Extracts error categories, identifies recovery patterns
- Contribution mode issues - Handles module confusion, session pollution, boundary violations, context loss
- IPC connection issues - Detects connection failures, retry patterns, consistency
- Agent errors - Lower confidence for complex agent errors
- Health check issues - Low confidence, requires investigation

### ActionExecutor

**Location:** `src/core/monitoring/action-executor.ts`

Executes corrective actions based on issue classifications:
- Loads action strategies lazily (on first use)
- Maps issue types to specific fix strategies
- Executes strategies and validates fixes
- Monitors fix effectiveness via subsequent events
- Supports rollback if fixes cause regressions
- Tracks intervention results for metrics

**Key Methods:**
- `execute()` - Execute intervention for an issue
- `monitorEffectiveness()` - Monitor intervention effectiveness (async, non-blocking)
- `loadActionStrategies()` - Load action strategies (lazy initialization)

### Action Strategies

**Location:** `src/core/monitoring/action-strategies.ts`

Specific fix strategies for each issue type. Each strategy implements the `ActionStrategy` interface:

- **JsonParsingStrategy** (`enhance-json-parser`) - Enhances JSON parser with better extraction logic, adds control character sanitization, newline escaping
- **TaskBlockingStrategy** (`unblock-task`) - Unblocks tasks with enhanced context, resets retry count, clears errors
- **BoundaryViolationStrategy** (`enhance-boundary-enforcement`) - Enhances boundary enforcement, adds early file filtering before validation
- **ValidationFailureStrategy** (`enhance-validation-gates`) - Improves validation gates, adds recovery suggestions
- **ContributionModeStrategy** (`fix-contribution-mode-issue`) - Delegates to specific fixes based on issue type (module confusion, session pollution, boundary violations, context loss)
- **IPCConnectionStrategy** (`enhance-ipc-connection`) - Adds retry logic with exponential backoff

**Strategy Pattern:**
- Each strategy has `name`, `issueType`, and `execute()` method
- Strategies can modify code files (with backup creation)
- Strategies can update state files (retry counts, session data)
- Strategies emit events for tracking and validation
- Strategies return success/failure status and rollback requirements

### InterventionMetricsTracker

**Location:** `src/core/metrics/intervention-metrics.ts`

Tracks all automated interventions and their outcomes:
- Records intervention history with full details
- Tracks success rate by issue type and event type
- Identifies patterns in intervention effectiveness
- Timing metrics (detection, fix, validation time)
- Threshold tracking (exceeded count, prevented count, false positives)
- Effectiveness analysis (most/least effective strategies, common failure modes)

**Key Methods:**
- `recordIntervention()` - Track a new intervention
- `recordThresholdExceeded()` - Record threshold exceeded
- `recordIssuePrevented()` - Record issue prevented
- `recordFalsePositive()` - Record false positive intervention
- `getMetrics()` - Get current metrics
- `getRecords()` - Get intervention records (with filters)
- `getIssueTypeMetrics()` - Get metrics for specific issue type
- `getEffectivenessAnalysis()` - Get effectiveness analysis
- `analyzePatterns()` - Analyze intervention patterns (runs periodically)

### Integration Points

The monitoring system integrates with:
- **Event Stream** (`src/core/utils/event-stream.ts`) - Polls events, emits intervention events
- **Config System** (`src/config/schema/core.ts`) - Reads monitoring configuration
- **Metrics System** (`src/core/metrics/intervention-metrics.ts`) - Tracks intervention metrics
- **Contribution Mode** (`src/cli/commands/contribution.ts`) - Starts/stops monitoring on contribution mode lifecycle
- **MCP Tools** (`src/mcp/tools/event-monitoring.ts`) - Exposes monitoring control via MCP

### Configuration

Monitoring configuration is defined in `devloop.config.js`:

```javascript
module.exports = {
  mcp: {
    eventMonitoring: {
      enabled: true,
      pollingInterval: 5000,
      thresholds: { /* event type → threshold config */ },
      actions: { /* action settings */ },
      metrics: { /* metrics tracking settings */ }
    }
  }
};
```

See [Proactive Monitoring Guide](./PROACTIVE_MONITORING.md) for detailed configuration reference.

## Configuration

**Location:** `src/config/`

- **schema/** - Modular schema structure (8 files):
  - `base.ts` - Common schema fragments
  - `core.ts` - Core configuration schema
  - `framework.ts` - Framework configuration schema
  - `prd.ts` - PRD-related schemas (factory function)
  - `overlays.ts` - Configuration overlay schemas (factory function using `.partial().passthrough()`)
  - `phase.ts` - Phase definition schema
  - `validation.ts` - Validation functions
  - `index.ts` - Main entry point (re-exports)
- **schema.ts** - Backward-compatible re-export wrapper (for existing imports)
- **loader.ts** - Config file loading
- **defaults.ts** - Default configuration

**Hierarchical Configuration System**: Config overlays are merged at multiple levels (Project → Framework → PRD Set → PRD → Phase) using `src/config/merger.ts`. See [Schema Modular Refactoring](../handoff-schema-modular-refactoring.md) for details.

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

**Location:** `src/core/execution/workflow.ts` - `runOnce()` method and `groupTasksByDependencyLevel()`

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

**Location:** `src/core/analysis/code/context-provider.ts` and `src/core/execution/workflow.ts` - `getCodebaseContext()`

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

## PRD Set Architecture

Dev-loop supports executing multiple PRDs together as a PRD set, with hierarchical configuration overlays and parallel execution capabilities.

### PRD Set Discovery

**Location:** `src/core/prd/set/discovery.ts`

Discovers PRD sets from `index.md.yml` files or directory scanning:
- Reads PRD set manifest from `index.md.yml`
- Validates PRD set structure
- Resolves PRD paths relative to the PRD set directory

### PRD Set Validation

**Location:** `src/core/prd/set/validator.ts`

Validates PRD sets at multiple levels:
- Set-level validation (manifest structure, PRD references)
- PRD-level validation (individual PRD schemas)
- Phase-level validation (phase definitions and config overlays)

### PRD Set Orchestration

**Location:** `src/core/prd/set/orchestrator.ts`

Orchestrates PRD set execution:
- Parallel execution of independent PRDs (up to `maxConcurrent` limit)
- Dependency-aware execution ordering
- Hierarchical configuration overlay merging
- Progress tracking and error handling at PRD set level

### Hierarchical Configuration Merging

**Location:** `src/config/merger.ts`

Merges configuration overlays in the following order:
1. Project Config (base)
2. Framework Config
3. PRD Set Config (from `index.md.yml`)
4. PRD Config (from PRD frontmatter)
5. Phase Config (from phase definitions)

Later levels override earlier levels. Deep merge for nested objects. Special handling for arrays that should be concatenated vs replaced.

**Schema Support:** Configuration overlay schemas are defined in `src/config/schema/overlays.ts` using `.partial().passthrough()` pattern to derive from base config schema.

## Schema Consistency System

The configuration schema system has been refactored into a modular structure for better maintainability and reduced duplication.

### Modular Schema Structure

**Location:** `src/config/schema/` (8 files)

- **base.ts** - Common schema fragments used across multiple files (e.g., `logSourceSchema`)
- **core.ts** - Main configuration schema (`configSchema`) and `Config` type
- **framework.ts** - Framework-specific configuration schema
- **prd.ts** - PRD-related schemas (factory function to handle circular dependencies)
- **overlays.ts** - Configuration overlay schemas (factory function using `.partial().passthrough()`)
- **phase.ts** - Phase definition schema
- **validation.ts** - Validation functions (`validateConfig`, `validateConfigOverlay`)
- **index.ts** - Main entry point that re-exports everything

### Circular Dependency Resolution

The schema system uses factory functions and lazy initialization to handle circular dependencies:
- `configSchema` (core.ts) → needs `prdSchema` (prd.ts)
- `prdSchema` (prd.ts) → needs `configOverlaySchema` (overlays.ts)
- `configOverlaySchema` (overlays.ts) → needs `configSchema` (core.ts)

**Solution:** Factory functions with `z.lazy()` for circular references. Initialization order in `core.ts` is important.

### Backward Compatibility

The old `schema.ts` file has been converted to a re-export wrapper:
```typescript
export * from './schema/index';
```

All existing imports from `'../config/schema'` continue to work without modification.

See [Schema Modular Refactoring Handoff](../handoff-schema-modular-refactoring.md) for complete details.

## Key Principles

1. **Framework-agnostic** - Core must work with any framework
2. **Plugin-based** - Framework-specific code in plugins
3. **Test-driven** - All features include tests
4. **Stateful** - Tracks execution state for recovery
5. **Extensible** - Easy to add new providers/plugins
6. **Provider-agnostic** - Unified interfaces for all AI providers
7. **Parallel-first** - Designed for concurrent execution
8. **Modular organization** - Clear separation of concerns with logical directory structure

## See Also

- [Development Workflow](DEVELOPMENT_WORKFLOW.md) - How to make changes
- [Testing](TESTING.md) - Testing guidelines
- [Root README](../../README.md) - Project overview
