---
title: "Documentation Metadata System"
type: "reference"
category: "reference"
audience: "ai"
keywords: ["metadata", "frontmatter", "yaml", "autoloading", "discovery", "filtering"]
related_docs:
  - "INDEX.md"
  - "README.md"
prerequisites: []
estimated_read_time: 10
---
# Documentation Metadata System

Complete reference for the YAML frontmatter metadata system used in dev-loop documentation for AI agent autoloading and discovery.

## Overview

All dev-loop documentation files include YAML frontmatter metadata that enables:
- **Discovery**: AI agents can find relevant docs based on tasks, keywords, and categories
- **Filtering**: Context can be filtered to load only relevant documentation
- **Navigation**: Prerequisites and related docs create navigation paths
- **Prioritization**: Read time estimates help prioritize document loading

## Metadata Format

All documentation files start with YAML frontmatter delimited by `---` markers:

```yaml
---
title: "Document Title"
type: "reference"
category: "prd"
audience: "ai"
keywords: ["keyword1", "keyword2"]
related_docs:
  - "docs/ai/PRD_SCHEMA.md"
prerequisites:
  - "docs/ai/README.md"
estimated_read_time: 15
---

# Document Content Starts Here
```

## Field Definitions

### Required Fields

| Field | Type | Description | Allowed Values |
|-------|------|-------------|----------------|
| `title` | string | Document title | Any string |
| `type` | string | Document type | `reference`, `guide`, `tutorial`, `template`, `index` |
| `audience` | string | Target audience | `ai`, `user`, `both` |

### Optional Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `category` | string | Document category | None |
| `keywords` | array | Searchable keywords | `[]` |
| `related_docs` | array | Related documentation paths | `[]` |
| `prerequisites` | array | Prerequisite doc paths | `[]` |
| `estimated_read_time` | integer | Minutes to read | None |
| `contribution_mode` | boolean | Only autoload when in contribution mode | `false` |

## Type Definitions

### reference

Complete reference material for lookup and validation.

**Purpose**: Provide comprehensive reference information

**When to load**: For lookup, validation, or complete reference

**Examples**: `PRD_SCHEMA.md` (schema reference), future CLI command references

**Characteristics**:
- Comprehensive coverage of a topic
- Organized for quick lookup
- Used for validation and verification

### guide

Step-by-step guide with instructions and best practices.

**Purpose**: Walk through processes and workflows

**When to load**: When following step-by-step instructions

**Examples**: `PRD_FEATURES.md` (feature configuration guide), `README.md` (onboarding guide)

**Characteristics**:
- Sequential instructions
- Includes best practices
- May reference other docs

### tutorial

Learning-oriented tutorial with examples.

**Purpose**: Teach concepts through examples

**When to load**: When learning a new concept

**Examples**: (Future - tutorial on creating PRDs with examples)

**Characteristics**:
- Example-driven
- Progressive learning
- Interactive elements

### template

Copy-paste template with placeholders.

**Purpose**: Provide starting point for creation

**When to load**: When creating new artifacts

**Examples**: `PRD_TEMPLATE.md` (PRD creation template)

**Characteristics**:
- Placeholders for customization
- Inline documentation
- Complete structure

### index

Lookup tables and navigation aids.

**Purpose**: Help discover related documentation

**When to load**: For initial discovery and navigation

**Examples**: `INDEX.md` (documentation index)

**Characteristics**:
- Tables and mappings
- Quick lookup
- Multiple navigation paths

## Category Definitions

Categories help organize documentation by topic:

| Category | Purpose | Examples |
|----------|---------|----------|
| `prd` | PRD-related documentation | PRD_SCHEMA.md, PRD_TEMPLATE.md |
| `features` | Feature configuration guides | PRD_FEATURES.md |
| `cli` | CLI command documentation | (Future) |
| `architecture` | System architecture docs | (Future) |
| `examples` | Example PRDs and configurations | (Future) |
| `reference` | General reference material | INDEX.md, METADATA.md |

## Audience Definitions

Audience filtering ensures docs are only loaded for appropriate tasks:

| Audience | Purpose | Load When |
|----------|---------|-----------|
| `ai` | AI agent-specific documentation | AI agents performing tasks |
| `user` | Human user documentation | Human users using dev-loop |
| `both` | Documentation for all audiences | Any task that could involve either |

## Using Metadata for Discovery

### 1. Type-Based Discovery

Filter by document type based on task needs:

```yaml
# Load reference material for validation
type: reference

# Load guide for step-by-step process
type: guide

# Load template for creation
type: template
```

### 2. Category-Based Discovery

Filter by category to focus on specific topics:

```yaml
# PRD-related docs
category: prd

# Feature configuration
category: features

# CLI commands
category: cli
```

### 3. Keyword Matching

Match task keywords to document keywords:

```yaml
# Task: "configure error handling"
keywords: ["error", "guidance", "fix"]

# Task: "set up test generation"
keywords: ["test", "generation", "playwright"]
```

### 4. Audience Filtering

Only load docs appropriate for the current agent:

```yaml
# For AI agents
audience: ai
# or
audience: both

# For human users
audience: user
# or
audience: both
```

### 5. Contribution Mode Filtering

The `contribution_mode` field controls when contribution documentation is autoloaded:

```yaml
contribution_mode: true
```

**Behavior:**
- Only autoload docs with `contribution_mode: true` when explicitly in contribution mode
- Contribution mode is active when `.devloop/contribution-mode.json` exists and `active: true`
- Use this field for all documentation in `docs/contributing/`
- Do not load contribution docs when creating PRDs or using dev-loop

**When to use:**
- All documentation in `docs/contributing/` directory
- Any documentation specifically for contributing to dev-loop code

**When NOT to use:**
- PRD creation documentation (`docs/ai/`)
- User documentation (`docs/users/`)
- General dev-loop usage documentation

**Example:**
```yaml
---
title: "Contributing to Dev-Loop"
type: "guide"
category: "contributing"
audience: "both"
contribution_mode: true  # Only autoload in contribution mode
---
```

## Prerequisite Loading

The `prerequisites` field creates dependency chains:

```yaml
prerequisites:
  - "PRD_SCHEMA.md"
```

**Behavior:**
1. When loading a doc with prerequisites, load prerequisites first
2. Load prerequisites recursively (if they have prerequisites)
3. Prevent circular dependencies

**Example:**
- `PRD_TEMPLATE.md` has prerequisite `PRD_SCHEMA.md`
- When loading template → automatically load schema first
- Ensures agent has schema context before using template

## Related Documents

The `related_docs` field suggests additional reading:

```yaml
related_docs:
  - "PRD_FEATURES.md"
  - "PRD_SCHEMA.md"
```

**Purpose:**
- Suggest complementary documentation
- Not automatically loaded (unlike prerequisites)
- Useful for "See Also" sections

## Read Time Estimation

The `estimated_read_time` field helps prioritize:

```yaml
estimated_read_time: 15  # minutes
```

**Use Cases:**
- Quick lookups: Prioritize shorter docs (5-10 min)
- Deep dives: Load longer docs (30+ min) when needed
- Context management: Estimate total context size

## Metadata Examples

### Example 1: Reference Document

```yaml
---
title: "Dev-Loop PRD Frontmatter Schema v1.0"
type: "reference"
category: "prd"
audience: "both"
keywords: ["schema", "frontmatter", "validation", "yaml", "reference", "phase", "dependency"]
related_docs:
  - "PRD_TEMPLATE.md"
  - "PRD_FEATURES.md"
prerequisites: []
estimated_read_time: 30
---
```

**Characteristics:**
- `type: reference` - Complete reference material
- `audience: both` - Used by AI agents and humans
- `estimated_read_time: 30` - Comprehensive (long read)
- No prerequisites - Standalone reference

### Example 2: Guide Document

```yaml
---
title: "Dev-Loop PRD Feature Leverage Guide"
type: "guide"
category: "features"
audience: "both"
keywords: ["features", "error-guidance", "test-generation", "log-analysis"]
related_docs:
  - "PRD_SCHEMA.md"
  - "PRD_TEMPLATE.md"
prerequisites:
  - "PRD_SCHEMA.md"
estimated_read_time: 45
---
```

**Characteristics:**
- `type: guide` - Step-by-step instructions
- `prerequisites: [PRD_SCHEMA.md]` - Requires schema knowledge
- `estimated_read_time: 45` - Comprehensive guide
- Multiple related docs for cross-reference

### Example 3: Template Document

```yaml
---
title: "Dev-Loop PRD Template"
type: "template"
category: "prd"
audience: "both"
keywords: ["template", "prd", "frontmatter", "example"]
related_docs:
  - "PRD_SCHEMA.md"
  - "PRD_FEATURES.md"
prerequisites:
  - "PRD_SCHEMA.md"
estimated_read_time: 20
---
```

**Characteristics:**
- `type: template` - Copy-paste starting point
- `prerequisites: [PRD_SCHEMA.md]` - Need schema to use template correctly
- `estimated_read_time: 20` - Template review time

### Example 4: Index Document

```yaml
---
title: "Dev-Loop AI Documentation Index"
type: "index"
category: "reference"
audience: "ai"
keywords: ["index", "lookup", "reference", "discovery"]
related_docs:
  - "README.md"
  - "PRD_SCHEMA.md"
prerequisites: []
estimated_read_time: 5
---
```

**Characteristics:**
- `type: index` - Lookup tables
- `audience: ai` - AI-specific navigation aid
- `estimated_read_time: 5` - Quick lookup
- No prerequisites - Entry point document

## Discovery Workflows

### Workflow 1: Creating PRD

1. **Task**: "Create PRD for feature X"
2. **Discovery**: Check `INDEX.md` "Task → Documentation"
3. **Load**: `PRD_TEMPLATE.md` (type: template, priority: High)
4. **Check prerequisites**: `PRD_SCHEMA.md` → Load first
5. **Optional**: Load `PRD_FEATURES.md` for advanced configuration

**Metadata filters used:**
- `type: template` - Starting point
- `category: prd` - PRD-related
- Prerequisites chain loaded automatically

### Workflow 2: Validation Error

1. **Task**: Fix "phase dependency error"
2. **Discovery**: Check `INDEX.md` "Problem → Solution"
3. **Load**: `PRD_SCHEMA.md` (type: reference, keywords: validation)
4. **Filter**: Navigate to validation section

**Metadata filters used:**
- `type: reference` - Complete reference
- `keywords: ["validation"]` - Match error type

### Workflow 3: Feature Configuration

1. **Task**: "Configure error guidance"
2. **Discovery**: Check `INDEX.md` "Feature → Documentation"
3. **Load**: `PRD_FEATURES.md` Section 17 (type: guide, category: features)
4. **Filter**: Navigate to specific section

**Metadata filters used:**
- `type: guide` - Step-by-step
- `category: features` - Feature configuration
- `keywords: ["error", "guidance"]` - Match feature

## Best Practices

### For Document Authors

1. **Always include required fields**: title, type, audience
2. **Use descriptive keywords**: Include all relevant search terms
3. **Set prerequisites**: If doc requires knowledge from another doc
4. **Estimate read time**: Help with context prioritization
5. **Link related docs**: Enable cross-referencing
6. **Choose appropriate category**: For better organization

### For AI Agents

1. **Start with INDEX.md**: Fastest discovery path
2. **Filter by audience**: Only load `ai` or `both` for AI tasks
3. **Check prerequisites**: Load them first automatically
4. **Use type filtering**: Load `reference` for lookup, `guide` for process
5. **Match keywords**: Task keywords should match doc keywords
6. **Consider read time**: Prioritize shorter docs for quick lookups

## Metadata Validation

The metadata system is currently informal. Future enhancements could include:

- Schema validation for metadata frontmatter
- Automated prerequisite checking
- Keyword indexing for faster search
- Read time aggregation for context size estimation

## See Also

- [`INDEX.md`](INDEX.md) - Documentation lookup tables
- [`README.md`](README.md) - AI agent onboarding guide
- [`PRD_SCHEMA.md`](PRD_SCHEMA.md) - PRD frontmatter schema (different from doc metadata)
