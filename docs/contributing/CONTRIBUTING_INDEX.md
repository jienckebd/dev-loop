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

## Problem → Solution

| Problem | Documentation | Solution |
|---------|---------------|----------|
| Build fails | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Run `npm run build`, check TypeScript errors |
| Tests fail | [`TESTING.md`](TESTING.md) | Check test output, verify changes don't break existing tests |
| Need framework-specific code | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Use framework plugin, not core |
| Changes not reflected | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Rebuild with `npm run build` |
| How to commit changes | [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Commit from `node_modules/dev-loop/`, push to branch |

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
| [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | How to make changes | Making any code changes |
| [`TESTING.md`](TESTING.md) | Writing and running tests | Adding features or fixing bugs |
| [`PULL_REQUEST.md`](PULL_REQUEST.md) | Submitting contributions | Before creating PR |

### Reference (Complete Reference Material)

| Document | Purpose | Load When |
|----------|---------|-----------|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Codebase structure and components | Understanding codebase |

## Contribution Mode Detection

This index is only autoloaded when:
- `.devloop/contribution-mode.json` exists and `active: true`
- Or when explicitly in contribution mode context

**Note:** This documentation is separate from PRD documentation (`docs/ai/`). PRD docs are for using dev-loop, not contributing to it.

## See Also

- [`README.md`](README.md) - Contributing overview
- [`../ai/INDEX.md`](../ai/INDEX.md) - PRD documentation index (for using dev-loop)
- [Root README](../../README.md) - Project overview
