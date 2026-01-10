---
title: "Contributing Documentation Index"
type: "index"
category: "contributing"
audience: "ai"
keywords: ["index", "contributing", "contribution", "lookup", "reference"]
related_docs:
  - "README.md"
  - "GETTING_STARTED.md"
  - "ARCHITECTURE.md"
  - "DEVELOPMENT_WORKFLOW.md"
prerequisites: []
estimated_read_time: 5
contribution_mode: true
---

# Contributing Documentation Index

Quick reference for AI agents contributing to dev-loop code. This index is only autoloaded when in contribution mode.

## Task → Documentation

| Task | Documentation | Load Priority | When to Load |
|------|---------------|---------------|--------------|
| Set up development environment | [`GETTING_STARTED.md`](GETTING_STARTED.md) | High | First contribution |
| Understand contribution mode | [`CONTRIBUTION_MODE.md`](CONTRIBUTION_MODE.md) | High | Before starting contribution mode |
| Understand codebase structure | [`ARCHITECTURE.md`](ARCHITECTURE.md) | High | Before major changes |
| Make changes to dev-loop | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | High | Always when editing code |
| Write tests | [`TESTING.md`](TESTING.md) | Medium | When adding features |
| Submit pull request | [`PULL_REQUEST.md`](PULL_REQUEST.md) | Medium | Before submitting PR |
| Add new CLI command | [`ARCHITECTURE.md`](ARCHITECTURE.md) → CLI section | Medium | When adding command |
| Add new MCP tool | [`ARCHITECTURE.md`](ARCHITECTURE.md) → MCP section | Medium | When adding tool |
| Add framework plugin | [`ARCHITECTURE.md`](ARCHITECTURE.md) → Framework Plugins section | Medium | When adding plugin |
| Add parallel execution support | [`ARCHITECTURE.md`](ARCHITECTURE.md) → Parallel Execution System | Medium | When adding parallel execution |
| Add session management | [`ARCHITECTURE.md`](ARCHITECTURE.md) → Session Management System | Medium | When adding session management |
| Add timeout/retry logic | [`ARCHITECTURE.md`](ARCHITECTURE.md) → AI Provider Reliability | Medium | When adding timeout/retry handling |
| Add event monitoring | [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md), [`ARCHITECTURE.md`](ARCHITECTURE.md) → Monitoring & Intervention System | Medium | When adding proactive monitoring |
| Configure intervention thresholds | [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) → Configuration Reference | Medium | When configuring thresholds |
| Use observation tools | [`OBSERVATION_TOOLS.md`](OBSERVATION_TOOLS.md) | Medium | When using pattern detection or session analysis |
| Analyze intervention metrics | [`METRICS.md`](../users/METRICS.md) → Intervention Metrics | Medium | When analyzing intervention effectiveness |

## Component → Documentation

| Component | Documentation | Sections | When to Load |
|-----------|---------------|----------|--------------|
| Core components | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Core Components | Understanding core logic |
| Parallel execution | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Parallel Execution System | Working with parallel execution |
| Session management | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Session Management System | Working with session management |
| Context discovery | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Context Discovery System | Working with context discovery |
| AI provider reliability | [`ARCHITECTURE.md`](ARCHITECTURE.md) | AI Provider Reliability | Working with timeouts, retries, JSON parsing |
| Framework plugins | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Framework Plugins | Working with plugins |
| MCP integration | [`ARCHITECTURE.md`](ARCHITECTURE.md) | MCP Integration | Adding MCP tools |
| Configuration | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Configuration | Modifying config system |
| EventMonitorService | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Monitoring & Intervention System | Working with proactive monitoring |
| IssueClassifier | [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) | Issue Classification | Working with issue classification |
| ActionExecutor | [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) | Action Execution | Working with automated fixes |
| Observation Tools | [`OBSERVATION_TOOLS.md`](OBSERVATION_TOOLS.md) | Enhanced Observation Tools | Using pattern detection and session analysis |
| InterventionMetricsTracker | [`ARCHITECTURE.md`](ARCHITECTURE.md) | Monitoring & Intervention System | Working with intervention metrics |

## Problem → Solution

| Problem | Documentation | Solution |
|---------|---------------|----------|
| Build fails | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Run `npm run build`, check TypeScript errors |
| Tests fail | [`TESTING.md`](TESTING.md) | Check test output, verify changes don't break existing tests |
| Need framework-specific code | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Use framework plugin, not core |
| Changes not reflected | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Rebuild with `npm run build` |
| How to commit changes | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Commit from `node_modules/dev-loop/`, push to branch |
| Events not triggering interventions | [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) → Troubleshooting | Check monitoring service status, threshold configuration, confidence requirements, rate limiting |
| Interventions failing | [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) → Action Strategies | Review strategy implementation, check file permissions, verify fix effectiveness |
| Need pattern detection | [`OBSERVATION_TOOLS.md`](OBSERVATION_TOOLS.md) → Pattern Detection | Use `devloop_pattern_detection` tool to identify recurring failure patterns |
| High rollback rate | [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) → Troubleshooting | Review rollback reasons, increase confidence requirements, improve fix validation, narrow fix scope |
| False positives in interventions | [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) → Troubleshooting | Increase threshold counts/rates, increase time windows, adjust confidence calculations |

## Workflow → Documentation

| Workflow | Documentation Sequence | Purpose |
|----------|----------------------|---------|
| First contribution | [`GETTING_STARTED.md`](GETTING_STARTED.md) → [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Setup, understand, contribute |
| Adding feature | [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) → [`TESTING.md`](TESTING.md) → [`PULL_REQUEST.md`](PULL_REQUEST.md) | Plan, implement, test, submit |
| Fixing bug | [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) → [`TESTING.md`](TESTING.md) | Understand, fix, test |
| Contributing framework plugin | [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Understand plugin system, implement |

## Quick Reference by Type

### Guides (Step-by-Step Instructions)

| Document | Purpose | Load When |
|----------|---------|-----------|
| [`GETTING_STARTED.md`](GETTING_STARTED.md) | First contribution setup | Starting to contribute |
| [`CONTRIBUTION_MODE.md`](CONTRIBUTION_MODE.md) | Two-agent architecture guide | Before starting contribution mode |
| [`EVENT_STREAMING.md`](EVENT_STREAMING.md) | Event streaming and proactive monitoring guide | When using event monitoring or proactive monitoring |
| [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) | Proactive monitoring and intervention guide | When configuring or debugging proactive monitoring |
| [`OBSERVATION_TOOLS.md`](OBSERVATION_TOOLS.md) | Enhanced observation tools reference | When using pattern detection, session analysis, or context gap detection |
| [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | How to make changes | Making any code changes |
| [`TESTING.md`](TESTING.md) | Writing and running tests | Adding features or fixing bugs |
| [`PULL_REQUEST.md`](PULL_REQUEST.md) | Submitting contributions | Before creating PR |

### Reference (Complete Reference Material)

| Document | Purpose | Load When |
|----------|---------|-----------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Codebase structure and components | Understanding codebase |
| [`PROACTIVE_MONITORING.md`](PROACTIVE_MONITORING.md) | Proactive monitoring and intervention system reference | Working with proactive monitoring |
| [`OBSERVATION_TOOLS.md`](OBSERVATION_TOOLS.md) | Enhanced observation tools reference | Using observation tools |
| [`EVENT_STREAMING.md`](EVENT_STREAMING.md) | Event streaming guide | Working with events |

## Contribution Mode Detection

This index is only autoloaded when:
- `.devloop/contribution-mode.json` exists and `active: true`
- Or when explicitly in contribution mode context

**Note:** This documentation is separate from PRD documentation (`docs/ai/`). PRD docs are for using dev-loop, not contributing to it.

## See Also

- [`README.md`](README.md) - Contributing overview
- [`../ai/INDEX.md`](../ai/INDEX.md) - PRD documentation index (for using dev-loop)
- [Root README](../../README.md) - Project overview
