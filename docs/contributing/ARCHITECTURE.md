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

## Key Principles

1. **Framework-agnostic** - Core must work with any framework
2. **Plugin-based** - Framework-specific code in plugins
3. **Test-driven** - All features include tests
4. **Stateful** - Tracks execution state for recovery
5. **Extensible** - Easy to add new providers/plugins

## See Also

- [Development Workflow](DEVELOPMENT_WORKFLOW.md) - How to make changes
- [Testing](TESTING.md) - Testing guidelines
- [Root README](../../README.md) - Project overview
