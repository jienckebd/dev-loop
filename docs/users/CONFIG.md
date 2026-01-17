# Configuration Guide

## Overview

The `devloop.config.js` file configures all aspects of dev-loop behavior. This guide covers all configuration options, including new sections for pattern library, execution intelligence, and config evolution.

## Configuration File

The configuration file is a JavaScript module that exports a config object:

```javascript
module.exports = {
  // ... configuration sections
};
```

## Core Configuration Sections

### AI Provider Configuration

```javascript
{
  ai: {
    provider: 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'cursor',
    model: 'claude-sonnet-4-20250514', // Model name
    fallback: 'cursor', // Fallback provider
    apiKey: process.env.ANTHROPIC_API_KEY, // Optional, can use env vars
    maxTokens: 100000,
    maxContextChars: 50000,
  }
}
```

### Testing Configuration

```javascript
{
  testing: {
    runner: 'playwright' | 'cypress' | 'jest',
    command: 'npm test',
    timeout: 300000,
    artifactsDir: 'test-results',
  }
}
```

### Framework Configuration

```javascript
{
  framework: {
    type: 'drupal' | 'react' | 'django' | 'generic',
    rules: {
      // Framework-specific rules
    },
    errorGuidance: {
      // Framework-specific error guidance
    },
  }
}
```

## New Configuration Sections

### Pattern Library Configuration

Controls the unified pattern system:

```javascript
{
  patternLearning: {
    enabled: true,
    patternsPath: '.devloop/pattern-library.json', // Unified storage
    useBuiltinPatterns: true, // Include built-in error patterns
  },
  prdBuilding: {
    learningFiles: {
      enabled: true,
      patterns: '.devloop/pattern-library.json', // Now uses unified storage
      filtering: {
        patternsRetentionDays: 180, // Keep patterns for 180 days
        relevanceThreshold: 0.5, // Minimum relevance score (0-1)
        autoPrune: true, // Automatically prune old patterns
      },
    },
  },
}
```

**Key Points**:
- All patterns stored in unified `.devloop/pattern-library.json`
- Legacy `.devloop/patterns.json` files are automatically migrated
- Filtering applies to PRD patterns loaded during PRD building
- Pattern learning tracks error patterns during execution

### Execution Intelligence Configuration

Tracks task execution patterns and PRD generation insights:

```javascript
{
  executionIntelligence: {
    enabled: true,
    dataPath: '.devloop/execution-intelligence.json',
    maxResults: 1000, // Max results per category
    trackTaskExecution: true,
    trackPrdGeneration: true,
    trackProviderPerformance: true,
  },
}
```

**What It Tracks**:
- Task execution patterns (success/failure rates, iterations, approaches)
- PRD generation insights (phase count, task count, executability scores)
- Provider/model performance (response times, success rates, quality scores)

**Used By**:
- `init` command for provider/model recommendations
- `build-prd-set` for refinement iteration suggestions
- Correlation analysis for optimization insights

### Config Evolution Configuration

Learns from manual config edits to improve suggestions:

```javascript
{
  configEvolution: {
    enabled: true,
    dataPath: '.devloop/config-evolution.json',
    trackChanges: true, // Track config changes
    learnPreferences: true, // Learn from manual edits
    applyLearnedPreferences: true, // Apply in init command
  },
}
```

**What It Learns**:
- Common overrides (frequently changed settings)
- Always-enabled features
- Ignored features (commonly disabled)

**Used By**:
- `init` command to pre-fill learned preferences
- Helps avoid suggesting settings you always change

### Project Profile Configuration

Captures learned project characteristics:

```javascript
{
  projectProfile: {
    framework: 'drupal', // Detected framework
    testFramework: 'playwright',
    commonPatterns: ['entity', 'plugin', 'service'],
    typicalTaskTypes: ['create-entity', 'add-field'],
    preferredApproaches: {
      'create-entity': 'schema-first',
    },
  },
}
```

**Auto-Generated**:
- Framework detection during init
- Pattern discovery during codebase analysis
- Task type learning from execution

### IterationRunner Configuration

Controls the fresh-context execution loop (Ralph pattern):

```javascript
{
  iteration: {
    maxIterations: 100,        // Max iterations before stopping
    contextThreshold: 90,      // Context usage % for auto-handoff
    autoHandoff: true,         // Enable automatic handoff generation
    persistLearnings: true,    // Save learnings to progress.md
    updatePatterns: true,      // Update learned-patterns.md
    handoffInterval: 5,        // Generate handoff every N iterations
  },
}
```

**Key Points**:
- IterationRunner is the default execution entry point
- Each iteration gets fresh AI context (Ralph pattern)
- Learnings persist via `handoff.md` and `progress.md`
- Checkpoints enable state recovery on crash

### PRD Set Execution Configuration

Controls parallel PRD execution:

```javascript
{
  prdSet: {
    parallel: true,            // Enable parallel PRD execution
    maxConcurrent: 3,          // Max parallel IterationRunner instances
  },
}
```

**Key Points**:
- PrdSetOrchestrator creates parallel IterationRunner per PRD
- Dependency-aware scheduling via DependencyGraphBuilder
- Each PRD gets isolated execution context

## Complete Configuration Example

```javascript
module.exports = {
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  testing: {
    runner: 'playwright',
    command: 'npm test',
    timeout: 300000,
  },
  framework: {
    type: 'drupal',
  },
  patternLearning: {
    enabled: true,
    patternsPath: '.devloop/pattern-library.json',
  },
  prdBuilding: {
    learningFiles: {
      patterns: '.devloop/pattern-library.json',
      filtering: {
        patternsRetentionDays: 180,
        relevanceThreshold: 0.5,
        autoPrune: true,
      },
    },
  },
  executionIntelligence: {
    enabled: true,
    dataPath: '.devloop/execution-intelligence.json',
  },
  configEvolution: {
    enabled: true,
    dataPath: '.devloop/config-evolution.json',
  },
};
```

## Configuration Generation

The `dev-loop init` command generates configuration using:

1. **Codebase Analysis**: Detects framework, test framework, file patterns
2. **Execution Intelligence**: Suggests providers/models based on historical performance
3. **Config Evolution**: Applies learned preferences from manual edits
4. **Constitution Analysis**: Extracts constraints from `.cursorrules`
5. **AI Enhancement**: Optionally uses AI for deep analysis

## Best Practices

1. **Let it learn**: Don't disable execution intelligence or config evolution
2. **Review suggestions**: Check AI-generated config matches your needs
3. **Manual tweaks**: Fine-tune config - system learns from your changes
4. **Pattern retention**: Adjust retention days based on project stability
5. **Relevance threshold**: Tune threshold to balance pattern usage vs. noise

## Related Documentation

- [Init Command Guide](INIT_COMMAND.md) - How init generates configuration
- [Pattern System Guide](PATTERNS.md) - Pattern library usage
- [Metrics Guide](METRICS.md) - Execution intelligence metrics
