---
title: "Dev-Loop PRD Frontmatter Schema v1.2"
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
# Dev-Loop PRD Frontmatter Schema v1.2

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
# Dev-Loop PRD Metadata v1.2
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
  status: string      # Required: "ready" | "draft" | "deprecated" | "split"
  parentPrd: string   # Optional: Parent PRD ID (for child PRDs in split PRD sets)
  prdSequence: integer # Optional: Sequence number in parent PRD (for child PRDs)
  note: string        # Optional: Additional notes or clarification
```

**Examples:**
```yaml
# Standalone PRD
prd:
  id: design_system
  version: 1.1.0
  status: ready

# Parent PRD (split into child PRDs)
prd:
  id: schema_processor_refactoring
  version: 1.0.0
  status: split
  note: "This PRD has been split into 5 phased PRDs. See sub-PRDs below."

# Child PRD (part of a split PRD set)
prd:
  id: schema_processor_schema_foundation
  version: 1.0.0
  status: ready
  parentPrd: schema_processor_refactoring
  prdSequence: 1
```

**Validation Rules:**
- `id` must be unique across all PRDs
- `version` should follow semantic versioning
- `status: ready` required for dev-loop execution
- `status: split` indicates parent PRD that has been split into child PRDs
- `parentPrd` must reference a valid PRD ID when present
- `prdSequence` must be a positive integer when present
- Child PRDs must have `parentPrd` and `prdSequence` set
- Parent PRD with `status: split` should have child PRDs listed in `relationships.dependedOnBy`

---

### execution (Required)

Execution strategy and limits.

```yaml
execution:
  strategy: string            # Required: "phased" (only supported value)
  mode: string                # Optional: "hybrid" | "autonomous" (default: "autonomous")
  waitForPrds: boolean        # Optional: Block until PRD dependencies complete (default: false)
  intervention: object        # Optional: Intervention rules for hybrid mode
    mode: string              # "hybrid" | "autonomous" | "manual"
    pauseOn: array            # Array of trigger strings (e.g., "schema-changes", "plugin-creation")
    autoApprove: array        # Array of auto-approved change types (e.g., "test-only", "documentation")
    riskyPatterns: array     # Array of file patterns requiring review
      - pattern: string       # File pattern (regex or glob)
        reason: string        # Explanation of why this pattern is risky
        requireReview: boolean # Whether to require manual review
  parallelism:
    testGeneration: integer   # Optional: Parallel test generation workers (default: 4)
    testExecution: integer    # Optional: Parallel test execution workers (default: 4)
    processorCreation: integer # Optional: Parallel processor creation workers (default: 1)
    taskExecution: integer    # Optional: Parallel task execution workers (default: 1)
  maxIterations: integer      # Optional: Maximum loop iterations (default: 100)
  timeoutMinutes: integer     # Optional: Overall timeout in minutes (default: 180)
  retry: object               # Optional: Retry configuration
    enabled: boolean          # Enable retry logic (default: false)
    maxRetries: integer       # Maximum number of retries (default: 3)
    retryOn: array            # Array of error types to retry on
      - string                # Error type (e.g., "test-timeout", "schema-validation-failure")
    backoff: string           # Backoff strategy: "exponential" | "linear" | "fixed" (default: "exponential")
  rollback: object            # Optional: Rollback configuration
    enabled: boolean          # Enable rollback (default: false)
    strategy: string          # Rollback strategy: "phase-level" | "task-level" | "checkpoint"
    checkpointOn: array       # Array of events to create checkpoints
      - string                # Event type (e.g., "phase-completion", "test-pass")
    restoreStrategy: string   # Restore strategy: "git-checkout" | "snapshot" | "manual"
```

**Examples:**
```yaml
execution:
  strategy: phased
  mode: hybrid
  waitForPrds: true
  intervention:
    mode: hybrid
    pauseOn:
      - schema-changes
      - plugin-creation
      - service-method-refactoring
    autoApprove:
      - test-only
      - documentation
      - code-comments
    riskyPatterns:
      - pattern: '\.schema\.yml$'
        reason: "Schema files affect configuration structure"
        requireReview: true
      - pattern: 'bd\.plugin_type\.yml'
        reason: "Plugin type definitions affect discovery"
        requireReview: true
  parallelism:
    testGeneration: 4
    testExecution: 4
    processorCreation: 1
    taskExecution: 1
  maxIterations: 150
  timeoutMinutes: 240
  retry:
    enabled: true
    maxRetries: 3
    retryOn:
      - test-timeout
      - schema-validation-failure
      - plugin-discovery-failure
    backoff: exponential
  rollback:
    enabled: true
    strategy: phase-level
    checkpointOn:
      - phase-completion
      - test-pass
      - schema-validation-pass
    restoreStrategy: git-checkout
```

**Validation Rules:**
- `strategy` must be "phased"
- `mode` must be "hybrid" or "autonomous"
- `intervention.mode` must be "hybrid", "autonomous", or "manual"
- `parallelism` values must be positive integers
- `maxIterations` and `timeoutMinutes` must be positive integers
- `retry.maxRetries` must be a positive integer
- `retry.backoff` must be "exponential", "linear", or "fixed"
- `rollback.strategy` must be "phase-level", "task-level", or "checkpoint"
- `rollback.restoreStrategy` must be "git-checkout", "snapshot", or "manual"

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
    file: string              # Optional: Path to phase detail file (for directory-based PRDs)
    checkpoint: boolean        # Optional: Enable checkpointing for this phase (default: false)
    validation: object         # Optional: Phase validation configuration
      after: array            # Array of completion triggers
        - string              # Trigger type (e.g., "schema-files-created", "plugin-types-created")
      tests: array            # Array of test commands
        - string              # Test command (e.g., "ddev exec bash -c 'drush cr'")
      assertions: array       # Array of assertion types
        - string              # Assertion type (e.g., "no-php-errors", "schema-validates")
    tasks: array              # Optional: Array of task objects with test specifications
      - id: string            # Task ID (must match idPattern)
        testSpec: object      # Test specification object
          type: string        # Test type (e.g., "playwright")
          file: string        # Test file path
          describe: string   # Test suite description
          cases: array        # Array of test cases
            - name: string    # Test case name
              steps: array    # Array of test steps
                - action: string  # Action type (e.g., "execute-php", "assert")
                  command: string # Command to execute (if action requires it)
                  type: string    # Assertion type (if action is "assert")
                  # ... other action-specific properties
          dataSetup: array    # Array of data setup requirements
            - type: string    # Data type (e.g., "config")
              path: string    # Path to data file
```

**Directory-Based PRDs:**

For large PRDs (5000+ lines), you can split into a directory structure:

```
.taskmaster/
├── planning/
│   └── mcp_entity_bridge/          # PRD directory
│       ├── README.md               # Main PRD (overview, phases, dependencies)
│       ├── phase-1-prerequisites.md
│       ├── phase-2-bridge-services.md
│       └── phase-3-third-party.md
└── docs/
    └── openapi_wizard_v4/          # Active PRD directory
        ├── README.md               # Main PRD
        └── phases/
            ├── phase-1.md
            └── phase-2.md
```

**Main PRD File (`README.md` in directory):**
- Contains frontmatter with phase definitions
- References phase files via `requirements.phases[].file` property
- Defines overall execution strategy, dependencies, testing config

**Phase Files:**
- Detailed requirements for that phase
- Can be edited independently
- Referenced by phase ID in main PRD

**PRD Path Detection:**
- If PRD path is a directory, look for `README.md` inside
- If PRD path is a file, use existing single-file behavior
- Task Master `parse-prd` command handles both formats

**Example Directory-Based PRD:**

```yaml
# .taskmaster/planning/mcp_entity_bridge/README.md
---
prd:
  id: mcp_entity_bridge
  version: 6.0.0
  status: ready

requirements:
  idPattern: "REQ-{id}"
  phases:
    - id: 1
      name: "Prerequisites"
      file: "phase-1-prerequisites.md"  # References phase detail file
      parallel: false
    - id: 2
      name: "Bridge Services"
      file: "phase-2-bridge-services.md"
      dependsOn: [1]
      parallel: false
---
```

The phase detail files contain the actual requirements for that phase.

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
      checkpoint: true
      validation:
        after:
          - schema-files-created
          - plugin-types-created
          - annotation-updated
        tests:
          - "ddev exec bash -c 'drush cr'"
          - "script/validate-schema.php"
        assertions:
          - no-php-errors
          - schema-validates
          - plugin-types-discoverable
      tasks:
        - id: "TASK-101"
          testSpec:
            type: "playwright"
            file: "tests/playwright/bd/entity-display-features.spec.ts"
            describe: "Schema Discovery Tests"
            cases:
              - name: "should discover schema processor plugin type after schema expansion"
                steps:
                  - action: "execute-php"
                    command: "ddev exec bash -c 'drush ev \"echo \\\\Drupal::service(\\\\\\\"plugin.manager.schema_processor\\\\\\\") ? \\\\\"OK\\\\\" : \\\\\"FAIL\\\\\";\"'"
                  - action: "assert"
                    type: "service-exists"
                    service: "plugin.manager.schema_processor"
            dataSetup: []
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
  timeout: integer            # Optional: Test timeout in milliseconds (default: 30000)
  retries: integer            # Optional: Number of test retries on failure (default: 0)
```

**Examples:**
```yaml
testing:
  directory: tests/playwright/bd/
  framework: playwright
  parallel: true
  workers: 4
  bundledTests: true
  cleanupArtifacts: true
  timeout: 300000
  retries: 2
```

---

## Optional Sections

### dependencies

External module and PRD dependencies.

```yaml
dependencies:
  externalModules: array      # Optional: Array of external module names
  prds: array                 # Optional: Array of PRD IDs or PRD objects this PRD depends on
  codeRequirements: array     # Optional: Array of code/file requirements
    - string                  # Requirement description (e.g., "bd module exists at docroot/modules/share/bd/")
```

**Simple PRD References (PRD IDs):**
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

**Detailed PRD References (with paths):**
```yaml
dependencies:
  prds:
    - id: mcp_entity_bridge_phase1
      path: .taskmaster/planning/mcp_entity_bridge/phase-1.md
      waitFor: true  # Block until this PRD completes
```

**Code Requirements:**
```yaml
dependencies:
  externalModules: []
  prds: []
  codeRequirements:
    - bd module exists at docroot/modules/share/bd/
    - SchemaProcessorManager exists at docroot/modules/share/bd/src/Plugin/SchemaProcessor/SchemaProcessorManager.php
    - ConfigSchemaSubform patterns understood from docroot/modules/share/bd/src/Element/ConfigSchemaSubform.php
    - Existing schema patterns in docroot/modules/share/*/config/schema/
```

**How it works:**
- `externalModules`: Validated before PRD execution (module must be installed/enabled)
- `prds`: Combined with `execution.waitForPrds: true` to block until dependencies complete
- `codeRequirements`: Validated before PRD execution (code/files must exist or be accessible)
- PRD references can be simple IDs (string) or detailed objects with `id`, `path`, and `waitFor` properties
- When using directory-based PRDs, reference the main `README.md` file or specific phase files
- Code requirements are checked at PRD validation time to ensure prerequisites are met

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
  prdSet: object              # Optional: PRD set coordination (for split PRDs)
    parentPrd: string         # Parent PRD ID (for child PRDs)
    childPrds: array          # Array of child PRD IDs with sequence numbers
      - id: string            # Child PRD ID
        sequence: integer     # Sequence number in parent PRD
    phaseCoordination: object # Phase validation across PRD set
      globalPhaseNumbering: boolean # Phases numbered globally across set (default: false)
      phaseValidation: object # Phase validation rules
        noOverlap: boolean    # Prevent phase ID overlap across PRDs (default: true)
        sequential: boolean   # Enforce sequential phase numbering (default: false)
        dependencyCrossPrd: boolean # Allow phase dependencies across PRDs (default: false)
```

**Examples:**
```yaml
# Standalone PRD
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

# Parent PRD (split into child PRDs)
relationships:
  dependsOn: []
  dependedOnBy:
    - prd: schema_processor_schema_foundation
      features: [schema_expansion, plugin_types]
    - prd: schema_processor_core_processors
      features: [entity_display_processors, field_feature_processors]
  prdSet:
    parentPrd: schema_processor_refactoring
    childPrds:
      - id: schema_processor_schema_foundation
        sequence: 1
      - id: schema_processor_core_processors
        sequence: 2
      - id: schema_processor_integration_1
        sequence: 3
    phaseCoordination:
      globalPhaseNumbering: true
      phaseValidation:
        noOverlap: true
        sequential: false
        dependencyCrossPrd: true

# Child PRD (part of a split PRD set)
relationships:
  dependsOn: []
  prdSet:
    parentPrd: schema_processor_refactoring
    phaseCoordination:
      globalPhaseNumbering: true
      phaseValidation:
        noOverlap: true
        dependencyCrossPrd: true
```

**Note:** The `relationships` section is the current implementation in dev-loop code. Both `PrdMetadata` interface and Zod schema use `relationships`.

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
  context: object             # Enhanced context providers
    codeContext: object      # Code context configuration
      requiredFiles: array   # Array of required file paths
      searchPatterns: array  # Array of search patterns for code discovery
      frameworkPatterns: array # Array of framework-specific patterns
    patternLearning: object  # Pattern learning configuration
      enabled: boolean        # Enable pattern learning (default: false)
      patternsPath: string   # Path to patterns JSON file
      learnFrom: array        # Array of sources to learn from
        - string             # Source type (e.g., "successful-schema-additions")
      injectGuidance: boolean # Inject learned patterns into AI prompts
    debugging: object         # Debugging strategy configuration
      strategy: string        # Debugging strategy (e.g., "framework-aware")
      framework: string       # Framework type for error classification
      errorClassification: array # Array of error type classifications
        - type: string       # Error type (e.g., "schema-validation-error")
          investigation: string # Investigation level (e.g., "required")
          suggestion: string # Suggested fix or investigation path
      rootCauseAnalysis: object # Root cause analysis configuration
        enabled: boolean      # Enable root cause analysis
        trackPartialFixes: boolean # Track partial fixes
        identifySystemicIssues: boolean # Identify systemic issues
  validation: object          # Validation gates configuration
    gates: array              # Array of validation gate objects
      - phase: integer        # Phase ID this gate applies to
        name: string          # Gate name/identifier
        tests: array          # Array of test commands
          - command: string   # Test command
            description: string # Test description
            expected: string  # Expected result (optional)
        assertions: array     # Array of assertion types
          - string           # Assertion type (e.g., "all-tests-pass", "no-php-errors")
  errorHandling: object       # Error handling configuration
    typeSpecific: object      # Type-specific error handling
      [errorType]: object     # Error type configuration
        retry: boolean        # Enable retry for this error type
        maxRetries: integer   # Maximum retries for this type
        diagnostics: array    # Diagnostic commands to run
  ai: object                  # AI configuration
    provider: string          # AI provider (e.g., "openai", "anthropic")
    contextInjection: object  # Context injection configuration
      enabled: boolean        # Enable context injection
      maxTokens: integer      # Maximum tokens for context
    customInstructions: string # Custom instructions for AI agents
  progress: object            # Progress tracking configuration
    tracking: boolean         # Enable progress tracking (default: false)
    metrics: object          # Metrics collection
      enabled: boolean       # Enable metrics collection
      path: string           # Path to metrics JSON file
      track: array          # Array of metrics to track
        - string            # Metric name (e.g., "tasksCompleted", "testsPassed")
    checkpoints: array       # Array of checkpoint configurations
      - phase: integer       # Phase ID for checkpoint
        name: string        # Checkpoint name
  integration: object         # Integration coordination
    prdDependencies: object  # PRD dependency tracking
      trackState: boolean    # Track state between PRDs
      statePath: string      # Path to state JSON file
    stateSharing: object     # State sharing configuration
      enabled: boolean       # Enable state sharing
      sharedKeys: array     # Array of state keys to share
  testGeneration: object      # Enhanced test generation configuration
    enabled: boolean          # Enable test generation (default: true)
    templates: object         # Test templates
      [templateName]: object # Template configuration
        file: string         # Template file path
        variables: array     # Array of template variables
    patterns: array           # Test generation patterns
      - match: string        # Pattern to match (regex)
        template: string     # Template name to use
        generateAfter: string # When to generate (e.g., "code-creation")
  testArtifacts: object       # Test artifact management
    cleanup: boolean         # Clean up artifacts after tests (default: true)
    preserve: array         # Array of artifact patterns to preserve
  testExecution: object       # Enhanced test execution configuration
    retryFailed: boolean     # Retry failed tests (default: false)
    maxRetries: integer      # Maximum retries for failed tests
    timeout: integer         # Test execution timeout (milliseconds)
  testCoverage: object        # Test coverage requirements
    required: boolean         # Require coverage thresholds (default: false)
    thresholds: object       # Coverage thresholds
      lines: integer         # Line coverage percentage
      functions: integer     # Function coverage percentage
      branches: integer     # Branch coverage percentage
    perPhase: array          # Per-phase coverage requirements
      - phase: integer       # Phase ID
        minTests: integer   # Minimum number of tests
        requiredScenarios: array # Array of required test scenarios
```

**Examples:**

**Example 1: Context Configuration**
```yaml
config:
  context:
    codeContext:
      requiredFiles:
        - docroot/modules/share/bd/src/Plugin/SchemaProcessor/SchemaProcessorManager.php
        - docroot/modules/share/bd/src/Element/ConfigSchemaSubform.php
        - docroot/modules/share/bd/config/schema/bd.schema.yml
      searchPatterns:
        - "schema_processor"
        - "SchemaProcessor"
        - "plugin.schema-processor"
      frameworkPatterns:
        - drupal-plugin-type
        - drupal-config-schema
        - drupal-service-injection
    patternLearning:
      enabled: true
      patternsPath: .devloop/patterns.json
      learnFrom:
        - successful-schema-additions
        - plugin-type-definitions
        - validation-patterns
      injectGuidance: true
    debugging:
      strategy: framework-aware
      framework: drupal
      errorClassification:
        - type: schema-validation-error
          investigation: required
          suggestion: "Check schema syntax and TypedConfigManager discovery"
        - type: plugin-discovery-error
          investigation: required
          suggestion: "Verify plugin_type.yml and annotation format"
      rootCauseAnalysis:
        enabled: true
        trackPartialFixes: true
        identifySystemicIssues: true
```

**Example 2: Validation Gates**
```yaml
config:
  validation:
    gates:
      - phase: 2
        name: "entity-display-processors-gate"
        tests:
          - command: "npm test -- entity-display-features.spec.ts"
            description: "Entity display processor tests"
          - command: "ddev logs -s web | grep -i 'PHP Fatal' | wc -l"
            expected: "0"
            description: "No PHP fatal errors"
        assertions:
          - all-processors-functional
          - no-php-errors
      - phase: 6
        name: "integration-test-gate"
        tests:
          - command: "npm test -- entity-display-features.spec.ts"
            description: "Entity display features tests"
          - command: "npm test -- field-features.spec.ts"
            description: "Field features tests"
        assertions:
          - all-tests-pass
          - no-regressions
```

**Example 3: Progress Tracking**
```yaml
config:
  progress:
    tracking: true
    metrics:
      enabled: true
      path: .devloop/metrics/schema_processor_schema_foundation.json
      track:
        - tasksCompleted
        - testsPassed
        - schemaFilesCreated
        - pluginTypesCreated
    checkpoints:
      - phase: 1
        name: "schema-foundation-checkpoint"
```

**Example 4: Test Coverage Requirements**
```yaml
config:
  testCoverage:
    required: true
    thresholds:
      lines: 90
      functions: 85
      branches: 80
    perPhase:
      - phase: 10
        minTests: 20
        requiredScenarios:
          - end-to-end-processor-chains
          - system-wide-validation
          - production-readiness
```

See `.taskmaster/docs/DEV_LOOP_PRD_FEATURES.md` for additional comprehensive examples of config sections.

**Key Config Sections:**

1. **config.framework** - Framework plugin configuration
2. **config.drupal** - Drupal-specific settings
3. **config.[prdId]** - PRD-specific configuration (e.g., `config.designSystem`, `config.wizard`)
4. **config.contextFiles** - Context file management for AI agents
5. **config.context** - Enhanced context providers (codeContext, patternLearning, debugging)
6. **config.validation** - Validation gates for phase-level validation
7. **config.errorHandling** - Type-specific error handling and retry logic
8. **config.ai** - AI provider settings and context injection
9. **config.progress** - Progress tracking and metrics collection
10. **config.integration** - PRD dependencies and state sharing
11. **config.testGeneration** - Enhanced test generation with templates and patterns
12. **config.testArtifacts** - Test artifact management
13. **config.testExecution** - Enhanced test execution configuration
14. **config.testCoverage** - Test coverage requirements and thresholds

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
| `prd.status` | string | Yes | - | `ready`, `draft`, `deprecated`, `split` |
| `prd.parentPrd` | string | No | - | Valid PRD ID (required for child PRDs) |
| `prd.prdSequence` | integer | No | - | Positive integer (required for child PRDs) |
| `execution.strategy` | string | Yes | - | `phased` |
| `execution.mode` | string | No | `autonomous` | `hybrid`, `autonomous` |
| `execution.intervention.mode` | string | No | - | `hybrid`, `autonomous`, `manual` |
| `execution.retry.backoff` | string | No | `exponential` | `exponential`, `linear`, `fixed` |
| `execution.rollback.strategy` | string | No | - | `phase-level`, `task-level`, `checkpoint` |
| `execution.rollback.restoreStrategy` | string | No | - | `git-checkout`, `snapshot`, `manual` |
| `requirements.idPattern` | string | Yes | - | Must contain `{id}` placeholder |
| `phase.id` | integer | Yes | - | 0-999 |
| `phase.parallel` | boolean | No | `false` | `true`, `false` |
| `phase.status` | string | No | `pending` | `pending`, `complete`, `mostly_complete`, `deferred`, `optional`, `low_priority` |
| `phase.checkpoint` | boolean | No | `false` | `true`, `false` |
| `testing.framework` | string | No | `playwright` | `playwright`, `cypress` |
| `testing.parallel` | boolean | No | `true` | `true`, `false` |
| `testing.timeout` | integer | No | `30000` | Positive integer (milliseconds) |
| `testing.retries` | integer | No | `0` | Non-negative integer |

### PRD Set Validation Rules

**Rule 1: Parent PRD Status**
- Parent PRD must have `status: "split"` when child PRDs exist
- Child PRDs must have `status: "ready"` or `status: "draft"` (not "split")

**Rule 2: Child PRD References**
- Child PRDs must reference valid parent PRD via `prd.parentPrd`
- Child PRDs must have `prd.prdSequence` set to a positive integer
- Parent PRD must list all child PRDs in `relationships.dependedOnBy` or `relationships.prdSet.childPrds`

**Rule 3: Phase ID Overlap (when globalPhaseNumbering: true)**
- Phase IDs must not overlap across PRD set
- Each phase ID must be unique across all PRDs in the set
- Example: If PRD 1 has Phase 1, PRD 2 cannot also have Phase 1

**Rule 4: Cross-PRD Phase Dependencies (when dependencyCrossPrd: true)**
- Phases can reference phases in other PRDs via `dependsOn`
- Referenced phases must exist in the PRD set
- Circular dependencies across PRDs are not allowed

**Rule 5: Execution Order**
- Execution order must respect PRD dependencies (`dependencies.prds`)
- Execution order must respect phase dependencies within and across PRDs
- Parallel execution must be validated for safety (no conflicts)

**Rule 6: Parallel Execution Validation**
- PRDs can run in parallel only if:
  - All their dependencies are satisfied
  - They don't conflict (no shared resources, no overlapping phases)
  - Parent PRD allows parallel execution

**Example PRD Set Validation:**
```yaml
# Parent PRD
prd:
  id: schema_processor_refactoring
  status: split  # ✅ Required for parent PRD

relationships:
  prdSet:
    childPrds:
      - id: schema_processor_schema_foundation
        sequence: 1
      - id: schema_processor_core_processors
        sequence: 2
    phaseCoordination:
      globalPhaseNumbering: true
      phaseValidation:
        noOverlap: true
        dependencyCrossPrd: true

# Child PRD 1
prd:
  id: schema_processor_schema_foundation
  status: ready  # ✅ Child PRD cannot be "split"
  parentPrd: schema_processor_refactoring  # ✅ References parent
  prdSequence: 1  # ✅ Sequence number matches parent's childPrds

requirements:
  phases:
    - id: 1  # ✅ Phase 1 - unique in set
      name: "Schema Expansion"

# Child PRD 2
prd:
  id: schema_processor_core_processors
  status: ready
  parentPrd: schema_processor_refactoring
  prdSequence: 2

dependencies:
  prds:
    - schema_processor_schema_foundation  # ✅ Depends on PRD 1

requirements:
  phases:
    - id: 2  # ✅ Phase 2 - unique in set, depends on Phase 1
      name: "Entity Display Processors"
      dependsOn: [1]  # ✅ Cross-PRD dependency allowed
```

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

### Mistake 6: Missing parentPrd for Child PRDs

**Error:**
```yaml
# Child PRD missing parent reference
prd:
  id: schema_processor_core_processors
  status: ready
  prdSequence: 2  # ❌ ERROR: Missing parentPrd
```

**Fix:**
```yaml
prd:
  id: schema_processor_core_processors
  status: ready
  parentPrd: schema_processor_refactoring  # ✅ Required for child PRDs
  prdSequence: 2
```

### Mistake 7: Parent PRD Not Marked as "split"

**Error:**
```yaml
# Parent PRD not marked as split
prd:
  id: schema_processor_refactoring
  status: ready  # ❌ ERROR: Should be "split" when child PRDs exist
```

**Fix:**
```yaml
prd:
  id: schema_processor_refactoring
  status: split  # ✅ Required when PRD is split into child PRDs
```

### Mistake 8: Phase ID Overlap in PRD Set

**Error:**
```yaml
# PRD 1
phases:
  - id: 1
    name: "Foundation"

# PRD 2 (in same set with globalPhaseNumbering: true)
phases:
  - id: 1  # ❌ ERROR: Phase ID overlaps with PRD 1
    name: "Core Processors"
```

**Fix:**
```yaml
# PRD 1
phases:
  - id: 1
    name: "Foundation"

# PRD 2
phases:
  - id: 2  # ✅ Unique phase ID
    name: "Core Processors"
    dependsOn: [1]  # ✅ Can reference Phase 1 from PRD 1 if dependencyCrossPrd: true
```

### Mistake 9: Incorrect Intervention Mode Configuration

**Error:**
```yaml
execution:
  mode: hybrid
  intervention:
    mode: autonomous  # ❌ ERROR: Inconsistent with execution.mode
    pauseOn: []  # No pause triggers but mode is hybrid
```

**Fix:**
```yaml
execution:
  mode: hybrid
  intervention:
    mode: hybrid  # ✅ Matches execution.mode
    pauseOn:
      - schema-changes
      - plugin-creation
    autoApprove:
      - test-only
      - documentation
```

### Mistake 10: Missing deferredReason for Deferred Phases

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
    deferredReason: "Requires manual API updates for Drupal 11"  # ✅ Required
```

### Guidance on Intervention Modes

**When to use `execution.mode: hybrid`:**
- Schema changes or critical infrastructure modifications
- Plugin type creation or major architectural changes
- Changes that affect multiple systems or require careful review
- High-risk changes that need human oversight

**When to use `execution.mode: autonomous`:**
- Test-only changes
- Documentation updates
- Code comments and formatting
- Low-risk feature additions
- Well-tested patterns and established workflows

**Intervention Configuration Best Practices:**
1. **Set `pauseOn` for risky operations**: Schema changes, plugin creation, service refactoring
2. **Set `autoApprove` for safe operations**: Test-only, documentation, code comments
3. **Use `riskyPatterns` for file-level protection**: Critical files that always need review
4. **Match `intervention.mode` to `execution.mode`**: Keep them consistent
5. **Start conservative**: Use hybrid mode for new PRDs, then relax as confidence grows

---

## Schema Versioning

The schema version is indicated by the comment:

```yaml
---
# Dev-Loop PRD Metadata v1.2
```

When the schema changes:
- Update version number (e.g., v1.3)
- Document breaking changes
- Update this schema document
- Update template and examples

### Migration from v1.0 to v1.2

**Breaking Changes:**
- Enhanced execution configuration (mode, intervention, retry, rollback)
- Enhanced PRD metadata (parentPrd, prdSequence, note)
- Enhanced dependencies (codeRequirements)
- Enhanced phase schema (checkpoint, validation, tasks with testSpec)
- Enhanced config sections (context, validation.gates, errorHandling, ai, progress, integration, testGeneration, testArtifacts, testExecution, testCoverage)
- Enhanced testing (timeout, retries)

**Migration Steps:**
1. Update frontmatter comment from `v1.0` to `v1.2`
2. Add new optional fields as needed for your PRD
3. No changes required for existing PRDs - v1.2 is backward compatible with v1.0

**Note:** The `relationships` section name remains unchanged in v1.2. The dev-loop codebase uses `relationships` in both the `PrdMetadata` interface and Zod schema.

---

## Hierarchical Configuration Overlays (v1.3)

Dev-loop supports a hierarchical configuration system where config can be defined at multiple levels and merged together. Later levels override earlier levels.

### Merge Hierarchy

```
Project Config (devloop.config.js)
    ↓ merge
Framework Config (framework section)
    ↓ merge
PRD Set Config (prd-set-config.json)
    ↓ merge
PRD Config (frontmatter config:)
    ↓ merge
Phase Config (phases[].config:)
    ↓
Effective Config (used for execution)
```

### ConfigOverlay Schema

At PRD set, PRD, and phase levels, configuration uses a flexible overlay schema that allows overriding any base config keys:

```yaml
# ConfigOverlay - can override any Config section
ai:
  provider: "cursor"  # Override AI provider
  model: "claude-sonnet-4-20250514"
testing:
  timeout: 300000     # Override test timeout
codebase:
  searchDirs:
    - "docroot/modules/share/my_module"  # Add to search dirs
framework:
  rules:
    - "Custom rule for this context"  # Add framework rules
```

### PRD Set Config

PRD sets can define config overlays that apply to all PRDs in the set.

**Location:** `.taskmaster/planning/{set-id}/prd-set-config.json` or `prd-set-config.yml`

**Example:**
```json
{
  "ai": {
    "model": "claude-sonnet-4-20250514"
  },
  "framework": {
    "rules": ["PRD set specific rule"]
  },
  "testing": {
    "timeout": 300000
  }
}
```

### PRD Config

PRDs can define config overlays in frontmatter:

```yaml
---
prd:
  id: my_prd
  version: 1.0.0
  status: ready

# Config overlay for this PRD
config:
  testing:
    timeout: 600000
  codebase:
    searchDirs:
      - "docroot/modules/share/my_module"
---
```

### Phase Config

Individual phases can define config overlays:

```yaml
requirements:
  phases:
    - id: 1
      name: "Phase 1"
      # Phase config overlay
      config:
        testing:
          timeout: 900000  # Longer timeout for this phase
        codebase:
          searchDirs:
            - "docroot/modules/share/phase1_module"
    - id: 2
      name: "Phase 2"
      config:
        ai:
          maxTokens: 16000  # More tokens for complex phase
```

### Array Merge Behavior

By default, arrays in overlays **replace** base arrays. However, certain arrays are **concatenated**:

| Array Path | Behavior | Description |
|------------|----------|-------------|
| `framework.rules` | Concatenate | Framework rules are appended |
| `codebase.searchDirs` | Concatenate | Search directories are appended |
| `codebase.excludeDirs` | Concatenate | Exclude directories are appended |
| `codebase.ignoreGlobs` | Concatenate | Ignore patterns are appended |
| `hooks.preTest` | Concatenate | Pre-test hooks are appended |
| `hooks.postApply` | Concatenate | Post-apply hooks are appended |
| All other arrays | Replace | Overlay value replaces base value |

### Use Cases

1. **Override AI model for a PRD set**: Different model for different projects
2. **Override test timeout for complex phases**: Some phases need longer timeouts
3. **Add search directories for specific phases**: Focus context on relevant code
4. **Add framework rules for specific PRDs**: PRD-specific guidance for AI

### Validation

Config overlays are validated against the ConfigOverlay schema. Unknown keys are allowed (via passthrough) but generate warnings for potential typos.

```bash
# Validate PRD config overlay
dev-loop validate-prd <prd-path>

# Validate config at specific level
dev-loop validate-config --level prd --prd <prd-path>
dev-loop validate-config --level prd-set --prd-set <set-id>
dev-loop validate-config --level phase --prd <prd-path> --phase <phase-id>
```

---

## Integration with devloop.config.js

PRD frontmatter `config` sections are **merged** into `devloop.config.js` at runtime using the hierarchical config merger:

1. Base config from `devloop.config.js` (strict schema validation)
2. Framework config (extracted from base, strict schema)
3. PRD Set config overlay (flexible, from `prd-set-config.json`)
4. PRD config overlay (flexible, from frontmatter `config:`)
5. Phase config overlay (flexible, from `requirements.phases[].config`)

Each level merges into the previous, with later levels overriding earlier values. See above for array merge behavior.

See [`PRD_FEATURES.md`](PRD_FEATURES.md) for details on leveraging config sections.

---

## Framework Configuration Pattern

Framework-specific configuration should use the `framework.config.{frameworkType}` pattern in `devloop.config.js`:

```javascript
// devloop.config.js
module.exports = {
  framework: {
    type: 'drupal',  // Framework type: 'drupal', 'react', 'django', etc.
    rules: [...],    // AI prompt rules
    taskPatterns: [...],
    errorGuidance: {...},
    
    // Framework-specific extensions go here
    config: {
      drupal: {
        enabled: true,
        ddevProject: 'my-project',
        cacheCommand: 'ddev exec drush cr',
        servicesPath: 'docroot/modules/share/*/services.yml',
        // ... other Drupal-specific config
      }
    }
  }
};
```

**Why this pattern?**
- Keeps dev-loop framework-agnostic
- Framework plugins can define their own config schemas
- Clear separation between core framework settings (`framework.type`, `framework.rules`) and framework-specific extensions (`framework.config.drupal`)

---

## Project-Specific Configuration

Project-specific schemas like `wizard` and `designSystem` should **not** be in `devloop.config.js`. They belong in PRD config overlays:

```yaml
# PRD frontmatter with project-specific config
---
prd:
  id: my_prd
  version: 1.0.0
  status: ready

config:
  # Project-specific wizard configuration
  wizard:
    baseUrl: '/admin/content/wizard/add/api_spec'
    steps:
      - { number: 1, name: 'Step 1', formMode: 'default' }
      - { number: 2, name: 'Step 2', formMode: 'step_2' }
    
  # Project-specific design system configuration  
  designSystem:
    themeEntity:
      testEntityId: 21
      tabs: ['Theme', 'Layout', 'Components']
---
```

Or use a PRD set config file:

```json
// .taskmaster/planning/{prd-set-id}/prd-set-config.json
{
  "wizard": {
    "baseUrl": "/admin/content/wizard/add/api_spec",
    "steps": [...]
  },
  "designSystem": {
    "themeEntity": {...}
  }
}
```

**Rationale:**
- Project-specific config doesn't belong in base dev-loop schemas
- Allows different projects to have different config structures
- Config overlays are validated but allow unknown keys for extensibility

---

## Quick Reference

### Minimal Valid PRD Frontmatter

```yaml
---
# Dev-Loop PRD Metadata v1.2
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

### Enhanced PRD Frontmatter with v1.2 Features

```yaml
---
# Dev-Loop PRD Metadata v1.2
prd:
  id: schema_processor_schema_foundation
  version: 1.0.0
  status: ready
  parentPrd: schema_processor_refactoring
  prdSequence: 1

execution:
  strategy: phased
  mode: hybrid
  intervention:
    mode: hybrid
    pauseOn:
      - schema-changes
      - plugin-creation
    autoApprove:
      - test-only
      - documentation
  parallelism:
    testGeneration: 4
    testExecution: 4
    processorCreation: 1
    taskExecution: 1
  retry:
    enabled: true
    maxRetries: 3
    retryOn:
      - test-timeout
      - schema-validation-failure
    backoff: exponential
  rollback:
    enabled: true
    strategy: phase-level
    checkpointOn:
      - phase-completion
      - test-pass

dependencies:
  externalModules: []
  prds: []
  codeRequirements:
    - bd module exists at docroot/modules/share/bd/
    - SchemaProcessorManager exists

requirements:
  idPattern: "TASK-{id}"
  phases:
    - id: 1
      name: "Schema Expansion"
      parallel: false
      checkpoint: true
      validation:
        after:
          - schema-files-created
          - plugin-types-created
        tests:
          - "ddev exec bash -c 'drush cr'"
        assertions:
          - no-php-errors
          - schema-validates
      tasks:
        - id: "TASK-101"
          testSpec:
            type: "playwright"
            file: "tests/playwright/bd/entity-display-features.spec.ts"
            describe: "Schema Discovery Tests"
            cases:
              - name: "should discover schema processor plugin type"
                steps:
                  - action: "execute-php"
                    command: "ddev exec bash -c 'drush ev \"...\"'"
                  - action: "assert"
                    type: "service-exists"
            dataSetup: []

testing:
  directory: tests/playwright/bd/
  framework: playwright
  parallel: true
  workers: 4
  timeout: 300000
  retries: 2

validation:
  globalRules:
    - rule: no_php_errors
      description: "No PHP fatal errors in logs"
      test: "ddev logs -s web | grep -i 'PHP Fatal' | wc -l == 0"

config:
  context:
    codeContext:
      requiredFiles:
        - docroot/modules/share/bd/src/Plugin/SchemaProcessor/SchemaProcessorManager.php
      searchPatterns:
        - "schema_processor"
    patternLearning:
      enabled: true
      patternsPath: .devloop/patterns.json
    debugging:
      strategy: framework-aware
      framework: drupal
  validation:
    gates:
      - phase: 1
        name: "schema-foundation-gate"
        tests:
          - command: "npm test -- entity-display-features.spec.ts"
            description: "Schema foundation tests"
        assertions:
          - all-tests-pass
          - no-php-errors
  progress:
    tracking: true
    metrics:
      enabled: true
      path: .devloop/metrics/schema_foundation.json
      track:
        - tasksCompleted
        - testsPassed

relationships:
  dependsOn: []
  prdSet:
    parentPrd: schema_processor_refactoring
    phaseCoordination:
      globalPhaseNumbering: true
      phaseValidation:
        noOverlap: true
        dependencyCrossPrd: true
---
```

### PRD Set Example (Parent and Child PRDs)

**Parent PRD:**
```yaml
---
# Dev-Loop PRD Metadata v1.2
prd:
  id: schema_processor_refactoring
  version: 1.0.0
  status: split
  note: "This PRD has been split into 5 phased PRDs."

execution:
  strategy: phased

relationships:
  dependedOnBy:
    - prd: schema_processor_schema_foundation
      features: [schema_expansion, plugin_types]
    - prd: schema_processor_core_processors
      features: [entity_display_processors]
  prdSet:
    childPrds:
      - id: schema_processor_schema_foundation
        sequence: 1
      - id: schema_processor_core_processors
        sequence: 2
    phaseCoordination:
      globalPhaseNumbering: true
      phaseValidation:
        noOverlap: true
        dependencyCrossPrd: true
---
```

**Child PRD:**
```yaml
---
# Dev-Loop PRD Metadata v1.2
prd:
  id: schema_processor_schema_foundation
  version: 1.0.0
  status: ready
  parentPrd: schema_processor_refactoring
  prdSequence: 1

execution:
  strategy: phased
  mode: hybrid

dependencies:
  prds: []

requirements:
  idPattern: "TASK-{id}"
  phases:
    - id: 1
      name: "Schema Expansion"
      parallel: false
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
