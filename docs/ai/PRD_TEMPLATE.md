---
title: "Dev-Loop PRD Template"
type: "template"
category: "prd"
audience: "both"
keywords: ["template", "prd", "frontmatter", "example", "copy-paste"]
related_docs:
  - "PRD_SCHEMA.md"
  - "PRD_FEATURES.md"
prerequisites:
  - "PRD_SCHEMA.md"
estimated_read_time: 20
---
# Dev-Loop PRD Template

This is a complete template for creating dev-loop PRDs. Copy this file and fill in the placeholders.

**Before using this template:**
1. Read [`PRD_SCHEMA.md`](PRD_SCHEMA.md) for schema reference
2. Consult [`PRD_FEATURES.md`](PRD_FEATURES.md) for leveraging advanced features
3. Review existing PRDs for examples

**Usage:**
1. Copy this file to your project's `.taskmaster/planning/[feature-name]_prd.md`
2. Fill in all `[PLACEHOLDER]` values
3. Remove optional sections you don't need
4. Validate frontmatter with `dev-loop validate-prd <prd-path>`
5. Move to `.taskmaster/docs/` when ready for dev-loop execution

---

```yaml
---
# Dev-Loop PRD Metadata v1.0
# REQUIRED: Metadata about the PRD
prd:
  id: [feature_name]                    # REQUIRED: Unique identifier (alphanumeric, underscores, hyphens)
  version: 1.0.0                        # REQUIRED: Semantic version
  status: ready                         # REQUIRED: "ready" | "draft" | "deprecated"

# REQUIRED: Execution strategy and limits
execution:
  strategy: phased                      # REQUIRED: Currently only "phased" supported
  waitForPrds: false                   # OPTIONAL: Block until PRD dependencies complete (default: false)
  parallelism:
    testGeneration: 4                  # OPTIONAL: Parallel test generation workers (default: 4)
    testExecution: 4                   # OPTIONAL: Parallel test execution workers (default: 4)
  maxIterations: 100                   # OPTIONAL: Maximum loop iterations (default: 100)
  timeoutMinutes: 180                  # OPTIONAL: Overall timeout in minutes (default: 180)

# OPTIONAL: External dependencies
dependencies:
  externalModules: []                  # OPTIONAL: Array of external module names (e.g., ['mcp', 'tool'])
  prds: []                             # OPTIONAL: Array of PRD IDs this PRD depends on (e.g., ['design_system_prd'])

# REQUIRED: Task/requirement configuration and phase definitions
requirements:
  idPattern: "TASK-{id}"               # REQUIRED: Pattern for task IDs (must contain {id} placeholder)
  
  # REQUIRED: Phase definitions - define execution order
  phases:
    # Phase 1: Foundation
    - id: 1
      name: "Foundation"                # REQUIRED: Human-readable phase name
      parallel: false                   # OPTIONAL: Allow parallel execution (default: false)
      # dependsOn: []                   # OPTIONAL: Array of phase IDs this phase depends on
      # status: pending                 # OPTIONAL: "pending" | "complete" | "mostly_complete" | "deferred" | "optional" | "low_priority"
      # note: "Optional note"           # OPTIONAL: Additional clarification
    
    # Phase 2: Core Feature
    - id: 2
      name: "Core Feature"
      parallel: false
      dependsOn: [1]                    # This phase runs after Phase 1
      # Add more phases as needed...
  
  # OPTIONAL: Task-level dependency graph (separate from phase dependencies)
  dependencies:
    # 'TASK-101': ['TASK-102']         # Task 101 depends on Task 102
  
  resolveDependencies: false           # OPTIONAL: Auto-resolve dependencies (default: false)
  
  # OPTIONAL: Status tracking for completed requirements
  statusTracking:
    enabled: false                     # OPTIONAL: Enable status tracking (default: false)
    outputPath: '.devloop/prd-status.json'  # OPTIONAL: Status file path
    completedRequirements: []          # OPTIONAL: List of completed task IDs
    partiallyCompleted: []             # OPTIONAL: List of partially completed task IDs
  
  # OPTIONAL: Requirement categorization patterns
  requirementPatterns:
    core: 'TASK-\\d+'                  # Regex pattern for core requirements
    # bugFixes: 'BUG-\\d+'             # Regex pattern for bug fixes
    # refactoring: 'REFACTOR-\\d+'     # Regex pattern for refactoring

# REQUIRED: Test configuration
testing:
  directory: tests/playwright/[feature-name]/  # REQUIRED: Test file directory
  framework: playwright                # OPTIONAL: "playwright" | "cypress" (default: "playwright")
  parallel: true                       # OPTIONAL: Enable parallel execution (default: true)
  workers: 4                           # OPTIONAL: Number of parallel workers (default: 4)
  bundledTests: false                  # OPTIONAL: Include existing tests (default: false)
  cleanupArtifacts: true               # OPTIONAL: Clean up test artifacts (default: true)

# OPTIONAL: Product metadata and Schema.org markup
product:
  id: [feature_name]                   # OPTIONAL: Product ID (defaults to prd.id)
  version: 1.0.0                       # OPTIONAL: Product version (defaults to prd.version)
  status: ready                        # OPTIONAL: Product status (defaults to prd.status)
  schemaOrg:
    type: SoftwareSourceCode           # Schema.org type
    additionalTypes:                   # Additional Schema.org types
      - CreativeWork
    properties:                        # Type-specific properties
      programmingLanguage: PHP
      runtimePlatform: Drupal 11
      applicationCategory: [Category]
  metadata:
    author: [author_name]
    created: 2025-01-20                # ISO 8601 date
    modified: 2025-01-20               # ISO 8601 date
    tags: [[tag1], [tag2]]             # Array of tag strings
    category: [category]

# OPTIONAL: Entity generation templates (for creating new entity types)
entityGeneration:
  entityType:
    id: [entity_type_id]               # Entity type machine name
    label: "[Entity Type Label]"       # Human-readable label
    type: content                      # "content" | "config"
    base: normalized_content           # Base template
    schemaOrg:                         # OPTIONAL: Schema.org mapping
      type: PropertyValue
  bundles:                             # Bundle definitions
    - schemaName: [SchemaName]
      bundleId: [bundle_id]
      label: "[Bundle Label]"
      schemaOrg:                       # OPTIONAL: Schema.org mapping
        type: PropertyValue

# OPTIONAL: Schema.org mapping configuration
schemaOrg:
  namespace: https://schema.org/       # OPTIONAL: Schema.org namespace
  primaryType: SoftwareSourceCode      # OPTIONAL: Primary Schema.org type
  strategy: manual                     # OPTIONAL: "manual" | "ai_assisted"
  aiProvider: openai                   # OPTIONAL: AI provider (if strategy: "ai_assisted")
  typeMappings:                        # OPTIONAL: Entity type → Schema.org type mappings
    [entity_type]:
      type: [SchemaOrgType]
      properties:
        [property]: [field_name]
  propertyMappings:                    # OPTIONAL: Field → Schema.org property mappings
    field_label: name
    field_description: description

# OPTIONAL: OpenAPI schema definitions (for OpenAPI Entity module integration)
openapi:
  components:                          # OPTIONAL: OpenAPI components.schemas
    schemas:
      [SchemaName]:
        type: object
        properties:
          [property]:
            type: [type]
  schemasToImport: []                  # OPTIONAL: List of schema names to import
  fieldTypeMapping:                    # OPTIONAL: OpenAPI type → Drupal field type
    uri: link
    date-time: datetime

# OPTIONAL: Validation rules and acceptance criteria
validation:
  criteriaFormat: gherkin              # OPTIONAL: "gherkin" | "plain" (default: "plain")
  globalRules:                         # OPTIONAL: Global validation rules
    - rule: no_php_errors
      description: "No PHP errors in logs"
      test: "ddev logs -s web | grep -i 'PHP Fatal' | wc -l == 0"
  requirementTests:                    # OPTIONAL: Per-requirement tests
    'TASK-101':
      description: "[Task description]"
      acceptance:                      # Gherkin-style acceptance criteria
        - given: "[Given condition]"
        - when: "[When action]"
        - then: "[Then result]"
      assertions:                      # Playwright-style assertions
        - selector: "[selector]"
          visible: true

# OPTIONAL: PRD and entity relationships
relationships:
  dependsOn: []                        # OPTIONAL: PRDs this PRD depends on
  dependedOnBy:                        # OPTIONAL: PRDs that depend on this PRD
    - prd: [prd_id]
      features: [[feature1], [feature2]]
  relatedTo:                           # OPTIONAL: Related PRDs
    - prd: [prd_id]
      relationship: "[relationship description]"
  entityRelationships:                 # OPTIONAL: Entity type relationships
    [entity_type]:
      - targetType: [target_entity_type]
        relationship: [relationship_type]
        cardinality: many_to_many      # "one_to_one" | "one_to_many" | "many_to_many"

# OPTIONAL: Framework-specific and PRD-specific configuration
# This section merges into devloop.config.js at runtime
# See DEV_LOOP_PRD_FEATURES.md for comprehensive examples
config:
  # Framework plugin configuration
  framework:
    type: drupal                       # Framework type (e.g., "drupal", "django", "react")
    rules:                             # Framework-specific rules (injected into AI prompts)
      - "[Rule 1]"
      - "[Rule 2]"
    errorGuidance:                     # Error pattern → fix instruction mappings
      '[ErrorPattern]': '[Fix instruction]'
    taskPatterns:                      # Regex patterns for task detection
      - '[pattern]'
    identifierPatterns:                # Regex patterns for code search
      - '\\b(hook_[a-z][a-z0-9_]+)\\b'
    errorPathPatterns:                 # Regex patterns for extracting file paths
      - '(docroot/[^\\s:]+\\.php)'
    templatePath: '.taskmaster/templates/drupal-task.md'  # OPTIONAL: Custom template path
  
  # Drupal-specific configuration (if framework.type: 'drupal')
  drupal:
    cacheCommand: 'ddev exec drush cr'
    servicesPath: 'docroot/modules/share/*/services.yml'
    schemaPath: 'docroot/modules/share/bd/config/schema/bd.schema.yml'
    # Add other Drupal-specific settings as needed
  
  # PRD-specific configuration (replace [feature_name] with your PRD ID)
  [feature_name]:
    testEntityId: 42                   # Example: Test entity ID
    validationUrls: ['/[feature]/test'] # Example: URLs to validate
  
  # Context file management for AI agents
  contextFiles:
    alwaysInclude:                     # Files always in context for all tasks
      - 'docroot/modules/share/[module]/src/[Service].php'
    taskSpecific:                      # Files only in context for specific tasks
      'TASK-101':
        - 'docroot/modules/share/[module]/src/[ReferenceClass].php'
  
  # Test generation configuration (auto-generate Playwright tests)
  testGeneration:
    imports:                           # Import statements for generated tests
      - "import { test, expect } from '@playwright/test';"
      - "import { AuthHelper } from '../helpers/auth';"
    setupPattern: |                    # Test setup boilerplate
      test.beforeEach(async ({ page, request }) => {
        const baseURL = 'https://sysf.ddev.site';
        const api = new DrupalAPI(request, baseURL);
        const auth = new AuthHelper(page, api);
        await auth.login();
      });
    selectors:                         # Selector documentation
      form: ['main form', 'form[data-drupal-selector*="[feature]"]']
      navigation:
        next: 'button:has-text("Next")'
    template: |                        # Test template with placeholders
      test('{{REQUIREMENT_ID}}: {{REQUIREMENT_TITLE}}', async ({ page }) => {
        {{TEST_BODY}}
      });
    isolationRules:                    # Test isolation rules
      - 'DO NOT create production data in tests'
      - 'Use unique names with timestamps: \'Test_\' + Date.now()'
    antiPatterns:                      # Common mistakes to avoid
      - '[Anti-pattern example]'

# OPTIONAL: Log analysis configuration (overrides devloop.config.js)
logs:
  sources:                             # Log sources
    - type: command                    # "command" | "file"
      command: 'ddev logs -s web --tail 100'
  patterns:                            # Error/warning patterns
    error: /Error|Exception|Fatal/i
    warning: /Warning|Deprecated/i
    [custom]: /[custom pattern]/i      # Custom pattern
  ignorePatterns:                      # Patterns to ignore (false positives)
    - 'benign.*warning'
  useAI: false                         # OPTIONAL: Use AI for log analysis (default: false)

# OPTIONAL: Lifecycle hooks (overrides devloop.config.js)
hooks:
  preTest:                             # Commands to run before tests
    - 'ddev exec drush cr'
  postApply:                           # Commands after code changes
    - 'ddev exec drush cr'

# OPTIONAL: Validation and smoke tests (overrides devloop.config.js)
validation:
  enabled: true                        # Enable runtime HTTP validation
  baseUrl: 'https://sysf.ddev.site'
  urls:                                # URLs to validate
    - '/[feature]/test'
  timeout: 15000                       # Timeout per request (milliseconds)
  authCommand: 'ddev exec drush uli'   # Command to get auth cookie

---
```

# [Feature Name] PRD

## Overview

[Brief description of what this PRD implements and why]

**Reference Documentation**: [Link to relevant docs]

**Test Reference**: Tests in `tests/playwright/[feature-name]/` serve as reference implementations.

**Related PRDs**:
- [prd_name.md](./prd_name.md) - Description of relationship

---

## Goals

1. **Goal 1**: [Specific, measurable objective]
2. **Goal 2**: [Specific, measurable objective]

---

## User Stories

1. **As a [role]**, I want [action] so that [benefit]

---

## Functional Requirements

### REQ-1: [Requirement Title]

[Description of requirement]

**Acceptance Criteria:**
- [ ] Criterion 1
- [ ] Criterion 2

**Implementation Details:**
- Files to modify: `[file paths]`
- Services to use: `[service names]`
- Configuration needed: `[config files]`

---

## Non-Goals (Out of Scope)

- [What this PRD will NOT include]

---

## Architecture Context

### Existing Code to Extend

- **[Service/Class Name]**: [What it does and how to extend it]
  - Location: `docroot/modules/share/[module]/src/[File].php`
  - Key methods: `[method1()]`, `[method2()]`

### Files to Modify

- `docroot/modules/share/[module]/[file].php` - [Purpose]
- `config/default/[config].yml` - [Purpose]

### Services to Use

- `[service.id]` - [Description]
- `[service.id]` - [Description]

---

## Technical Considerations

### Schema Changes

If config schema needs updates:
- Schema file: `docroot/modules/share/bd/config/schema/bd.schema.yml`
- New types: `[type definitions]`

### Plugin Types

If new plugins needed:
- Plugin type: `[plugin_type]`
- Base class: `EntityPluginBase`
- Annotation format: `@[PluginType](...)`

### Form Integration

- Use `config_schema_subform` for configuration
- Reference: `[existing form example]`

### Cache Clear Points

When `ddev exec bash -c "drush cr"` is required:
- After schema changes
- After new plugins

---

## Validation Criteria

### Playwright Tests

- Test file: `tests/playwright/[feature-name]/[test].spec.ts`
- Key flows: [List key user flows]

### Browser Validation Steps

1. Navigate to `/[url]`
2. Perform `[action]`
3. Verify `[result]`

### Success Metrics

- [Measurable outcome 1]
- [Measurable outcome 2]

---

## Open Questions

- [ ] Question 1
- [ ] Question 2

---

## Implementation Notes

[Any additional notes for dev-loop agents]

---

## References

- [Link to architecture docs]
- [Link to related PRDs]
- [Link to external documentation]
