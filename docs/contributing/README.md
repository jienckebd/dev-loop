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
- [Event Streaming](EVENT_STREAMING.md) - Event streaming and proactive monitoring guide
- [Proactive Monitoring](PROACTIVE_MONITORING.md) - Proactive monitoring and intervention system guide
- [Observation Tools](OBSERVATION_TOOLS.md) - Enhanced observation MCP tools reference
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
- Generate reports via `PrdReportGenerator`
- Track interventions via `InterventionMetricsTracker` (for proactive monitoring features)

See [`../users/METRICS.md`](../users/METRICS.md) for user-facing documentation.

## Proactive Monitoring & Intervention

Dev-loop includes a proactive event monitoring system that automatically detects issues and applies corrective actions:

- **Event Monitoring**: Continuous event polling and threshold-based intervention triggering
- **Issue Classification**: Automatic issue classification and confidence calculation
- **Automated Fixes**: Pre-configured fix strategies for common issue types
- **Effectiveness Tracking**: Intervention metrics tracking and effectiveness analysis

See [Proactive Monitoring Guide](PROACTIVE_MONITORING.md) for complete documentation.

## Enhanced Observation Tools

Enhanced observation MCP tools provide better observability of inner agent behavior:

- **Pattern Detection**: Detect recurring patterns in failures and blocked tasks
- **Session Analysis**: Analyze session pollution patterns
- **Context Gap Detection**: Identify missing context causing task failures
- **Dependency Graph**: Visualize task and code dependencies

See [Observation Tools Guide](OBSERVATION_TOOLS.md) for complete reference.
