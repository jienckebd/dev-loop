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

## Next Steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand the codebase
- Review [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md) for contribution mode details
- Check [TESTING.md](TESTING.md) for testing guidelines
- See [PULL_REQUEST.md](PULL_REQUEST.md) for PR process
