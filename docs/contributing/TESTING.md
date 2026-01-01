---
title: "Testing Guidelines"
type: "guide"
category: "contributing"
audience: "both"
keywords: ["testing", "tests", "test-coverage", "unit-tests", "integration-tests"]
related_docs:
  - "README.md"
  - "DEVELOPMENT_WORKFLOW.md"
  - "PULL_REQUEST.md"
prerequisites:
  - "GETTING_STARTED.md"
estimated_read_time: 15
contribution_mode: true
---

# Testing Guidelines

How to write and run tests for dev-loop contributions.

## Test Structure

Tests are located alongside source files or in a `__tests__/` directory:

```
src/
├── core/
│   ├── workflow-engine.ts
│   └── workflow-engine.test.ts  # Test file
└── frameworks/
    └── drupal/
        ├── index.ts
        └── __tests__/
            └── index.test.ts  # Test in subdirectory
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- workflow-engine.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

## Writing Tests

### Test Framework

Dev-loop uses a testing framework (Jest, Vitest, or similar). Check `package.json` for the test runner.

### Basic Test Structure

```typescript
import { describe, it, expect } from 'test-framework';
import { MyFeature } from './my-feature';

describe('MyFeature', () => {
  it('should do something', () => {
    const feature = new MyFeature();
    const result = feature.doSomething();
    expect(result).toBe(expected);
  });
});
```

### Testing Async Code

```typescript
it('should handle async operations', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

### Mocking

```typescript
// Mock external dependencies
jest.mock('../external-module');

// Or use manual mocks
const mockFunction = jest.fn();
mockFunction.mockReturnValue('mocked value');
```

## Test Coverage

### What to Test

✅ **Do test:**
- Core business logic
- Error handling
- Edge cases
- Public APIs
- Framework plugin implementations

❌ **Don't test:**
- Third-party library behavior
- TypeScript types (use type checking instead)
- Trivial getters/setters

### Coverage Expectations

- Aim for >80% coverage on new features
- Focus on critical paths
- Test error cases, not just happy paths

## Testing Framework Plugins

When testing framework plugins:

```typescript
import { DrupalPlugin } from '../frameworks/drupal';

describe('DrupalPlugin', () => {
  it('should detect Drupal project', async () => {
    const plugin = new DrupalPlugin();
    const detected = await plugin.detect('/path/to/drupal');
    expect(detected).toBe(true);
  });

  it('should provide error patterns', () => {
    const plugin = new DrupalPlugin();
    const patterns = plugin.getErrorPatterns();
    expect(patterns).toHaveProperty('PluginNotFoundException');
  });
});
```

## Testing CLI Commands

CLI commands can be tested by:

1. **Unit testing the command function:**
   ```typescript
   import { myCommand } from './commands/my-command';
   
   it('should execute command', async () => {
     const result = await myCommand({ option: 'value' });
     expect(result).toBeDefined();
   });
   ```

2. **Integration testing (if available):**
   - Test full command execution
   - Verify output
   - Check file system changes

## Testing MCP Tools

MCP tools can be tested by:

```typescript
import { registerMyTools } from './tools/my-tools';

describe('MCP Tools', () => {
  it('should register tools', () => {
    const mockMcp = {
      addTool: jest.fn(),
    };
    registerMyTools(mockMcp, mockGetConfig);
    expect(mockMcp.addTool).toHaveBeenCalled();
  });
});
```

## Common Testing Patterns

### Testing with File System

```typescript
import * as fs from 'fs-extra';
import * as path from 'path';
import { tmpdir } from 'os';

it('should write to file', async () => {
  const tempDir = path.join(tmpdir(), 'test');
  await fs.ensureDir(tempDir);
  
  // Test code that writes files
  await writeFile(path.join(tempDir, 'test.txt'), 'content');
  
  // Verify
  const content = await fs.readFile(path.join(tempDir, 'test.txt'), 'utf-8');
  expect(content).toBe('content');
  
  // Cleanup
  await fs.remove(tempDir);
});
```

### Testing with Mocked Config

```typescript
const mockConfig = {
  ai: { provider: 'anthropic', model: 'claude-sonnet-4' },
  testing: { runner: 'playwright' },
};

const mockGetConfig = jest.fn().mockResolvedValue(mockConfig);
```

## Debugging Tests

```bash
# Run specific test with debug output
npm test -- --verbose my-test.test.ts

# Run in debugger (if configured)
npm test -- --inspect-brk my-test.test.ts
```

## Continuous Integration

Tests run automatically on:
- Pull requests
- Commits to main branch

Ensure all tests pass before submitting PRs.

## See Also

- [Development Workflow](DEVELOPMENT_WORKFLOW.md) - Making changes
- [Pull Request Process](PULL_REQUEST.md) - PR requirements
- [Architecture](ARCHITECTURE.md) - Understanding the codebase
