---
title: "Getting Started Contributing"
type: "guide"
category: "contributing"
audience: "both"
keywords: ["getting-started", "setup", "first-contribution", "development-environment"]
related_docs:
  - "README.md"
  - "ARCHITECTURE.md"
  - "DEVELOPMENT_WORKFLOW.md"
prerequisites: []
estimated_read_time: 15
contribution_mode: true
---

# Getting Started Contributing

This guide helps you set up your development environment and make your first contribution to dev-loop.

## Prerequisites

- Node.js 20+
- Git
- An AI API key (Anthropic, OpenAI, or Gemini) - for testing
- Basic familiarity with TypeScript

## Development Setup

### 1. Clone the Repository

Dev-loop is typically installed as an npm package, but for active development:

```bash
# Clone dev-loop (if you have access)
git clone <dev-loop-repo-url>
cd dev-loop

# Install dependencies
npm install

# Build the project
npm run build
```

### 2. Link for Local Development

If you're contributing from a project that uses dev-loop:

```bash
# In dev-loop directory
npm link

# In your project directory
npm link dev-loop
```

### 3. Verify Setup

```bash
# Check dev-loop works
npx dev-loop --version

# Run tests
npm test
```

## Your First Contribution

### Choose a Task

1. Check for open issues labeled "good first issue"
2. Pick a small bug fix or feature
3. Comment on the issue to let others know you're working on it

### Development Workflow

1. **Create a branch:**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes:**
   - Edit code in `src/`
   - Follow code style (TypeScript, 2-space indent)
   - Add tests for new features

3. **Test locally:**
   ```bash
   npm run build
   npm test
   ```

4. **Commit:**
   ```bash
   git commit -m "feat: add your feature description"
   ```

5. **Push and create PR:**
   ```bash
   git push origin feature/your-feature-name
   ```

## Code Style

- **TypeScript** - Use type hints and interfaces
- **Indentation** - 2 spaces
- **Naming** - camelCase for variables/functions, PascalCase for classes
- **Comments** - Document complex logic, not obvious code

## Testing Your Changes

```bash
# Run all tests
npm test

# Run specific test file
npm test -- path/to/test.ts

# Build before testing
npm run build
```

## Quick Start: Contribution Mode Scenarios

For quick-start scenarios and common contribution mode workflows, see [QUICK_START.md](QUICK_START.md).

**Common Scenarios**:

1. **Single PRD (Watch Mode)**: Use `npx dev-loop watch --until-complete` for daemon mode execution
   - See [Quick Start - Scenario 1](QUICK_START.md#scenario-1-monitoring-a-single-prd-watch-mode)

2. **PRD Set (One-Shot Execution)**: Use `npx dev-loop prd-set execute <path>` for orchestrated execution
   - See [Quick Start - Scenario 2](QUICK_START.md#scenario-2-monitoring-a-prd-set-one-shot-execution)

3. **Automated Monitoring**: Configure proactive monitoring service for unattended execution
   - See [Quick Start - Scenario 3](QUICK_START.md#scenario-3-automated-monitoring-only)

**Understanding Execution Modes**: See [EXECUTION_MODES.md](EXECUTION_MODES.md) for complete guide on watch mode vs PRD set execute.

**Monitoring Best Practices**: See [OUTER_AGENT_MONITORING.md](OUTER_AGENT_MONITORING.md) for monitoring approaches and best practices.

## Next Steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand the codebase
- Review [CONTRIBUTION_MODE.md](CONTRIBUTION_MODE.md) for contribution mode workflow
- Check [EXECUTION_MODES.md](EXECUTION_MODES.md) for execution mode details
- Study [OUTER_AGENT_MONITORING.md](OUTER_AGENT_MONITORING.md) for monitoring best practices
- See [QUICK_START.md](QUICK_START.md) for quick-start scenarios
- Review [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) for development workflow details
- Check [TESTING.md](TESTING.md) for testing guidelines
- See [PULL_REQUEST.md](PULL_REQUEST.md) for PR process
