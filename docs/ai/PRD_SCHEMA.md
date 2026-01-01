# Dev-Loop PRD Frontmatter Schema v1.0

## Overview

This document defines the complete schema for dev-loop PRD frontmatter. The frontmatter uses YAML format and must appear at the very beginning of the PRD markdown file, delimited by `---` markers.

**Purpose**: Provide AI agents and developers with a complete reference for creating valid PRD frontmatter that dev-loop can process correctly.

**Reference Documents**:
- [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) - Copy-paste template
- [`PRD_FEATURES.md`](PRD_FEATURES.md) - Feature leverage guide

---

## Schema Structure

```yaml
---
# Dev-Loop PRD Metadata v1.0
prd: {...}
execution: {...}
dependencies: {...}
requirements: {...}
testing: {...}
[optional sections]
---
```

All sections except `prd`, `execution`, `requirements`, and `testing` are optional.

---

## Required Sections

### prd (Required)

Metadata about the PRD itself.

```yaml
prd:
  id: string          # Required: Unique identifier (alphanumeric, underscores, hyphens)
  version: string     # Required: Semantic version (e.g., "1.0.0")
  status: string      # Required: "ready" | "draft" | "deprecated"
```

**Examples:**
```yaml
prd:
  id: design_system
  version: 1.1.0
  status: ready
```

**Validation Rules:**
- `id` must be unique across all PRDs
- `version` should follow semantic versioning
- `status: ready` required for dev-loop execution

---

### execution (Required)

Execution strategy and limits.

```yaml
execution:
  strategy: string            # Required: "phased" (only supported value)
  waitForPrds: boolean        # Optional: Block until PRD dependencies complete (default: false)
  parallelism:
    testGeneration: integer   # Optional: Parallel test generation workers (default: 4)
    testExecution: integer    # Optional: Parallel test execution workers (default: 4)
  maxIterations: integer      # Optional: Maximum loop iterations (default: 100)
  timeoutMinutes: integer     # Optional: Overall timeout in minutes (default: 180)
```

**Examples:**
```yaml
execution:
  strategy: phased
  waitForPrds: true          # Wait for design_system_prd to complete
  parallelism:
    testGeneration: 4
    testExecution: 3
  maxIterations: 100
  timeoutMinutes: 180
```

**Validation Rules:**
- `strategy` must be "phased"
- `parallelism` values must be positive integers
- `maxIterations` and `timeoutMinutes` must be positive integers

---

### requirements (Required)

Task/requirement configuration and phase definitions.

```yaml
requirements:
  idPattern: string           # Required: Pattern for task IDs (e.g., "TASK-{id}" or "REQ-{id}")
  phases: array               # Required: Phase definitions (see Phase Schema below)
  dependencies: object        # Optional: Task dependency graph (see Dependencies below)
  resolveDependencies: boolean # Optional: Auto-resolve dependencies (default: false)
  statusTracking: object      # Optional: Completion tracking (see Status Tracking below)
  requirementPatterns: object # Optional: Categorization patterns (see Requirement Patterns below)
```

**Phase Schema:**

Each phase object:

```yaml
phases:
  - id: integer               # Required: Phase identifier (0-999)
    name: string              # Required: Phase display name
    parallel: boolean         # Optional: Allow parallel execution (default: false)
    dependsOn: array          # Optional: Array of phase IDs this phase depends on
    status: string            # Optional: "pending" | "complete" | "mostly_complete" | "deferred" | "optional" | "low_priority"
    deferredReason: string    # Required if status: "deferred" - explanation of why deferred
    note: string              # Optional: Additional notes or clarification
```

**Phase Status Values:**

| Status | Meaning | Dev-Loop Behavior |
|--------|---------|-------------------|
| `pending` | Default - not started | Will execute |
| `complete` | Fully implemented | Skip execution |
| `mostly_complete` | Mostly done, minor gaps | May skip or do minimal work |
| `deferred` | Blocked, manual fix needed | Skip entirely |
| `optional` | Enhancement, not required | Skip unless explicitly requested |
| `low_priority` | Low priority, can defer | Execute last or skip if time-constrained |

**Phase Dependency Rules:**

1. **No circular dependencies**: Phase A cannot depend on Phase B if B depends on A
2. **No dependencies on optional/deferred**: Phases cannot depend on phases with `status: optional` or `status: deferred`
3. **Valid phase IDs only**: All IDs in `dependsOn` must exist in phases array
4. **Sequential vs parallel**: Phases with `parallel: true` can run simultaneously after dependencies met

**Example:**
```yaml
requirements:
  idPattern: "TASK-{id}"
  phases:
    - id: 1
      name: "Foundation"
      parallel: false
    - id: 2
      name: "Feature A"
      parallel: false
      dependsOn: [1]
    - id: 3
      name: "Feature B"
      parallel: false
      dependsOn: [1]  # Can run parallel with Phase 2 after Phase 1
    - id: 7
      name: "Advanced Feature"
      parallel: false
      status: deferred
      deferredReason: "Requires manual API updates"
```

**Task Dependencies:**

Optional task-level dependency graph (separate from phase dependencies):

```yaml
requirements:
  dependencies:
    'TASK-101': ['TASK-102']  # Task 101 depends on Task 102
    'TASK-201': ['TASK-101', 'TASK-102']  # Task 201 depends on both
```

**Status Tracking:**

```yaml
requirements:
  statusTracking:
    enabled: boolean           # Optional: Enable status tracking (default: false)
    outputPath: string         # Optional: Path to status JSON file (default: '.devloop/prd-status.json')
    completedRequirements: array # Optional: List of completed task IDs
    partiallyCompleted: array   # Optional: List of partially completed task IDs
```

**Requirement Patterns:**

```yaml
requirements:
  requirementPatterns:
    core: string              # Regex pattern for core requirements
    bugFixes: string          # Regex pattern for bug fix tasks
    refactoring: string       # Regex pattern for refactoring tasks
    # ... custom patterns
```

---

### testing (Required)

Test configuration.

```yaml
testing:
  directory: string           # Required: Test file directory (relative to project root)
  framework: string           # Optional: "playwright" | "cypress" (default: "playwright")
  parallel: boolean           # Optional: Enable parallel execution (default: true)
  workers: integer            # Optional: Number of parallel workers (default: 4)
  bundledTests: boolean       # Optional: Include existing tests (default: false)
  cleanupArtifacts: boolean   # Optional: Clean up test artifacts (default: true)
```

**Examples:**
```yaml
testing:
  directory: tests/playwright/design-system/
  framework: playwright
  parallel: true
  workers: 4
  bundledTests: false
  cleanupArtifacts: true
```

---

## Optional Sections

### dependencies

External module and PRD dependencies.

```yaml
dependencies:
  externalModules: array      # Optional: Array of external module names
  prds: array                 # Optional: Array of PRD IDs this PRD depends on
```

**Examples:**
```yaml
dependencies:
  externalModules:
    - mcp
    - tool
    - ai_agents
  prds:
    - design_system_prd       # Must complete before this PRD runs
    - secret_prd
```

**How it works:**
- `externalModules`: Validated before PRD execution (module must be installed/enabled)
- `prds`: Combined with `execution.waitForPrds: true` to block until dependencies complete

---

### product

Product metadata and Schema.org markup.

```yaml
product:
  id: string                  # Optional: Product identifier (defaults to prd.id)
  version: string             # Optional: Product version (defaults to prd.version)
  status: string              # Optional: Product status (defaults to prd.status)
  schemaOrg: object           # Optional: Schema.org type definition
    type: string              # Schema.org type (e.g., "SoftwareSourceCode")
    additionalTypes: array    # Additional Schema.org types
    properties: object        # Type-specific properties
  metadata: object            # Optional: Additional metadata
    author: string
    created: string           # ISO 8601 date
    modified: string          # ISO 8601 date
    tags: array               # Array of tag strings
    category: string
```

**Examples:**
```yaml
product:
  id: design_system
  version: 1.1.0
  status: ready
  schemaOrg:
    type: SoftwareSourceCode
    additionalTypes:
      - CreativeWork
    properties:
      programmingLanguage: PHP
      runtimePlatform: Drupal 11
      applicationCategory: DesignSystem
  metadata:
    author: sysf
    created: 2025-01-15
    modified: 2025-01-20
    tags: [design-system, css, dom, drupal]
    category: ui-framework
```

---

### entityGeneration

Template for generating new entity types and bundles.

```yaml
entityGeneration:
  entityType: object          # Required if entityGeneration present
    id: string                # Entity type machine name
    label: string             # Human-readable label
    type: string              # "content" | "config"
    base: string              # Base template (e.g., "normalized_content")
    schemaOrg: object         # Optional: Schema.org mapping
  bundles: array              # Required if entityGeneration present
    - schemaName: string      # Schema name (for OpenAPI integration)
      bundleId: string        # Bundle machine name
      label: string           # Human-readable label
      schemaOrg: object       # Optional: Schema.org mapping
```

**Examples:**
```yaml
entityGeneration:
  entityType:
    id: dom_token
    label: "DOM Token"
    type: content
    base: normalized_content
    schemaOrg:
      type: PropertyValue
  bundles:
    - schemaName: ColorToken
      bundleId: color
      label: "Color"
      schemaOrg:
        type: PropertyValue
    - schemaName: SpacingToken
      bundleId: spacing
      label: "Spacing"
```

---

### schemaOrg

Schema.org mapping configuration for entities and properties.

```yaml
schemaOrg:
  namespace: string           # Optional: Schema.org namespace (default: "https://schema.org/")
  primaryType: string         # Optional: Primary Schema.org type
  strategy: string            # Optional: "manual" | "ai_assisted" (default: "manual")
  aiProvider: string          # Optional: AI provider for mapping (if strategy: "ai_assisted")
  typeMappings: object        # Optional: Entity type → Schema.org type mappings
  propertyMappings: object    # Optional: Field → Schema.org property mappings
```

**Examples:**
```yaml
schemaOrg:
  namespace: https://schema.org/
  primaryType: SoftwareSourceCode
  strategy: manual
  typeMappings:
    dom:
      type: CSSStyleDeclaration
      properties:
        name: label
        cssText: field_css
  propertyMappings:
    field_label: name
    field_description: description
```

---

### openapi

OpenAPI schema definitions for PRD-defined entities (used with OpenAPI Entity module).

```yaml
openapi:
  components: object          # Optional: OpenAPI components.schemas
    schemas: object           # Schema definitions
  schemasToImport: array      # Optional: List of schema names to import
  fieldTypeMapping: object    # Optional: OpenAPI type → Drupal field type mapping
```

**Examples:**
```yaml
openapi:
  components:
    schemas:
      McpResource:
        type: object
        properties:
          uri:
            type: string
            format: uri
  schemasToImport:
    - McpResource
  fieldTypeMapping:
    uri: link
    date-time: datetime
```

---

### validation

Validation rules and acceptance criteria.

```yaml
validation:
  criteriaFormat: string      # Optional: "gherkin" | "plain" (default: "plain")
  globalRules: array          # Optional: Global validation rules
    - rule: string            # Rule identifier
      description: string     # Rule description
      test: string            # Test command or assertion
  requirementTests: object    # Optional: Per-requirement tests
    'TASK-101':               # Task ID
      description: string
      acceptance: array       # Gherkin-style acceptance criteria
      assertions: array       # Playwright-style assertions
```

**Examples:**
```yaml
validation:
  criteriaFormat: gherkin
  globalRules:
    - rule: no_php_errors
      description: "No PHP errors in logs"
      test: "ddev logs -s web | grep -i 'PHP Fatal' | wc -l == 0"
  requirementTests:
    TASK-101:
      description: "DOM bundles have required fields"
      acceptance:
        - given: "The design_system module is enabled"
        - when: "I check DOM bundle field definitions"
        - then: "All 25 bundles have their required fields"
```

---

### relationships

PRD and entity relationship definitions.

```yaml
relationships:
  dependsOn: array            # Optional: PRDs this PRD depends on
  dependedOnBy: array         # Optional: PRDs that depend on this PRD
    - prd: string             # PRD ID
      features: array         # Features from this PRD they use
  relatedTo: array            # Optional: Related PRDs
    - prd: string
      relationship: string    # Relationship description
  entityRelationships: object # Optional: Entity type relationships
    entity_type_id:
      - targetType: string
        relationship: string
        cardinality: string   # "one_to_one" | "one_to_many" | "many_to_many"
```

**Examples:**
```yaml
relationships:
  dependsOn: []
  dependedOnBy:
    - prd: mcp_entity_bridge_prd
      features: [design_system_components]
  relatedTo:
    - prd: secret_prd
      relationship: references_for_api_keys
  entityRelationships:
    dom:
      - targetType: dom_token
        relationship: references_tokens
        cardinality: many_to_many
```

---

### config

Framework-specific and PRD-specific configuration that merges into `devloop.config.js`.

This is a free-form section where PRDs can define any configuration needed. Common patterns:

```yaml
config:
  framework: object           # Framework plugin configuration
    type: string              # Framework type (e.g., "drupal")
    rules: array              # Framework-specific rules (injected into AI prompts)
    errorGuidance: object     # Error pattern → fix instruction mappings
    taskPatterns: array       # Regex patterns for task detection
    identifierPatterns: array # Regex patterns for code search
    errorPathPatterns: array  # Regex patterns for extracting file paths from errors
    templatePath: string      # Custom task template path
  drupal: object              # Drupal-specific config (if framework.type: 'drupal')
    cacheCommand: string
    servicesPath: string
    schemaPath: string
    # ... other Drupal settings
  [prdId]: object             # PRD-specific configuration (e.g., designSystem, wizard)
    # Any PRD-specific settings
  contextFiles: object        # Context file management
    alwaysInclude: array      # Always-included file paths
    taskSpecific: object      # Task ID → file paths mapping
  testGeneration: object      # Test generation configuration
    imports: array
    setupPattern: string
    selectors: object
    template: string
    isolationRules: array
    antiPatterns: array
```

**Examples:**

See `.taskmaster/docs/DEV_LOOP_PRD_FEATURES.md` for comprehensive examples of config sections.

**Key Config Sections:**

1. **config.framework** - Framework plugin configuration
2. **config.drupal** - Drupal-specific settings
3. **config.[prdId]** - PRD-specific configuration (e.g., `config.designSystem`, `config.wizard`)
4. **config.contextFiles** - Context file management for AI agents
5. **config.testGeneration** - Auto-test generation settings

---

## Validation Rules

### Phase Dependency Validation

**Rule 1: No Circular Dependencies**
```yaml
# WRONG - Circular dependency
phases:
  - id: 1
    dependsOn: [2]
  - id: 2
    dependsOn: [1]  # ERROR: Circular

# CORRECT
phases:
  - id: 1
    dependsOn: []
  - id: 2
    dependsOn: [1]
```

**Rule 2: No Dependencies on Optional/Deferred Phases**
```yaml
# WRONG - Depends on optional phase
phases:
  - id: 0
    status: optional
  - id: 1
    dependsOn: [0]  # ERROR: Depends on optional phase

# CORRECT
phases:
  - id: 0
    status: optional
  - id: 1
    dependsOn: []  # No dependency on optional phase
```

**Rule 3: Valid Phase IDs Only**
```yaml
# WRONG - Invalid phase ID reference
phases:
  - id: 1
    dependsOn: [999]  # ERROR: Phase 999 doesn't exist

# CORRECT
phases:
  - id: 1
    dependsOn: []  # Or reference existing phase IDs only
```

**Rule 4: Deferred Phases Must Have deferredReason**
```yaml
# WRONG - Missing deferredReason
phases:
  - id: 7
    status: deferred
    # ERROR: deferredReason required when status: deferred

# CORRECT
phases:
  - id: 7
    status: deferred
    deferredReason: "Requires manual API updates for Drupal 11"
```

### Field Type Validation

| Field | Type | Required | Default | Allowed Values |
|-------|------|----------|---------|----------------|
| `prd.status` | string | Yes | - | `ready`, `draft`, `deprecated` |
| `execution.strategy` | string | Yes | - | `phased` |
| `requirements.idPattern` | string | Yes | - | Must contain `{id}` placeholder |
| `phase.id` | integer | Yes | - | 0-999 |
| `phase.parallel` | boolean | No | `false` | `true`, `false` |
| `phase.status` | string | No | `pending` | `pending`, `complete`, `mostly_complete`, `deferred`, `optional`, `low_priority` |
| `testing.framework` | string | No | `playwright` | `playwright`, `cypress` |
| `testing.parallel` | boolean | No | `true` | `true`, `false` |

---

## Common Mistakes

### Mistake 1: Phase Dependencies on Optional/Deferred Phases

**Error:**
```yaml
phases:
  - id: 0
    status: optional
  - id: 1
    dependsOn: [0]  # ❌ ERROR
```

**Fix:**
```yaml
phases:
  - id: 0
    status: optional
  - id: 1
    dependsOn: []  # ✅ No dependency on optional
```

### Mistake 2: Circular Dependencies

**Error:**
```yaml
phases:
  - id: 1
    dependsOn: [2]
  - id: 2
    dependsOn: [1]  # ❌ ERROR: Circular
```

**Fix:**
```yaml
phases:
  - id: 1
    dependsOn: []
  - id: 2
    dependsOn: [1]  # ✅ Linear dependency
```

### Mistake 3: Missing deferredReason for Deferred Phases

**Error:**
```yaml
phases:
  - id: 7
    status: deferred
    # ❌ ERROR: Missing deferredReason
```

**Fix:**
```yaml
phases:
  - id: 7
    status: deferred
    deferredReason: "Requires manual FieldWidget.php API fixes"  # ✅ Required
```

### Mistake 4: Invalid idPattern Format

**Error:**
```yaml
requirements:
  idPattern: "TASK"  # ❌ ERROR: Missing {id} placeholder
```

**Fix:**
```yaml
requirements:
  idPattern: "TASK-{id}"  # ✅ Contains {id} placeholder
```

### Mistake 5: Phase IDs Out of Order

**Note:** Phase IDs don't need to be sequential, but ordering logically helps readability.

```yaml
# Works, but confusing
phases:
  - id: 10
    name: "First Phase"
  - id: 1
    name: "Second Phase"
    dependsOn: [10]

# Better - sequential
phases:
  - id: 1
    name: "First Phase"
  - id: 2
    name: "Second Phase"
    dependsOn: [1]
```

---

## Schema Versioning

The schema version is indicated by the comment:

```yaml
---
# Dev-Loop PRD Metadata v1.0
```

When the schema changes:
- Update version number (e.g., v1.1)
- Document breaking changes
- Update this schema document
- Update template and examples

---

## Integration with devloop.config.js

PRD frontmatter `config` sections are **merged** into `devloop.config.js` at runtime:

1. Base config from `devloop.config.js`
2. Framework plugin default config
3. PRD `config.framework` (overrides framework defaults)
4. PRD `config.[prdId]` (PRD-specific config)
5. PRD `config.contextFiles` (context management)

See [`PRD_FEATURES.md`](PRD_FEATURES.md) for details on leveraging config sections.

---

## Quick Reference

### Minimal Valid PRD Frontmatter

```yaml
---
# Dev-Loop PRD Metadata v1.0
prd:
  id: my_feature
  version: 1.0.0
  status: ready

execution:
  strategy: phased

requirements:
  idPattern: "TASK-{id}"
  phases:
    - id: 1
      name: "Implementation"
      parallel: false

testing:
  directory: tests/playwright/my-feature/
---
```

### Full-Featured PRD Frontmatter

See [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) for complete template with all optional sections.

---

## Next Steps

1. **Create PRD**: Use [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) as starting point
2. **Leverage Features**: Read [`PRD_FEATURES.md`](PRD_FEATURES.md) for advanced configuration
3. **Validate**: Use `dev-loop validate-prd <prd-path>` to check frontmatter against this schema
4. **Activate**: Move PRD from `.taskmaster/planning/` to `.taskmaster/docs/` to enable dev-loop execution
