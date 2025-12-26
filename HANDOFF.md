# dev-loop Implementation Handoff

## Project Overview

**dev-loop** is a TypeScript CLI application with daemon mode that wraps `task-master-ai` to orchestrate the PRD-to-validated-code workflow. It supports multiple AI providers, Playwright + Cypress testing, hybrid log analysis, configurable automation levels, and optional integration with [ai-dev-tasks](https://github.com/snarktank/ai-dev-tasks) prompt templates.

## Current Status

### ✅ Completed

1. **Project Setup**
   - ✅ npm project initialized with TypeScript
   - ✅ Dependencies installed (task-master-ai@0.40.0, commander, inquirer, zod, AI SDKs, etc.)
   - ✅ TypeScript configuration (`tsconfig.json`)
   - ✅ ESLint configuration (`.eslintrc.json`)
   - ✅ Prettier configuration (`.prettierrc`)
   - ✅ `.gitignore` file
   - ✅ Directory structure created

2. **Core Types & Interfaces**
   - ✅ `src/types/index.ts` - All TypeScript types and interfaces
   - ✅ `src/providers/ai/interface.ts` - AIProvider interface
   - ✅ `src/providers/test-runners/interface.ts` - TestRunner interface
   - ✅ `src/providers/log-analyzers/interface.ts` - LogAnalyzer interface

3. **Configuration System**
   - ✅ `src/config/schema.ts` - Zod validation schema
   - ✅ `src/config/defaults.ts` - Default configuration values
   - ✅ `src/config/loader.ts` - Config file loader

4. **Template Manager**
   - ✅ `src/core/template-manager.ts` - Template loading system

### 🚧 In Progress / Next Steps

The following components need to be implemented:

## Implementation Checklist

### Phase 1: Core Components (Priority: High)

- [ ] **State Manager** (`src/core/state-manager.ts`)
  - Local JSON/YAML file persistence
  - Task state management
  - Workflow state tracking

- [ ] **Task Bridge** (`src/core/task-bridge.ts`)
  - Wrapper around task-master-ai
  - Task CRUD operations
  - Task status management

- [ ] **Intervention System** (`src/core/intervention.ts`)
  - Approval gates for review mode
  - Hybrid mode logic
  - Terminal-based approval UI

### Phase 2: AI Providers

- [ ] **AI Provider Factory** (`src/providers/ai/factory.ts`)
  - Provider registration
  - Fallback support

- [ ] **Anthropic Provider** (`src/providers/ai/anthropic.ts`)
  - Claude API integration
  - Code generation
  - Error analysis

- [ ] **OpenAI Provider** (`src/providers/ai/openai.ts`)
  - GPT API integration
  - Code generation
  - Error analysis

- [ ] **Gemini Provider** (`src/providers/ai/gemini.ts`)
  - Google Gemini API integration

- [ ] **Ollama Provider** (`src/providers/ai/ollama.ts`)
  - Local model support

### Phase 3: Test Runners

- [ ] **Playwright Runner** (`src/providers/test-runners/playwright.ts`)
  - Execute Playwright tests
  - Collect artifacts (screenshots, videos)
  - Parse test results

- [ ] **Cypress Runner** (`src/providers/test-runners/cypress.ts`)
  - Execute Cypress tests
  - Collect artifacts

### Phase 4: Log Analyzers

- [ ] **Pattern Matcher** (`src/providers/log-analyzers/pattern-matcher.ts`)
  - Regex-based log analysis
  - Error/warning detection
  - Pattern matching

- [ ] **AI Log Analyzer** (`src/providers/log-analyzers/ai-analyzer.ts`)
  - AI-powered log analysis
  - Root cause identification
  - Recommendations

### Phase 5: Workflow Engine

- [ ] **Workflow Engine** (`src/core/workflow-engine.ts`)
  - State machine implementation
  - Orchestration loop
  - Task execution flow
  - Integration with all providers

### Phase 6: CLI Commands

- [ ] **CLI Entry Point** (`src/index.ts`)
  - Commander.js setup
  - Command registration

- [ ] **Init Command** (`src/cli/commands/init.ts`)
  - Interactive wizard
  - Config file generation
  - Template selection

- [ ] **Run Command** (`src/cli/commands/run.ts`)
  - Single workflow iteration

- [ ] **Watch Command** (`src/cli/commands/watch.ts`)
  - Daemon mode
  - File system monitoring
  - Continuous execution

- [ ] **Status Command** (`src/cli/commands/status.ts`)
  - Current state display
  - Progress tracking

- [ ] **Logs Command** (`src/cli/commands/logs.ts`)
  - Log viewing and analysis

### Phase 7: Templates

- [ ] **Built-in Templates** (`src/templates/builtin/`)
  - `create-prd.md` - Basic PRD template
  - `generate-tasks.md` - Basic task generation template

- [ ] **AI Dev Tasks Templates** (`src/templates/ai-dev-tasks/`)
  - Bundle prompts from [snarktank/ai-dev-tasks](https://github.com/snarktank/ai-dev-tasks)
  - `create-prd.md`
  - `generate-tasks.md`

- [ ] **Template Registry** (`src/templates/index.ts`)
  - Template source management

### Phase 8: CI Output & Distribution

- [ ] **CI Output Formats** (in workflow-engine or separate module)
  - JSON output (`devloop-results.json`)
  - JUnit XML (`devloop-results.xml`)
  - Markdown summary (`devloop-summary.md`)

- [ ] **Dockerfile**
  - Containerized distribution

- [ ] **GitHub Actions CI** (`.github/workflows/ci.yml`)
  - Automated testing
  - Build verification

- [ ] **README.md**
  - Comprehensive documentation
  - Usage examples
  - Configuration guide

## Project Structure

```
dev-loop/
├── package.json              ✅ Complete
├── tsconfig.json             ✅ Complete
├── .eslintrc.json            ✅ Complete
├── .prettierrc               ✅ Complete
├── .gitignore                ✅ Complete
├── src/
│   ├── index.ts              ❌ TODO
│   ├── cli/
│   │   ├── commands/
│   │   │   ├── init.ts       ❌ TODO
│   │   │   ├── run.ts        ❌ TODO
│   │   │   ├── watch.ts      ❌ TODO
│   │   │   └── status.ts     ❌ TODO
│   │   └── prompts.ts        ❌ TODO
│   ├── core/
│   │   ├── workflow-engine.ts    ❌ TODO
│   │   ├── task-bridge.ts        ❌ TODO
│   │   ├── state-manager.ts      ❌ TODO
│   │   ├── template-manager.ts   ✅ Complete
│   │   └── intervention.ts        ❌ TODO
│   ├── providers/
│   │   ├── ai/
│   │   │   ├── interface.ts      ✅ Complete
│   │   │   ├── factory.ts        ❌ TODO
│   │   │   ├── anthropic.ts      ❌ TODO
│   │   │   ├── openai.ts         ❌ TODO
│   │   │   ├── gemini.ts         ❌ TODO
│   │   │   └── ollama.ts         ❌ TODO
│   │   ├── test-runners/
│   │   │   ├── interface.ts      ✅ Complete
│   │   │   ├── playwright.ts     ❌ TODO
│   │   │   └── cypress.ts        ❌ TODO
│   │   └── log-analyzers/
│   │       ├── interface.ts      ✅ Complete
│   │       ├── pattern-matcher.ts  ❌ TODO
│   │       └── ai-analyzer.ts     ❌ TODO
│   ├── templates/
│   │   ├── index.ts              ❌ TODO
│   │   ├── builtin/
│   │   │   ├── create-prd.md     ❌ TODO
│   │   │   └── generate-tasks.md ❌ TODO
│   │   └── ai-dev-tasks/
│   │       ├── create-prd.md     ❌ TODO
│   │       └── generate-tasks.md  ❌ TODO
│   ├── config/
│   │   ├── schema.ts              ✅ Complete
│   │   ├── loader.ts              ✅ Complete
│   │   └── defaults.ts            ✅ Complete
│   └── types/
│       └── index.ts                ✅ Complete
├── templates/
│   └── devloop.config.js          ❌ TODO (template file)
├── tests/                          ❌ TODO
├── Dockerfile                      ❌ TODO
└── README.md                       ❌ TODO
```

## Key Implementation Notes

### 1. Task Master AI Integration

The project wraps `task-master-ai@0.40.0`. The TaskBridge should:
- Use task-master-ai CLI commands via child processes OR
- Import and use task-master-ai programmatically if it exports APIs
- Handle task CRUD operations
- Manage task status transitions

### 2. Workflow Engine State Machine

The workflow engine should implement this state machine:

```
Idle → FetchingTask → ExecutingAI → ApplyingChanges →
  (if review mode: AwaitingApproval) → RunningTests →
  AnalyzingLogs → (if issues: CreatingFixTask) → MarkingDone → FetchingTask (watch mode) or Idle (run mode)
```

### 3. AI Provider Pattern

All AI providers should:
- Implement the `AIProvider` interface
- Support code generation with context
- Support error analysis
- Handle API errors gracefully
- Support fallback to another provider

### 4. Test Runner Pattern

Test runners should:
- Execute tests via child processes
- Parse output for pass/fail status
- Collect artifacts (screenshots, videos, logs)
- Handle timeouts gracefully

### 5. Log Analysis

The hybrid log analyzer should:
- First use pattern matching (fast)
- If patterns match or useAI is true, use AI analysis (slower but more intelligent)
- Combine results from both approaches

### 6. Configuration

The config system uses Zod for validation. Config files can be:
- `devloop.config.js` (JavaScript module)
- `devloop.config.json` (JSON file)

Default config is merged with user config.

### 7. Template System

Templates are loaded from:
- `builtin` - Minimal defaults shipped with dev-loop
- `ai-dev-tasks` - Bundled prompts from snarktank/ai-dev-tasks repo
- `custom` - User-provided templates from customPath

## Dependencies Already Installed

All dependencies from `package.json` are installed:
- `task-master-ai@^0.40.0`
- `commander@^11.1.0`
- `inquirer@^9.2.12`
- `zod@^3.22.4`
- `@anthropic-ai/sdk@^0.20.0`
- `openai@^4.20.0`
- `@google/generative-ai@^0.2.1`
- `chalk@^4.1.2`
- `ora@^5.4.1`
- `chokidar@^3.5.3`
- `fs-extra@^11.1.1`
- `yaml@^2.3.4`

Plus all dev dependencies.

## Testing the Build

Once you implement the CLI entry point, you can test:

```bash
npm run build
npm start -- --help
```

## Reference Documents

- **Plan File**: See the plan file in `.cursor/plans/` directory
- **Original Workflow**: `../sysf/docs/workflow.md` - Describes the workflow this tool automates
- **AI Dev Tasks**: https://github.com/snarktank/ai-dev-tasks - Source for prompt templates

## Next Immediate Steps

1. **Start with State Manager** - Needed by workflow engine
2. **Implement Task Bridge** - Core integration with task-master-ai
3. **Create CLI Entry Point** - So you can test as you build
4. **Implement one AI Provider** (Anthropic) - To test the pattern
5. **Build Workflow Engine** - Core orchestration logic
6. **Add remaining providers and runners** - Complete the feature set

## Important Considerations

- **Node Version**: Project requires Node.js >= 20.0.0 (current system has v18.17.1, but dependencies installed)
- **Error Handling**: All async operations should have proper error handling
- **Logging**: Use `console.log` with `chalk` for colored output, `ora` for spinners
- **File Paths**: Use `path.join()` and handle both relative and absolute paths
- **Type Safety**: Leverage TypeScript strictly - avoid `any` types

## Questions to Resolve

1. How does `task-master-ai` expose its API? (CLI only or programmatic?)
2. Should we support both `.js` and `.json` config files? (Currently supports both)
3. How to handle template updates from ai-dev-tasks? (Manual bundle or git submodule?)

---

**Status**: Foundation complete, ready for core implementation
**Last Updated**: 2025-12-26
**Next Session**: Continue with State Manager and Task Bridge

