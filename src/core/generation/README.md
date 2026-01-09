# Code Generation

This directory contains code generation functionality for various frameworks and use cases.

## Structure

- **drupal-implementation-generator.ts** - DrupalImplementationGenerator for generating Drupal-specific code
- **autonomous-task-generator.ts** - AutonomousTaskGenerator for generating autonomous tasks
- **investigation-task-generator.ts** - InvestigationTaskGenerator for generating investigation tasks

## Key Features

- **Framework-Specific Generation**: Generates code tailored to specific frameworks (e.g., Drupal)
- **Autonomous Task Generation**: Generates tasks that can run autonomously
- **Investigation Task Generation**: Generates tasks for investigating and debugging issues

## Usage

```typescript
import { DrupalImplementationGenerator } from './generation/drupal-implementation-generator';
import { AutonomousTaskGenerator } from './generation/autonomous-task-generator';

// Generate Drupal implementation
const generator = new DrupalImplementationGenerator(aiProvider, config);
const changes = await generator.generate(requirement, context);
```

## Related Files

- `src/core/execution/workflow.ts` - Uses generators in workflow
- `src/core/prd/coordination/context.ts` - Provides PRD context for generation

