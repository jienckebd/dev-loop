---
title: "Development Workflow"
type: "guide"
category: "contributing"
audience: "both"
keywords: ["workflow", "contribution-mode", "outer-agent", "inner-agent", "git", "build"]
related_docs:
  - "README.md"
  - "ARCHITECTURE.md"
  - "TESTING.md"
  - "PULL_REQUEST.md"
prerequisites:
  - "GETTING_STARTED.md"
estimated_read_time: 20
contribution_mode: true
---

# Development Workflow

How to make changes to dev-loop using Contribution Mode.

## Contribution Mode Overview

Contribution Mode activates a two-agent architecture:

- **Outer Agent (You)**: Enhances dev-loop code in `node_modules/dev-loop/`
- **Inner Agent (Dev-Loop)**: Implements project code (e.g., `docroot/`, `tests/`)

### Activating Contribution Mode

```bash
npx dev-loop contribution start --prd <path-to-prd.md>
```

This creates `.devloop/contribution-mode.json` tracking the active contribution session.

### Checking Status

```bash
npx dev-loop contribution status
```

### Deactivating

```bash
npx dev-loop contribution stop
```

## Making Changes to Dev-Loop

### 1. Setup

If contributing from a project using dev-loop:

```bash
# In dev-loop directory
cd node_modules/dev-loop

# Create branch
git checkout -b feature/your-feature

# Install dependencies (if needed)
npm install
```

### 2. Edit Code

Make your changes in `src/`:

```bash
# Example: Adding a new feature
vim src/core/my-new-feature.ts

# Edit related files
vim src/index.ts  # Export new feature
```

### 3. Build

Always build after changes:

```bash
npm run build
```

This compiles TypeScript to JavaScript in `dist/`.

### 4. Test

```bash
# Run tests
npm test

# Or test in your project
cd ../..  # Back to project root
npm test  # Uses linked dev-loop
```

### 5. Commit and Push

```bash
cd node_modules/dev-loop

# Stage changes
git add -A

# Commit
git commit -m "feat: add your feature description"

# Push
git push origin feature/your-feature
```

**Important:** When contributing to dev-loop, commit and push from `node_modules/dev-loop/` directly. The changes are immediately available after building (no symlink needed if using git source).

## Outer Agent vs Inner Agent Boundaries

### Outer Agent (You) Can Edit

- `node_modules/dev-loop/src/` - Dev-loop core code
- `.taskmaster/tasks/tasks.json` - Task definitions
- `.taskmaster/docs/` - PRD updates
- `.devloop/` - Contribution mode state
- `devloop.config.js` - Dev-loop configuration

### Inner Agent (Dev-Loop) Edits

- `docroot/` - Project code (Drupal example)
- `tests/playwright/` - Test files
- `config/` - Configuration files
- `script/` - Script files

Boundaries are enforced via `.cursorrules` or project rules.

## Framework-Agnostic Rule

**Critical:** Keep dev-loop core framework-agnostic.

✅ **Do:**
- Add generic patterns that work across frameworks
- Extend plugin system for framework-specific code
- Add configuration options in `devloop.config.js` schema

❌ **Don't:**
- Add Drupal-specific code to core
- Add React-specific code to core
- Hardcode framework assumptions

Framework-specific behavior belongs in:
- Framework plugins (`src/frameworks/`)
- Project config (`devloop.config.js`)
- Project rules (`.cursorrules`, `CLAUDE.md`)

## Making Framework-Agnostic Changes

### Adding a New Feature

1. **Design generically:**
   ```typescript
   // ✅ Good: Generic interface
   interface TaskExecutor {
     execute(task: Task): Promise<Result>;
   }
   
   // ❌ Bad: Framework-specific
   interface DrupalTaskExecutor {
     executeDrupalTask(task: DrupalTask): Promise<DrupalResult>;
   }
   ```

2. **Use configuration:**
   ```typescript
   // ✅ Good: Config-driven
   const command = config.framework.cacheCommand || 'npm run build';
   
   // ❌ Bad: Hardcoded
   const command = 'drush cr';
   ```

3. **Extend plugins:**
   ```typescript
   // ✅ Good: Plugin provides framework behavior
   const command = frameworkPlugin.getCacheCommand();
   ```

## Build and Test Cycle

```bash
# 1. Make changes
vim src/core/my-feature.ts

# 2. Build
npm run build

# 3. Test in your project
cd ../..
npm test

# 4. If tests pass, commit
cd node_modules/dev-loop
git add -A
git commit -m "feat: add my feature"
git push origin feature/my-feature
```

## Common Patterns

### Adding a New CLI Command

1. Create `src/cli/commands/my-command.ts`
2. Export command function
3. Register in `src/index.ts`
4. Build and test

### Adding a New MCP Tool

1. Create or edit `src/mcp/tools/my-tools.ts`
2. Use `registerMyTools(mcp, getConfig)`
3. Export in `src/mcp/tools/index.ts`
4. Register in `src/mcp/server.ts`
5. Build and test

### Adding a Framework Plugin

1. Create `src/frameworks/myframework/index.ts`
2. Implement `FrameworkPlugin` interface
3. Register in `src/frameworks/index.ts`
4. Build and test

## Troubleshooting

### Build Fails

```bash
# Check TypeScript errors
npm run build

# Fix errors
vim src/.../error-file.ts

# Rebuild
npm run build
```

### Tests Fail After Changes

1. Check test output for errors
2. Verify your changes don't break existing functionality
3. Update tests if behavior changed intentionally

### Changes Not Reflected

```bash
# Rebuild
npm run build

# Verify dist/ updated
ls -la dist/

# Restart dev-loop if needed
```

## See Also

- [Testing](TESTING.md) - Testing guidelines
- [Pull Request Process](PULL_REQUEST.md) - Submitting PRs
- [Architecture](ARCHITECTURE.md) - Codebase structure
