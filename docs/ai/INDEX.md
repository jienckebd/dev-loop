---
title: "Dev-Loop AI Documentation Index"
type: "index"
category: "reference"
audience: "ai"
keywords: ["index", "lookup", "reference", "discovery", "autoload"]
related_docs:
  - "README.md"
  - "PRD_SCHEMA.md"
  - "PRD_FEATURES.md"
  - "PRD_TEMPLATE.md"
prerequisites: []
estimated_read_time: 5
---
# Dev-Loop AI Documentation Index

Quick reference for AI agents to discover relevant documentation based on tasks, features, problems, and workflows.

## Task → Documentation

| Task | Documentation | Metadata Filter | Load Priority | When to Load |
|------|---------------|-----------------|---------------|--------------|
| Create PRD | [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) | type: template | High | Always when creating PRD |
| Validate PRD frontmatter | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | type: reference, category: prd | High | Before PRD activation |
| Configure error handling | [`PRD_FEATURES.md`](PRD_FEATURES.md) | type: guide, category: features | Medium | When errors occur |
| Set up test generation | [`PRD_FEATURES.md`](PRD_FEATURES.md) Section 3 | type: guide, category: features | Medium | When configuring tests |
| Configure context files | [`PRD_FEATURES.md`](PRD_FEATURES.md) Section 16 | type: guide, category: features | Medium | When setting up AI context |
| Understand phase dependencies | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | type: reference, keywords: phase, dependency | High | When creating phases |
| Leverage all features | [`PRD_FEATURES.md`](PRD_FEATURES.md) | type: guide, category: features | Low | For comprehensive PRD setup |
| Get started with dev-loop | [`README.md`](README.md) | type: guide, category: prd | High | Initial onboarding |

## Feature → Documentation Section

| Feature | Documentation | Section | Keywords | Load When |
|---------|---------------|---------|----------|-----------|
| Error Guidance | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 17 | error, guidance, fix, pattern | Errors occurring |
| Test Generation | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 3 | test, generation, playwright, template | Configuring tests |
| Log Analysis | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 4 | log, analysis, pattern, error | Debugging failures |
| Codebase Discovery | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 5 | codebase, discovery, file, search | Finding code |
| PRD-Specific Config | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 6 | config, prd-specific, framework | PRD configuration |
| Requirement Management | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 7 | requirement, dependency, phase, tracking | Managing tasks |
| Intervention Modes | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 8 | intervention, approval, autonomous | Setting execution mode |
| Evolution Mode | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 9 | evolution, prd, dependency, coordination | Multi-PRD execution |
| Hooks and Lifecycle | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 10 | hooks, lifecycle, preTest, postApply | Lifecycle commands |
| Validation and Smoke Tests | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 11 | validation, smoke, test, http | Runtime validation |
| Metrics and Learning | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 12 | metrics, learning, pattern | Pattern learning |
| Testing Configuration | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 13 | testing, configuration, parallel, workers | Test setup |
| Entity Generation | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 14 | entity, generation, bundle, schema | Entity creation |
| Product Metadata | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 15 | product, metadata, schema.org | Metadata setup |
| Context File Management | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 16 | context, files, alwaysInclude, taskSpecific | Context setup |
| Framework Plugin Config | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 1 | framework, plugin, drupal, errorGuidance | Framework config |
| Pattern Learning | [`PRD_FEATURES.md`](PRD_FEATURES.md) | Section 2 | pattern, learning, success, failure | Pattern configuration |

## Problem → Solution

| Problem | Documentation | Keywords | Load Priority |
|---------|---------------|----------|---------------|
| Phase dependency error | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | validation, phase, dependency, circular | High |
| Invalid frontmatter | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | validation, frontmatter, required, field | High |
| Missing feature config | [`PRD_FEATURES.md`](PRD_FEATURES.md) | feature, config, leverage | Medium |
| Phase depends on optional/deferred | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | validation, phase, dependency, optional, deferred | High |
| Circular dependencies detected | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | validation, phase, dependency, circular | High |
| Missing deferredReason | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | validation, deferred, deferredReason | High |
| Invalid idPattern format | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | validation, idPattern, placeholder | High |
| How to configure error guidance | [`PRD_FEATURES.md`](PRD_FEATURES.md) Section 17 | error, guidance, configuration | Medium |
| How to set up context files | [`PRD_FEATURES.md`](PRD_FEATURES.md) Section 16 | context, files, configuration | Medium |
| How to enable test generation | [`PRD_FEATURES.md`](PRD_FEATURES.md) Section 3 | test, generation, configuration | Medium |
| What features are available | [`PRD_FEATURES.md`](PRD_FEATURES.md) | features, guide, leverage | Low |

## Workflow → Documentation

| Workflow | Documentation Sequence | Purpose |
|----------|----------------------|---------|
| Create new PRD | [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) → [`PRD_SCHEMA.md`](PRD_SCHEMA.md) → [`PRD_FEATURES.md`](PRD_FEATURES.md) | Start with template, validate with schema, enhance with features |
| Validate existing PRD | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) → Run `dev-loop validate-prd` | Check against schema, fix errors |
| Configure advanced features | [`PRD_FEATURES.md`](PRD_FEATURES.md) → [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | Understand features, validate config |
| Debug validation errors | [`PRD_SCHEMA.md`](PRD_SCHEMA.md) → [`README.md`](README.md) | Understand errors, get troubleshooting help |
| Onboard as AI agent | [`README.md`](README.md) → [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) → [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | Learn basics, create first PRD, validate |

## Quick Reference by Type

### Reference Documents (Complete Reference Material)

| Document | Purpose | Load When |
|----------|---------|-----------|
| [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | Complete schema reference with validation rules | Validating or writing frontmatter |

### Guides (Step-by-Step Instructions)

| Document | Purpose | Load When |
|----------|---------|-----------|
| [`README.md`](README.md) | AI agent onboarding and PRD creation guide | Getting started |
| [`PRD_FEATURES.md`](PRD_FEATURES.md) | Comprehensive feature leverage guide | Configuring advanced features |

### Templates (Copy-Paste Starting Points)

| Document | Purpose | Load When |
|----------|---------|-----------|
| [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) | Complete PRD template with all sections | Creating new PRD |

## Quick Reference by Category

### PRD-Related Documentation

| Document | Type | Purpose |
|----------|------|---------|
| [`PRD_SCHEMA.md`](PRD_SCHEMA.md) | Reference | Schema and validation rules |
| [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) | Template | Starting point for PRDs |
| [`PRD_FEATURES.md`](PRD_FEATURES.md) | Guide | Feature leverage |
| [`README.md`](README.md) | Guide | AI agent onboarding |

### Features Documentation

| Document | Sections | Purpose |
|----------|----------|---------|
| [`PRD_FEATURES.md`](PRD_FEATURES.md) | All 17 sections | All dev-loop feature guides |

## Discovery Strategies

### 1. Index-Based Discovery

Start here when you know what task you're performing:
- Look up your task in "Task → Documentation" table
- Follow the recommended documentation
- Load prerequisites if listed

### 2. Metadata-Based Discovery

When you need to filter by type or category:
- Search for `type: reference` for complete reference material
- Search for `type: template` for copy-paste templates
- Filter by `category: prd` for PRD-specific docs
- Filter by `audience: ai` for AI-specific content

### 3. Keyword-Based Discovery

When searching by topic:
- Match task keywords to document keywords
- Use "Feature → Documentation Section" for feature-specific content
- Use "Problem → Solution" for troubleshooting

### 4. Workflow-Based Discovery

When following a specific workflow:
- Use "Workflow → Documentation" for sequential loading
- Load documents in the recommended order
- Each document links to related docs

## Metadata Fields Reference

All documentation files include YAML frontmatter with:

- `title` - Document title
- `type` - reference | guide | tutorial | template | index
- `category` - prd | cli | architecture | features | examples
- `audience` - ai | user | both
- `keywords` - Searchable keywords array
- `related_docs` - Related documentation paths
- `prerequisites` - Prerequisite documentation paths
- `estimated_read_time` - Minutes to read

See [`METADATA.md`](METADATA.md) for complete metadata system documentation.

## See Also

- [`README.md`](README.md) - AI agent onboarding guide
- [`PRD_SCHEMA.md`](PRD_SCHEMA.md) - Complete schema reference
- [`PRD_FEATURES.md`](PRD_FEATURES.md) - Feature leverage guide
- [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) - PRD template
- [`METADATA.md`](METADATA.md) - Metadata system documentation
