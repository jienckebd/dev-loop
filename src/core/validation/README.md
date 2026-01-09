# Validation System

This directory contains validation gates, scripts, and validators for pre-apply and runtime validation.

## Structure

- **gate.ts** - ValidationGate class for pre-apply validation (syntax checking, error detection)
- **gate-executor.ts** - ValidationGateExecutor for executing validation gates
- **script-executor.ts** - ValidationScriptExecutor for executing custom validation scripts
- **linker.ts** - ValidationLinker for linking validation requirements to test generation
- **assertion-validators.ts** - AssertionValidatorRegistry for framework-specific validators
- **prerequisite-validator.ts** - PrerequisiteValidator for checking task prerequisites

## Key Features

- **Pre-apply Validation**: Validates code changes before applying them (syntax, basic errors)
- **Custom Scripts**: Executes custom validation scripts from PRD frontmatter
- **Framework Validators**: Framework-specific assertion validators (e.g., Drupal)
- **Prerequisite Checking**: Validates that prerequisites are met before task execution

## Usage

```typescript
import { ValidationGate } from './validation/gate';
import { ValidationGateExecutor } from './validation/gate-executor';
import { AssertionValidatorRegistry } from './validation/assertion-validators';

// Pre-apply validation
const gate = new ValidationGate();
const result = await gate.validate(changes);

// Execute validation gates
const executor = new ValidationGateExecutor();
await executor.executeGates(phaseId, gates);
```

## Related Files

- `src/core/testing/` - Test execution (often used with validation)
- `src/core/execution/workflow.ts` - Uses validation gates in workflow

