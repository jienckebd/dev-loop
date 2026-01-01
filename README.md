# dev-loop

Autonomous development orchestrator that transforms PRDs into validated code through a continuous loop of AI code generation, test execution, and log analysis.

## Documentation

**For Users:** See [`docs/users/README.md`](docs/users/README.md) - Complete user documentation, CLI reference, and configuration guide.

**For AI Agents:** See [`docs/ai/README.md`](docs/ai/README.md) - AI agent onboarding guide for creating PRDs and leveraging dev-loop features.

**Quick Lookup:** See [`docs/ai/INDEX.md`](docs/ai/INDEX.md) - Documentation index with task → doc mappings, feature guides, and problem solutions.

**PRD Documentation:**
- [`docs/ai/PRD_SCHEMA.md`](docs/ai/PRD_SCHEMA.md) - Complete schema reference with validation rules
- [`docs/ai/PRD_FEATURES.md`](docs/ai/PRD_FEATURES.md) - Comprehensive guide to all 17 dev-loop features
- [`docs/ai/PRD_TEMPLATE.md`](docs/ai/PRD_TEMPLATE.md) - Copy-paste PRD template with all optional sections

### Documentation Discovery

All documentation files include YAML frontmatter metadata for discoverability. AI agents can:

1. **Index-Based Discovery**: Use [`docs/ai/INDEX.md`](docs/ai/INDEX.md) to find docs by task, feature, or problem
2. **Metadata Filtering**: Filter by `type` (reference, guide, template), `category` (prd, features), or `audience` (ai, user, both)
3. **Keyword Matching**: Match task keywords to document keywords for relevant content
4. **Workflow Guidance**: Follow recommended documentation sequences for common workflows

**Metadata Fields:**
- `type` - reference | guide | tutorial | template | index
- `category` - prd | cli | architecture | features
- `audience` - ai | user | both
- `keywords` - Searchable keywords array
- `related_docs` - Links to related documentation
- `prerequisites` - Prerequisite docs to load first
- `estimated_read_time` - Minutes to read

**Discovery Examples:**
- **Creating PRD**: Start with `PRD_TEMPLATE.md` (template), validate with `PRD_SCHEMA.md` (reference)
- **Configuring features**: Load `PRD_FEATURES.md` (guide, category: features)
- **Validation errors**: Check `PRD_SCHEMA.md` (reference, keywords: validation)

## Core Concept

Dev-loop implements a **test-driven development loop**:

```mermaid
flowchart LR
    PRD[PRD] --> Tasks[Task Master]
    Tasks --> AI[AI Provider]
    AI --> Code[Code Changes]
    Code --> Tests[Test Runner]
    Tests --> Logs[Log Analyzer]
    Logs -->|Pass| Done[Mark Done]
    Logs -->|Fail| Fix[Create Fix Task]
    Fix --> AI
    Done --> Tasks
```

**Key principle**: Every task bundles feature code + test code. The loop continues until all tests pass.

## Two Operating Modes

### Non-Evolution Mode (Default)

You implement tasks directly. Dev-loop provides task management and diagnostics.

```mermaid
flowchart TB
    You[Cursor Agent] -->|"Query tasks"| TM[Task Master MCP]
    You -->|"Edit code"| Code[Project Codebase]
    You -->|"Update status"| TM
    TM --> Tasks[(tasks.json)]
```

### Evolution Mode

Two-agent architecture for autonomous development:

```mermaid
flowchart TB
    subgraph outer["Outer Agent (You)"]
        Orchestrate[Orchestrate & Enhance]
    end
    subgraph inner["Inner Agent (Dev-Loop)"]
        Implement[Implement & Test]
    end
    
    Orchestrate -->|"Start/monitor"| DL[Dev-Loop MCP]
    Orchestrate -->|"Create tasks"| TM[Task Master MCP]
    DL -->|"Spawn"| Implement
    Implement -->|"Edit"| Code[Project Code]
    Orchestrate -.->|"If stuck"| DevLoopSrc[packages/dev-loop/]
    
    TM --> Tasks[(tasks.json)]
    DL --> State[(.devloop/)]
```

| Aspect | Non-Evolution | Evolution |
|--------|--------------|-----------|
| Who implements | You | Inner agent |
| Your role | Direct coding | Orchestration |
| Code you edit | All files | Only `packages/dev-loop/` |

## Quick Start

```bash
# Prerequisites: Node.js 20+, AI API key

# Install
npm install -g dev-loop

# Setup
echo "ANTHROPIC_API_KEY=your_key" > .env
dev-loop init
task-master init

# Run
task-master parse-prd --input=prd.md   # Create tasks from PRD
dev-loop run                            # Execute one iteration
dev-loop watch                          # Continuous mode
```

## Configuration

Create `devloop.config.js`:

```javascript
module.exports = {
  ai: {
    provider: 'anthropic',              // 'anthropic' | 'openai' | 'gemini' | 'ollama'
    model: 'claude-sonnet-4-20250514',
    fallback: 'openai:gpt-4o',
  },
  testing: {
    runner: 'playwright',               // 'playwright' | 'cypress'
    command: 'npm test',
    timeout: 300000,
  },
  intervention: {
    mode: 'autonomous',                 // 'autonomous' | 'review' | 'hybrid'
  },
  taskMaster: {
    tasksPath: '.taskmaster/tasks/tasks.json',
  },
  debug: false,
  metrics: { enabled: true, path: '.devloop/metrics.json' },
  patternLearning: { enabled: true, patternsPath: '.devloop/patterns.json' },
};
```

## CLI Reference

### Core Commands

| Command | Description |
|---------|-------------|
| `dev-loop init` | Initialize project |
| `dev-loop run [--task ID] [--debug]` | Execute one iteration |
| `dev-loop watch [--debug]` | Continuous execution |
| `dev-loop status` | Current progress |
| `dev-loop pause` / `resume` | Control execution |

### Task Commands

| Command | Description |
|---------|-------------|
| `dev-loop list [--pending\|--done]` | List tasks |
| `dev-loop show <id>` | Task details |
| `dev-loop reset <id>` | Reset to pending |
| `task-master parse-prd --input=<file>` | Create tasks from PRD |
| `task-master add-task --prompt="..."` | Add single task |
| `task-master set-status --id=<id> --status=done` | Update status |

### Debugging Commands

| Command | Description |
|---------|-------------|
| `dev-loop diagnose [<id>]` | Analyze failures |
| `dev-loop trace <id>` | Execution trace |
| `dev-loop logs [--follow]` | View logs |
| `dev-loop metrics [--summary]` | Debug metrics |
| `dev-loop validate` | Check config/environment |
| `dev-loop validate-prd <prd-path>` | Validate PRD frontmatter against schema |

## MCP Integration

Both Task Master and Dev-Loop run as MCP servers for direct AI assistant integration.

### Setup

Create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "task-master-ai": {
      "command": "npx",
      "args": ["-y", "task-master-ai@0.40.0"],
      "env": { "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}" }
    },
    "dev-loop": {
      "command": "node",
      "args": ["packages/dev-loop/dist/mcp/server.js"],
      "env": { "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}" }
    }
  }
}
```

### MCP Tools

**Task Master MCP** (task management):
- `parse_prd`, `add_task`, `list_tasks`, `next_task`, `get_task`, `set_status`, `expand_task`

**Dev-Loop MCP** (workflow orchestration):
- Core: `devloop_run`, `devloop_status`, `devloop_prd`, `devloop_list_tasks`
- Debug: `devloop_diagnose`, `devloop_trace`, `devloop_logs`, `devloop_metrics`
- Control: `devloop_pause`, `devloop_resume`, `devloop_reset`, `devloop_validate`
- Evolution: `devloop_evolution_start`, `devloop_evolution_status`, `devloop_evolution_stop`

### Common Workflows

**Start a PRD (Evolution Mode):**
```
1. devloop_evolution_start(prd: "path/to/prd.md")
2. task-master: parse_prd(input: "path/to/prd.md")
3. devloop_prd(prdPath: "path/to/prd.md", debug: true)
4. devloop_evolution_status() — monitor until complete
```

**Debug a failure:**
```
1. devloop_diagnose(taskId: "123")
2. devloop_logs(analyze: true)
3. devloop_trace(taskId: "123")
```

## Architecture

### Workflow State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> FetchingTask: run/watch
    FetchingTask --> NoTasks: none pending
    FetchingTask --> ExecutingAI: task found
    NoTasks --> [*]
    ExecutingAI --> ApplyingChanges: code generated
    ApplyingChanges --> RunningTests: autonomous
    ApplyingChanges --> AwaitingApproval: review mode
    AwaitingApproval --> RunningTests: approved
    RunningTests --> AnalyzingLogs: complete
    AnalyzingLogs --> MarkingDone: passed
    AnalyzingLogs --> CreatingFixTask: failed
    MarkingDone --> FetchingTask: watch mode
    MarkingDone --> [*]: run mode
    CreatingFixTask --> FetchingTask
```

### Core Components

| Component | Purpose |
|-----------|---------|
| **WorkflowEngine** | Main orchestration loop, state machine |
| **TaskMasterBridge** | Wrapper around task-master-ai |
| **StateManager** | JSON/YAML persistence, state recovery |
| **CodeContextProvider** | Extract file signatures, imports, error context |
| **ValidationGate** | Pre-apply validation, syntax checking |
| **PatternLearningSystem** | Learn from outcomes, inject guidance |

### Provider Interfaces

| Interface | Implementations |
|-----------|-----------------|
| **AIProvider** | Anthropic, OpenAI, Gemini, Ollama |
| **TestRunner** | Playwright, Cypress |
| **LogAnalyzer** | PatternMatcher (regex), AILogAnalyzer |

### Analysis Components

For complex issues, dev-loop provides:

- **FrameworkPatternLibrary** — Framework-specific patterns (Drupal, React)
- **DebuggingStrategyAdvisor** — Classify errors, suggest investigation vs direct fix
- **ExecutionOrderAnalyzer** — Detect timing/ordering issues
- **ComponentInteractionAnalyzer** — Map component boundaries and conflicts
- **RootCauseAnalyzer** — Track partial fixes, identify systemic issues

## Framework Plugins

Dev-loop uses a plugin architecture to support different frameworks. Each plugin provides framework-specific templates, error patterns, file discovery rules, and configuration defaults.

### Built-in Plugins

| Plugin | Description | Auto-detects |
|--------|-------------|--------------|
| **drupal** | Drupal 10/11 with DDEV integration | Yes |
| **django** | Django 5+ with Docker/DRF support | Yes |
| **react** | React + TypeScript + Vite | Yes |
| **composite** | Multi-framework projects (auto-created) | No |
| **generic** | Fallback for any project | Fallback only |

### Auto-Detection

When `framework.type` is not specified in `devloop.config.js`, dev-loop auto-detects frameworks:

1. Checks built-in plugins (Drupal, Django, React)
2. If multiple detected → creates `CompositePlugin`
3. If single detected → uses that plugin
4. If none detected → uses `GenericPlugin`

Example: A project with both Django backend and React frontend automatically gets a `CompositePlugin` that merges both frameworks' configurations.

### Multi-Framework Projects

For projects like allthriveai (Django + React + Extension), dev-loop automatically:
- Detects all frameworks
- Creates a `CompositePlugin` with merged configurations
- Combines templates and error patterns
- Merges file discovery rules (search dirs, extensions, excludes)

**Example Configuration:**
```javascript
// devloop.config.js - optional, auto-detection works without this
module.exports = {
  framework: {
    type: 'composite', // Or let auto-detection handle it
  },
};
```

### Creating Custom Framework Plugins

#### Project-Local Plugin

Create a plugin in your project at `.devloop/frameworks/{name}/plugin.json`:

```json
{
  "name": "myframework",
  "version": "1.0.0",
  "description": "Custom framework plugin",
  "fileExtensions": ["ts", "tsx"],
  "searchDirs": ["src"],
  "excludeDirs": ["node_modules"],
  "templates": {
    "task": "templates/task.md"
  },
  "errorPatterns": {
    "MyError": "Helpful guidance for this error"
  },
  "cacheCommand": "npm run build"
}
```

#### NPM Plugin

Publish an npm package `@dev-loop/framework-{name}` that exports a `FrameworkPlugin` implementation:

```typescript
import { FrameworkPlugin } from '@dev-loop/core';

export class MyFrameworkPlugin implements FrameworkPlugin {
  readonly name = 'myframework';
  readonly version = '1.0.0';
  readonly description = 'My framework plugin';
  
  async detect(projectRoot: string): Promise<boolean> {
    // Detection logic
  }
  
  getTaskTemplate(): string {
    // Return template string
  }
  
  // ... implement other required methods
}

export default new MyFrameworkPlugin();
```

### FrameworkPlugin Interface

```typescript
interface FrameworkPlugin {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  
  // Detection
  detect(projectRoot: string): Promise<boolean>;
  
  // Configuration
  getDefaultConfig(): FrameworkDefaultConfig;
  getSchemaExtension?(): z.ZodObject<any>;
  
  // Templates
  getTaskTemplate(): string;
  getTestTemplate?(): string | undefined;
  getPrdTemplate?(): string;
  
  // File Discovery
  getFileExtensions(): string[];
  getSearchDirs(): string[];
  getExcludeDirs(): string[];
  
  // Error Handling
  getErrorPatterns(): Record<string, string>;
  getIdentifierPatterns(): RegExp[];
  getErrorPathPatterns?(): RegExp[];
  
  // Lifecycle Hooks
  onBeforeApply?(changes: CodeChanges): Promise<CodeChanges>;
  onAfterApply?(changes: CodeChanges): Promise<void>;
  onTestFailure?(error: string): Promise<string>;
  
  // Commands
  getCacheCommand?(): string | undefined;
  getBuildCommand?(): string | undefined;
}
```

See `src/frameworks/interface.ts` for full interface definition and examples in `src/frameworks/drupal/`, `src/frameworks/django/`, and `src/frameworks/react/`.

## Intervention Modes

Control whether the inner agent requires approval:

| Mode | Behavior |
|------|----------|
| `autonomous` | Fully automated |
| `review` | Human approves each change |
| `hybrid` | Auto for safe changes, review for risky (`delete`, `schema-change`) |

## Evolution Mode Details

Activated by human operator: "Enter evolution mode for dev-loop"

**Outer agent responsibilities:**
1. Run `devloop_evolution_start`
2. Create/update tasks via Task Master
3. Monitor via `devloop_evolution_status`
4. If inner agent stuck: enhance `packages/dev-loop/` code
5. Build, commit, push dev-loop changes
6. Validate improvements via metrics

**What to add to dev-loop vs create as task:**

| Scenario | Action |
|----------|--------|
| One-off bug fix | Create task |
| Repeated pattern | Add to PatternLearningSystem |
| Missing context | Enhance CodeContextProvider |
| Better prompts | Update templates |

**Keep dev-loop framework-agnostic.** Project-specific behavior goes in:
- `devloop.config.js` — Hooks, log sources
- `.taskmaster/templates/` — PRD templates
- Project rules (CLAUDE.md, .cursorrules) — Injected into prompts

## File Structure

```
project/
├── devloop.config.js           # Dev-loop config
├── .env                        # API keys
├── .taskmaster/
│   ├── tasks/tasks.json        # Task definitions
│   └── docs/                   # PRDs
├── .devloop/
│   ├── metrics.json            # Execution metrics
│   └── patterns.json           # Learned patterns
├── tests/playwright/           # Test specs
└── test-results/               # Artifacts, screenshots
```

## CI Output

- `devloop-results.json` — Structured results
- `devloop-results.xml` — JUnit XML
- `devloop-summary.md` — Human-readable summary

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Test timeout | Fix wait strategy, increase timeout |
| AI not implementing | Check API key and config |
| Form not advancing | Wait for button text/URL change |
| Flaky tests | Add explicit waits, retry logic |

## Best Practices

1. Bundle features with tests
2. Run tests after each change
3. Check logs with every test run
4. Take screenshots liberally
5. Create atomic fix tasks
6. Commit working states
7. Verify AI changes with `git diff`

## Development

```bash
npm install          # Install dependencies
npm run build        # Build
npm run dev          # Watch mode
npm test             # Test
```

**Requirements:** Node.js >= 20.0.0

## Dependencies

| Package | Purpose |
|---------|---------|
| `task-master-ai` | Task management |
| `commander` | CLI framework |
| `zod` | Config validation |
| `@anthropic-ai/sdk` | Claude API |
| `openai` | GPT API |
| `@google/generative-ai` | Gemini API |

## Roadmap

### Complete
- Workflow engine with state machine
- Multi-provider AI support
- Playwright/Cypress test runners
- Pattern learning system
- Pre-apply validation
- Framework pattern library
- Error classification & root cause analysis
- MCP integration (Task Master + Dev-Loop)
- Evolution mode

### In Progress
- Smart scheduling with dependency resolution
- Proactive pattern application
- Context gap detection

### Planned
- Parallel task execution
- Git workflow integration
- Rich HTML reports
- Shell completion scripts

## See Also

- [HANDOFF.md](./HANDOFF.md) — Implementation handoff
- [AI Dev Tasks](https://github.com/snarktank/ai-dev-tasks) — Prompt templates
- [Task Master AI](https://www.npmjs.com/package/task-master-ai) — Task management

## License

MIT
