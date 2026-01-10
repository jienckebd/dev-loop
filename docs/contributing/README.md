---
title: "Contributing to Dev-Loop"
type: "guide"
category: "contributing"
audience: "both"
keywords: ["contributing", "development", "pull-request", "code-review"]
related_docs:
  - "GETTING_STARTED.md"
  - "ARCHITECTURE.md"
prerequisites: []
estimated_read_time: 5
contribution_mode: true
---

# Contributing to Dev-Loop

Welcome! This guide helps you contribute to dev-loop's core codebase.

## Quick Links

- [Getting Started](GETTING_STARTED.md) - Setup and first contribution
- [Contribution Mode](CONTRIBUTION_MODE.md) - Two-agent architecture guide
- [Architecture](ARCHITECTURE.md) - Codebase structure and patterns
- [Development Workflow](DEVELOPMENT_WORKFLOW.md) - How to make changes
- [Testing](TESTING.md) - Writing and running tests
- [Pull Request Process](PULL_REQUEST.md) - Submitting contributions

## Contribution Mode

When contributing to dev-loop code, use **Contribution Mode**:

```bash
npx dev-loop contribution start --prd <path>
```

This activates two-agent architecture where:
- **Outer Agent**: Enhances dev-loop (`node_modules/dev-loop/`)
- **Inner Agent**: Implements project code

See [Contribution Mode Guide](CONTRIBUTION_MODE.md) for complete documentation.

## Overview

Dev-loop is an autonomous development orchestrator that transforms PRDs into validated code. When contributing:

1. **Understand the architecture** - See [ARCHITECTURE.md](ARCHITECTURE.md)
2. **Follow the workflow** - See [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md)
3. **Write tests** - See [TESTING.md](TESTING.md)
4. **Submit PRs** - See [PULL_REQUEST.md](PULL_REQUEST.md)

## Key Principles

- **Framework-agnostic** - Keep dev-loop core framework-agnostic. Framework-specific behavior belongs in plugins or project config.
- **Test-driven** - All features should include tests.
- **Documentation** - Update relevant documentation when adding features.
- **Metrics** - New features should integrate with the hierarchical metrics system (PRD Set → PRD → Phase → Task) for tracking and reporting.

## Metrics and Reporting

Dev-loop includes a comprehensive metrics and reporting system. When adding new features:

- Integrate with hierarchical metrics classes (`PrdMetrics`, `PhaseMetrics`, etc.)
- Track feature usage via `FeatureTracker`
- Track schema operations via `SchemaTracker`
- Record errors via `ErrorAnalyzer`
- Generate reports via `PrdReportGenerator`See [`../users/METRICS.md`](../users/METRICS.md) for user-facing documentation.
