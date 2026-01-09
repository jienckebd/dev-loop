# Analysis System

This directory contains code analysis, error analysis, and pattern learning capabilities.

## Structure

### error/
- **analyzer.ts** - Unified error analyzer for categorizing and tracking errors
- **failure-analyzer.ts** - Test failure analysis and root cause detection
- **root-cause-analyzer.ts** - Root cause analysis for partial fixes
- **recovery.ts** - Error recovery strategies

### code/
- **context-provider.ts** - Extracts code context for AI prompts
- **quality-scanner.ts** - Code quality scanning and tech debt detection
- **abstraction-detector.ts** - Detects abstraction patterns and opportunities
- **ast-parser.ts** - AST parsing utilities
- **codebase-graph.ts** - Codebase dependency graph construction
- **component-interaction-analyzer.ts** - Analyzes component interactions
- **execution-order-analyzer.ts** - Analyzes execution order dependencies
- **debugging-strategy-advisor.ts** - Provides debugging strategy recommendations
- **scan-reporter.ts** - Generates scan reports and creates fix tasks
- **semantic-file-discovery.ts** - Semantic file discovery using embeddings

### pattern/
- **learner.ts** - Pattern learning system (learns from successful/failed executions)
- **framework-pattern-library.ts** - Framework-specific pattern library

## Key Features

- **Error Categorization**: Categorizes errors by type (validation, test, log, timeout, etc.)
- **Pattern Learning**: Learns patterns from successful and failed task executions
- **Code Quality Scanning**: Detects tech debt, code smells, and quality issues
- **Semantic Analysis**: Uses embeddings for semantic code similarity

## Usage

```typescript
import { ErrorAnalyzer } from './error/analyzer';
import { CodeQualityScanner } from './code/quality-scanner';
import { PatternLearningSystem } from './pattern/learner';

// Analyze errors
const errorAnalyzer = new ErrorAnalyzer();
const category = errorAnalyzer.categorizeError(errorMessage);

// Scan code quality
const scanner = new CodeQualityScanner();
const results = await scanner.scan(projectRoot, paths);
```

