---
title: "Dev-Loop PRD Feature Leverage Guide"
type: "guide"
category: "features"
audience: "both"
keywords: ["features", "error-guidance", "test-generation", "log-analysis", "context-files", "config", "hooks", "validation"]
related_docs:
  - "PRD_SCHEMA.md"
  - "PRD_TEMPLATE.md"
prerequisites:
  - "PRD_SCHEMA.md"
estimated_read_time: 45
---
# Dev-Loop PRD Feature Leverage Guide

## Overview

This guide shows how PRDs can leverage **ALL** dev-loop capabilities to maximize automation, reduce errors, and accelerate development. Each feature section includes examples from existing PRDs (design_system, openapi_wizard, mcp_entity_bridge).

**Audience**: AI agents creating PRDs, developers writing PRDs for dev-loop execution.

**Prerequisites**:
- Read [`PRD_SCHEMA.md`](PRD_SCHEMA.md) for schema reference
- Review [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) for template structure

---

## Table of Contents

1. [Framework Plugin Configuration](#1-framework-plugin-configuration)
2. [Pattern Learning System](#2-pattern-learning-system)
3. [Test Generation Features](#3-test-generation-features)
4. [Log Analysis Configuration](#4-log-analysis-configuration)
5. [Codebase Discovery](#5-codebase-discovery)
6. [PRD-Specific Configuration](#6-prd-specific-configuration)
7. [Requirement Management](#7-requirement-management)
8. [Intervention Modes](#8-intervention-modes)
9. [Evolution Mode Features](#9-evolution-mode-features)
10. [Hooks and Lifecycle](#10-hooks-and-lifecycle)
11. [Validation and Smoke Tests](#11-validation-and-smoke-tests)
12. [Metrics and Learning](#12-metrics-and-learning)
13. [Testing Configuration](#13-testing-configuration)
14. [Entity Generation Templates](#14-entity-generation-templates)
15. [Product Metadata](#15-product-metadata)
16. [Context File Management](#16-context-file-management)
17. [Error Guidance System](#17-error-guidance-system)

---

## 1. Framework Plugin Configuration

**Purpose**: Configure framework-specific behavior (Drupal, Django, React, etc.)

### Basic Configuration

In PRD frontmatter:

```yaml
config:
  framework:
    type: drupal                  # Framework type
    rules:                        # Framework-specific rules (injected into AI prompts)
      - "NEVER create custom PHP entity classes - use bd.entity_type.*.yml config"
      - "NEVER build custom Form API forms - use config_schema_subform"
      - "All changes in docroot/modules/share/ only"
    templatePath: '.taskmaster/templates/drupal-task.md'  # Custom task template
```

### Error Guidance (Critical Feature)

**Purpose**: Teach dev-loop how to fix common errors automatically.

```yaml
config:
  framework:
    errorGuidance:
      # Regex pattern → fix instruction mapping
      'PluginNotFoundException': 'Check plugin annotation syntax, verify deriver class, clear cache with drush cr'
      'Entity type .* does not exist': 'Check bd.entity_type.*.yml exists in config/default, run drush cr'
      'CSS file not found': 'Check Dom::postSave() is called, verify public://design-system/ is writable'
      'networkidle.*timeout': 'Replace waitForLoadState("networkidle") with waitForLoadState("domcontentloaded")'
      'Allowed memory size': 'Find infinite loop - DO NOT restart DDEV. Check ddev logs -s web for stack trace'
```

**How it works:**
1. Dev-loop analyzes logs after test failures
2. Matches error patterns using regex
3. Injects matching guidance into AI prompt
4. AI agent gets specific fix instructions
5. Reduces retry cycles significantly

**Best practices:**
- Use regex patterns for flexibility (match variations)
- Include exact commands to run (e.g., `drush cr`)
- Reference specific file paths when helpful
- Chain multiple guidance patterns for complex errors
- Update guidance as new error patterns emerge

**Real Example (design_system PRD):**
```yaml
config:
  framework:
    errorGuidance:
      'Service .* not found': 'Check service name in design_system.services.yml, verify class exists, run drush cr'
      'PluginNotFoundException': 'Check plugin annotation syntax, verify deriver class, clear cache with drush cr'
      'Plugin .* was not found': 'Plugin may be commented out. Check FieldWidget.php for Task 7.1'
```

### Task Patterns

**Purpose**: Help dev-loop detect Drupal-specific tasks.

```yaml
config:
  framework:
    taskPatterns:
      - 'docroot/modules'
      - '\\.php'
      - 'Drupal'
      - 'hook_'
      - 'drush'
```

These patterns help dev-loop understand when a task is framework-specific and apply appropriate templates/rules.

### Identifier Patterns

**Purpose**: Extract framework-specific identifiers (hooks, functions) for code search.

```yaml
config:
  framework:
    identifierPatterns:
      - '\\b(hook_[a-z][a-z0-9_]+)\\b'  # Drupal hooks
      - '\\b(_[a-z][a-z0-9_]+)\\b'       # Helper functions
```

Used by codebase discovery to find relevant files when tasks mention hooks or functions.

### Error Path Patterns

**Purpose**: Extract file paths from error messages.

```yaml
config:
  framework:
    errorPathPatterns:
      - '(docroot/[^\\s:]+\\.php)'       # Relative paths
      - '(/var/www/html/[^\\s:]+\\.php)' # Absolute paths (DDEV)
```

When errors mention file paths, these patterns extract them for context injection.

### Custom Framework Plugins

For projects with custom framework needs:

**Project-Local Plugin:**
```
.devloop/frameworks/[name]/plugin.json
```

**NPM Plugin:**
```bash
npm install @dev-loop/framework-[name]
```

See dev-loop README for FrameworkPlugin interface details.

---

## 2. Pattern Learning System

**Purpose**: Learn from successes/failures and improve future tasks automatically.

### How PRD Configs Feed Pattern Learning

PRD configurations influence pattern learning in multiple ways:

**1. Error Guidance → Learned Patterns**
- When errorGuidance successfully fixes errors
- Pattern stored in `.devloop/patterns.json`
- Future PRDs inherit pattern automatically

**2. Task Patterns → Framework Detection**
- Framework detection improves over time
- Learned patterns help classify tasks

**3. File Path Patterns → Code Discovery**
- Successful file discoveries improve search algorithms
- Patterns stored for future reference

**Example Pattern Evolution:**

```json
// .devloop/patterns.json
{
  "errorPatterns": {
    "PluginNotFoundException": {
      "fix": "Check plugin annotation syntax, verify deriver class, clear cache with drush cr",
      "source": "design_system_prd",
      "successCount": 5,
      "lastUsed": "2025-01-20"
    }
  }
}
```

**Configuration:**

```yaml
# In devloop.config.js (not PRD, but influences PRD execution)
patternLearning:
  enabled: true
  patternsPath: '.devloop/patterns.json'
  useBuiltinPatterns: true
```

**Leveraging Pattern Learning:**

PRDs don't directly configure pattern learning, but their errorGuidance entries become learned patterns over time. Include comprehensive errorGuidance to accelerate learning:

```yaml
config:
  framework:
    errorGuidance:
      # These patterns become learned and reusable
      '[Error Pattern 1]': '[Fix instruction]'
      '[Error Pattern 2]': '[Fix instruction]'
```

---

## 3. Test Generation Features

**Purpose**: Automatically generate Playwright tests from PRD requirements.

### Configuration in PRD Frontmatter

```yaml
config:
  testGeneration:
    imports:                           # Import statements for generated tests
      - "import { test, expect } from '@playwright/test';"
      - "import { AuthHelper } from '../helpers/auth';"
      - "import { DrupalAPI } from '../helpers/drupal-api';"
    
    setupPattern: |                    # Test setup boilerplate
      test.beforeEach(async ({ page, request }) => {
        const baseURL = 'https://sysf.ddev.site';
        const api = new DrupalAPI(request, baseURL);
        const auth = new AuthHelper(page, api);
        await auth.login();
      });
    
    selectors:                         # Selector documentation for AI
      form: ['main form', 'form[data-drupal-selector*="wizard"]']
      navigation:
        next: 'button:has-text("Next")'
        back: 'button:has-text("Back")'
      fields:
        wizardName: "page.getByRole('textbox', { name: 'Wizard name' })"
    
    template: |                        # Test template with placeholders
      test('{{REQUIREMENT_ID}}: {{REQUIREMENT_TITLE}}', async ({ page }) => {
        {{TEST_BODY}}
      });
    
    isolationRules:                    # Test isolation rules
      - 'DO NOT create production data in tests'
      - 'Use unique names with timestamps: \'Test_\' + Date.now()'
      - 'Tests should NOT depend on data created by other tests'
    
    antiPatterns:                      # Common mistakes to avoid
      - 'wizard.waitForWizardStep(page, 1) - WRONG: use wizard.waitForWizardStep(1)'
      - 'Using .wizard-form selector - WRONG: use "main form" selector'
    
    helperMethodSignatures:            # Helper method documentation
      'waitForWizardStep': 'waitForWizardStep(stepNumber: number) - uses this.page internally'
      'fillAceEditor': 'fillAceEditor(schema: string) - uses this.page internally'
```

### Configuration in devloop.config.js

```javascript
autonomous: {
  testGeneration: {
    framework: 'playwright',
    testDir: 'tests/playwright/auto',  // Where generated tests are saved
  }
}
```

### Test Generation Strategy

Dev-loop supports a **combined approach** to test generation that balances upfront planning with iterative refinement:

#### Strategy Options

```yaml
config:
  testGeneration:
    strategy: "combined"  # Options: "upfront" | "iterative" | "combined" (default: "combined")
    generateOnParse: true  # Generate test skeletons during PRD parsing (default: true)
    enhanceOnImplementation: true  # Update tests when tasks complete (default: true)
    evolutionInterval: 5  # Review tests every N iterations (default: 5)
```

**Strategy Modes:**

1. **`upfront`**: Generate all test skeletons during PRD parsing
   - Best for: Small PRDs, well-defined requirements
   - Creates complete test structure from day one
   - Tests initially marked as "pending" or "skip" until implementation

2. **`iterative`**: Generate tests only as tasks are implemented
   - Best for: Exploratory development, evolving requirements
   - Tests created when corresponding task is worked on
   - Allows tests to reflect actual implementation insights

3. **`combined`** (Recommended): Generate skeletons upfront, enhance iteratively
   - Best for: Large PRDs, complex features
   - Creates test structure during PRD parsing
   - Enhances tests as implementation progresses
   - Uses `evolutionInterval` to periodically review and improve tests

#### Combined Approach Workflow

1. **Initial PRD Parse**: Generate baseline test skeletons
   - Creates test file structure for all requirements
   - Tests use template with placeholders
   - Initially marked as "pending" or use `test.skip()`

2. **Task Implementation**: Activate and enhance tests
   - When task is implemented, corresponding test is activated
   - Test assertions refined based on actual implementation
   - New insights from implementation inform test updates

3. **Test Evolution**: Periodic review and improvement
   - Every `evolutionInterval` iterations, review test quality
   - Add edge cases discovered during implementation
   - Refine selectors and assertions based on actual behavior
   - Remove redundant or obsolete tests

4. **Failure-Driven Learning**: Test failures trigger refinement
   - Test failures reveal gaps in both code and tests
   - Both code fixes and test improvements are made
   - Patterns learned from failures improve future test generation

#### Benefits of Combined Approach

- **Upfront planning**: Test structure exists from day one, ensuring coverage
- **Iterative refinement**: Tests improve as understanding deepens
- **Failure-driven learning**: Test failures reveal gaps in both code and tests
- **Reduced rework**: Early test structure prevents major test rewrites later
- **Better coverage**: Periodic evolution ensures tests stay current with implementation

#### Phase-Based Generation

For very large PRDs (5000+ lines), consider generating tests per phase:

```yaml
config:
  testGeneration:
    strategy: "combined"
    generatePerPhase: true  # Generate tests when phase starts (default: false)
```

This prevents overwhelming the system with thousands of test files upfront.

### How Test Generation Works

1. AI agent analyzes PRD requirement
2. Uses template from `config.testGeneration.template`
3. Applies selectors from `config.testGeneration.selectors`
4. Follows isolation rules
5. Avoids anti-patterns
6. Generates test code matching helper method signatures
7. Saves to `testDir`
8. (If `strategy: combined`): Enhances tests as implementation progresses

### Real Example (openapi_wizard PRD)

The wizard PRD includes comprehensive test generation config:

```yaml
config:
  testGeneration:
    isolationRules:
      - 'DO NOT complete the wizard all the way through - this creates real entity types that persist and break the site'
      - 'Tests should VERIFY UI behavior without actually creating production data'
      - 'If a test must create entities, use UNIQUE names with timestamps: \'Test_\' + Date.now()'
      - 'CRITICAL: Failed tests leave orphaned entity types that crash the site! Always use test.afterEach cleanup.'
    
    antiPatterns:
      - 'wizard.waitForWizardStep(page, 1) - WRONG: page is NOT passed to methods'
      - 'Using api.deleteEntityType() - WRONG: method does not exist, use SQL DELETE'
```

**Leverage this for:**
- Standard CRUD workflows
- Form validation flows
- UI interaction patterns
- Regression test suites
- End-to-end feature validation

---

## 4. Log Analysis Configuration

**Purpose**: Configure how dev-loop analyzes logs for errors and warnings.

### Configuration in PRD Frontmatter (Overrides devloop.config.js)

```yaml
logs:
  sources:                             # Log sources
    - type: command                    # "command" | "file"
      command: 'ddev logs -s web --tail 100'
    # - type: file
    #   path: '/var/log/application.log'
  
  patterns:                            # Error/warning patterns
    error: /Error|Exception|Fatal|CRITICAL|PHP Fatal/i
    warning: /Warning|Deprecated/i
    [custom]: /[custom pattern]/i      # Custom pattern (e.g., designSystem, wizard)
  
  ignorePatterns:                      # Patterns to ignore (false positives)
    - 'views.ERROR.*non-existent config entity'  # Orphaned entities from previous tests
    - 'AI service may not be configured'         # Benign warnings
  
  useAI: false                         # OPTIONAL: Use AI for log analysis (default: false)
```

### How Log Analysis Works

1. **After each test run**, dev-loop collects logs from all sources
2. **Pattern matching**: Searches for error/warning patterns
3. **Filtering**: Removes ignored patterns (false positives)
4. **Classification**: Categorizes errors (syntax, runtime, plugin, etc.)
5. **Context injection**: Matches errors to errorGuidance
6. **Fix task creation**: If errors found, creates fix task with guidance

### Real Example (design_system PRD)

```yaml
logs:
  sources:
    - type: command
      command: 'ddev logs -s web --tail 100'
  patterns:
    error: /Error|Exception|Fatal|CRITICAL|PHP Fatal/i
    warning: /Warning|Deprecated|Notice/i
    designSystem: /design_system|Dom::|FieldWidget|EntityDisplay|Preprocess::/i
    memory: /memory.*exhausted|Allowed memory size/i
    plugin: /PluginNotFoundException|Plugin.*not found/i
  ignorePatterns:
    - 'views.ERROR.*non-existent config entity'
    - 'AI service may not be configured'
  useAI: true  # Enable AI-powered log analysis for complex issues
```

### AI-Powered Log Analysis

When `useAI: true`:
- AI analyzes log context beyond pattern matching
- Identifies root causes of complex errors
- Suggests multi-step fixes
- Useful for intermittent or complex errors

**When to enable:**
- Complex error patterns
- Intermittent failures
- Multi-step fixes required
- Pattern matching insufficient

---

## 5. Codebase Discovery

**Purpose**: Help dev-loop find relevant files when implementing tasks.

### Configuration in devloop.config.js (Project-Level)

```javascript
codebase: {
  extensions: ['php', 'module', 'inc', 'yml', 'yaml', 'ts'],
  searchDirs: [
    'docroot/modules/share/design_system',
    'docroot/modules/share/bd/src',
    'config/default'
  ],
  excludeDirs: ['node_modules', 'vendor', '.git', 'docroot/core'],
  ignoreGlobs: [
    '**/Test/**',              // PHPUnit tests
    '**/tests/src/**',         // Kernel/Unit tests
    '!**/tests/playwright/**'  // Don't ignore Playwright tests
  ],
  identifierStopwords: [       // Generic words to skip
    'File', 'Create', 'Update', 'Entity', 'Form', 'Field'
  ],
  filePathPatterns: [          # Regex for extracting paths from task descriptions
    '(docroot/[\\w./\\-]+\\.(?:php|module|yml))',
    '(config/default/[\\w./\\-]+\\.yml)'
  ]
}
```

### PRD Override (Optional)

PRDs can override codebase config for PRD-specific search:

```yaml
config:
  codebase:                        # Overrides devloop.config.js codebase section
    searchDirs:
      - 'docroot/modules/share/[module_name]'  # Prioritize module-specific dirs
    extensions: ['php', 'yml']     # Focus on specific file types
```

### How Codebase Discovery Works

1. **Task analysis**: Extracts identifiers (class names, function names, file paths)
2. **Stopword filtering**: Removes generic words
3. **Pattern matching**: Uses filePathPatterns to extract paths
4. **Directory search**: Searches searchDirs for matching files
5. **Context injection**: Includes discovered files in AI prompt

**Example:**
- Task: "Add method to DesignSystem.php"
- Discovery: Finds `docroot/modules/share/design_system/src/DesignSystem.php`
- Context: File included in AI prompt automatically

---

## 6. PRD-Specific Configuration

**Purpose**: Define PRD-specific settings that merge into devloop.config.js.

### Structure

PRD `config` sections are merged into `devloop.config.js` at runtime:

1. Base config from `devloop.config.js`
2. Framework plugin default config
3. PRD `config.framework` (overrides framework defaults)
4. PRD `config.[prdId]` (PRD-specific config)
5. PRD `config.contextFiles` (context management)
6. PRD `config.testGeneration` (test generation)

### Real Examples

**Example 1: Design System PRD**

```yaml
config:
  designSystem:
    themeEntity:
      testEntityId: 21
      editUrl: '/theme_entity/{id}/edit'
      tabs: ['Theme', 'Layout', 'Components', 'Elements', 'Colors', 'Fonts', 'Devices', 'Integrations']
    dom:
      expectedBundleCount: 25
      cssGeneration:
        outputDir: 'public://design-system/auto/dom/'
        filePattern: '{id}.css'
    testNode:
      id: 30
      url: '/node/30'
```

**Example 2: OpenAPI Wizard PRD**

```yaml
config:
  wizard:
    baseUrl: '/admin/content/wizard/add/api_spec'
    editUrlPattern: '/admin/content/wizard/{id}/edit'
    steps: [...]
    iefSelectors: {...}
    sampleSchemas: [...]
    hooks: {...}
    stepProcessing: {...}
```

### How PRD Configs Are Used

1. **Task context**: Config values available in AI prompts
2. **Test generation**: Config values used in test templates
3. **Validation**: Config values used in validation rules
4. **Error guidance**: Config values referenced in fix instructions

**Best Practice**: Use PRD-specific config for:
- Test entity IDs
- URLs to validate
- Module-specific constants
- Feature flags
- Test data requirements

---

## 7. Requirement Management

**Purpose**: Manage task dependencies, status tracking, and requirement categorization.

### Task Dependency Graph

**In PRD frontmatter:**

```yaml
requirements:
  idPattern: "TASK-{id}"
  dependencies:
    'TASK-101': ['TASK-102']         # Task 101 depends on Task 102
    'TASK-201': ['TASK-101', 'TASK-102']  # Task 201 depends on both
  resolveDependencies: true          # Auto-order tasks by dependencies
```

**How it works:**
1. Dev-loop reads dependency graph
2. Orders tasks topologically (dependencies first)
3. Executes in dependency order
4. Parallel execution when dependencies allow

### Status Tracking

**Purpose**: Track which requirements are complete or partially complete.

```yaml
requirements:
  statusTracking:
    enabled: true
    outputPath: '.devloop/prd-status.json'
    completedRequirements:
      - 'TASK-1'
      - 'TASK-2'
    partiallyCompleted:
      - 'TASK-5'  # Partially done, needs follow-up
```

**Status file structure:**
```json
{
  "prd": "design_system",
  "completed": ["TASK-1", "TASK-2"],
  "partial": ["TASK-5"],
  "pending": ["TASK-101", "TASK-102"],
  "lastUpdated": "2025-01-20T12:00:00Z"
}
```

### Requirement Patterns

**Purpose**: Categorize requirements for better organization.

```yaml
requirements:
  requirementPatterns:
    core: 'TASK-\\d+'                # Core requirements
    bugFixes: 'BUG-\\d+'             # Bug fixes
    refactoring: 'REFACTOR-\\d+'     # Refactoring tasks
    newIssues: 'NEW-\\w+-\\d+'       # New issue tasks
```

Used for:
- Task filtering
- Progress reporting
- Priority ordering

---

## 8. Intervention Modes

**Purpose**: Control whether AI agent requires human approval for changes.

### Configuration in devloop.config.js

```javascript
intervention: {
  mode: 'autonomous',        # 'autonomous' | 'review' | 'hybrid'
  approvalRequired: []       # Specific change types requiring approval
}
```

### Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| `autonomous` | Fully automated, no approval | Stable PRDs, trusted tasks |
| `review` | Human approves each change | Critical changes, learning phase |
| `hybrid` | Auto for safe, review for risky | Balanced approach |

### PRD Override (Future)

PRDs may specify intervention requirements per phase:

```yaml
execution:
  intervention:
    mode: hybrid
    riskyChanges: ['delete', 'schema-change', 'core-modification']
```

Currently, intervention mode is set globally in `devloop.config.js`, but PRDs can document preferred modes.

---

## 9. Evolution Mode Features

**Purpose**: Coordinate multiple PRDs executing in parallel with dependencies.

### PRD Dependencies

```yaml
dependencies:
  prds: ['design_system_prd', 'secret_prd']  # PRDs this PRD depends on

execution:
  waitForPrds: true  # Block until dependencies complete
```

**How it works:**
1. Dev-loop checks PRD dependencies
2. Waits for dependent PRDs to reach `status: complete`
3. Only then starts this PRD execution
4. Prevents execution order issues

### Real Example (mcp_entity_bridge PRD)

```yaml
dependencies:
  prds:
    - safe                   # secret_prd must be complete first

execution:
  waitForPrds: true          # Block until safe_prd complete
```

### Coordination Strategy

- **Independent PRDs**: Run in parallel
- **Dependent PRDs**: Execute sequentially
- **Shared resources**: Coordinate via PRD dependencies

---

## 10. Hooks and Lifecycle

**Purpose**: Execute commands at specific points in the dev-loop lifecycle.

### Configuration

**In PRD frontmatter (overrides devloop.config.js):**

```yaml
hooks:
  preTest:                    # Commands before each test run
    - 'ddev exec drush cr'
    - 'ddev exec drush updb -y'
  postApply:                  # Commands after code changes applied
    - 'ddev exec drush cr'
    - 'ddev exec drush php:eval "\\Drupal::service(\'cache_manager\')->clearAll()"'
```

### Hook Execution Order

1. Code changes applied
2. `postApply` hooks execute
3. Tests run
4. `preTest` hooks execute (before next iteration)

### Framework Lifecycle Hooks

Framework plugins can define lifecycle hooks:

- `onBeforeApply(changes)` - Modify changes before applying
- `onAfterApply(changes)` - Post-apply actions
- `onTestFailure(error)` - Custom failure handling

These are framework-level, not PRD-level, but PRDs can influence them via framework config.

### Real Example (design_system PRD)

```yaml
hooks:
  preTest: ['ddev exec bash -c "drush cr"']
  postApply: ['ddev exec bash -c "drush cr"]  # Clear cache after PHP changes
```

**Common use cases:**
- Cache clearing (Drupal: `drush cr`)
- Database migrations (`drush updb`)
- Service container rebuild
- Asset compilation

---

## 11. Validation and Smoke Tests

**Purpose**: Validate runtime behavior via HTTP requests after code changes.

### Configuration

**In PRD frontmatter (overrides devloop.config.js):**

```yaml
validation:
  enabled: true               # Enable runtime HTTP validation
  baseUrl: 'https://sysf.ddev.site'
  urls:                       # URLs to validate after changes
    - '/node/30'
    - '/theme_entity/21/edit'
  timeout: 15000              # Timeout per request (milliseconds)
  authCommand: 'ddev exec drush uli'  # Command to get auth cookie
```

### How Validation Works

1. After code changes applied
2. Get authentication cookie via `authCommand`
3. Request each URL with cookie
4. Check HTTP status (200 = success, 5xx = failure)
5. Create fix task if validation fails

### When to Use

**Enable validation when:**
- Changes affect page rendering
- API endpoints modified
- Authentication changes
- Critical user-facing features

**Disable validation when:**
- Backend-only changes
- Test-only changes
- Performance issues from validation
- Network connectivity problems

### Real Example

```yaml
validation:
  enabled: true
  baseUrl: 'https://sysf.ddev.site'
  urls:
    - '/admin/content/wizard/add/api_spec'  # Wizard creation page
  timeout: 15000
  authCommand: 'ddev exec drush uli --uri=https://sysf.ddev.site'
```

**Note**: Validation is temporarily disabled in sysf due to Node.js → DDEV container fetch issues. Use manual browser validation or Playwright tests instead.

---

## 12. Metrics and Learning

**Purpose**: Track execution metrics and learn from outcomes.

### Configuration in devloop.config.js

```javascript
metrics: {
  enabled: true,
  path: '.devloop/metrics.json'
}

patternLearning: {
  enabled: true,
  patternsPath: '.devloop/patterns.json',
  learnFromSuccess: true,
  learnFromFailure: true
}
```

### Metrics Collected

**Execution metrics:**
- Tasks completed/failed
- Retry counts
- Time per task
- Error patterns
- Success patterns

**Pattern learning:**
- Successful error fixes
- Effective code patterns
- Test generation patterns
- File discovery patterns

### How PRDs Influence Learning

PRD configurations feed into learning:

1. **Error guidance** → Learned error patterns
2. **Test generation** → Learned test patterns
3. **Codebase discovery** → Learned search patterns
4. **Context files** → Learned file relevance

**Example learning cycle:**
1. PRD includes errorGuidance for "PluginNotFoundException"
2. Dev-loop uses guidance successfully
3. Pattern stored in `.devloop/patterns.json`
4. Future PRDs automatically benefit from learned pattern

---

## 13. Testing Configuration

**Purpose**: Configure test execution parameters.

### Configuration in PRD Frontmatter

```yaml
testing:
  directory: tests/playwright/design-system/  # REQUIRED: Test directory
  framework: playwright                        # "playwright" | "cypress"
  parallel: true                               # Enable parallel execution
  workers: 4                                   # Number of parallel workers
  bundledTests: false                          # Include existing tests
  cleanupArtifacts: true                       # Clean up test artifacts
```

### Parallel Execution

**Benefits:**
- Faster test execution
- Better resource utilization

**Considerations:**
- Test isolation required
- Shared resources (database) need coordination
- Flaky tests harder to debug

### Bundled Tests

**When `bundledTests: true`:**
- Existing tests in directory included in test runs
- Useful for regression testing
- Ensure tests are compatible with generated code

**When `bundledTests: false`:**
- Only PRD-generated tests run
- Cleaner test output
- Faster execution

### Cleanup Artifacts

**When `cleanupArtifacts: true`:**
- Screenshots, videos, traces cleaned after successful runs
- Keeps disk usage low
- Preserves artifacts only for failures

---

## 14. Entity Generation Templates

**Purpose**: Define templates for generating new entity types and bundles.

### Configuration

```yaml
entityGeneration:
  entityType:
    id: dom_token
    label: "DOM Token"
    type: content                    # "content" | "config"
    base: normalized_content         # Base template
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

### How Entity Generation Works

1. AI agent reads entityGeneration config
2. Creates `bd.entity_type.[id].yml` config file
3. Creates bundle configs for each bundle
4. Registers entity type with Drupal
5. Creates fields based on schema mappings

### Schema.org Integration

Entity generation can include Schema.org type mappings for semantic markup:

```yaml
entityGeneration:
  entityType:
    schemaOrg:
      type: PropertyValue
      properties:
        name: label
        value: field_value
```

---

## 15. Product Metadata

**Purpose**: Add semantic metadata and Schema.org markup to PRD.

### Configuration

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

### Uses

- Documentation generation
- PRD indexing and search
- Integration with external tools
- Semantic web markup

---

## 16. Context File Management

**Purpose**: Ensure AI agents always have critical files in context.

### Configuration

```yaml
config:
  contextFiles:
    alwaysInclude:                    # Files always in context
      - 'docroot/modules/share/design_system/src/DesignSystem.php'
      - 'docroot/modules/share/bd/src/Plugin/EntityPluginBase.php'
      - 'docroot/modules/share/bd/src/Service/EntityHelper.php'
    
    taskSpecific:                     # Files only for specific tasks
      'TASK-701':
        - 'docroot/modules/share/design_system/src/Plugin/Block/FieldWidget.php'
        - 'docroot/modules/share/design_system/src/Plugin/Derivative/FieldWidgetDeriver.php'
      'TASK-201':
        - 'docroot/modules/share/design_system/src/EntityDisplay.php'
```

### How Context Files Work

1. **Always-included files**: Every AI prompt includes these files
   - Core service classes
   - Plugin base classes
   - Critical utility classes

2. **Task-specific files**: Only included for matching task IDs
   - Reference implementations
   - Task-specific examples
   - Related functionality

3. **Token efficiency**: Reduces token usage while ensuring critical patterns visible

### Best Practices

**Always include:**
- Core service classes used across many tasks
- Plugin base classes (e.g., `EntityPluginBase`)
- Common utility classes
- Architecture reference files

**Task-specific include:**
- Reference implementations for specific patterns
- Related functionality examples
- Complex utility classes used by few tasks

### Real Example (design_system PRD)

```yaml
config:
  designSystem:
    contextFiles:
      alwaysInclude:
        - 'docroot/modules/share/design_system/src/DesignSystem.php'
        - 'docroot/modules/share/design_system/src/EntityDisplay.php'
        - 'docroot/modules/share/design_system/src/Preprocess.php'
        - 'docroot/modules/share/design_system/src/Entity/Entity/Dom.php'
        - 'docroot/modules/share/bd/src/Plugin/EntityPluginBase.php'
      taskSpecific:
        '701':
          - 'docroot/modules/share/design_system/src/Plugin/Block/FieldWidget.php'
```

---

## 17. Error Guidance System

**Purpose**: Provide specific fix instructions for common errors.

### Comprehensive Error Guidance Example

```yaml
config:
  framework:
    errorGuidance:
      # Service errors
      'Service .* not found': 'Check service name in [module].services.yml, verify class exists, run drush cr'
      
      # Plugin errors
      'PluginNotFoundException': 'Check plugin annotation syntax, verify deriver class, clear cache with drush cr'
      'Plugin .* was not found': 'Plugin may be commented out. Check implementation file.'
      
      # Entity errors
      'Entity type .* does not exist': 'Check bd.entity_type.*.yml exists in config/default, run drush cr'
      'EntityMalformedException': 'Entity missing required ID. Check that entity type/bundle is saved before referencing.'
      
      # Path errors
      'dirname\\(DRUPAL_ROOT\\)': 'PATH ERROR: The etc/ folder is at PROJECT ROOT, not inside docroot/. Use dirname(DRUPAL_ROOT) not DRUPAL_ROOT.'
      '/docroot/etc/': 'PATH ERROR: The etc/ folder is at PROJECT ROOT, not inside docroot/.'
      
      # Playwright errors
      'page.fill.*name=': 'PLAYWRIGHT SELECTOR ERROR: Drupal forms use custom widgets. Use Playwright role selectors: page.getByRole("textbox", { name: "Field Label" }) instead of name-based selectors.'
      'networkidle.*timeout': 'Replace waitForLoadState("networkidle") with waitForLoadState("domcontentloaded")'
      
      # Memory errors
      'Allowed memory size': 'Find infinite loop - DO NOT restart DDEV. Check ddev logs -s web for stack trace'
      
      # Module-specific errors
      'feeds_item without bundle': 'FEED TYPE ERROR: Bundle must be explicitly set in processor_configuration.values.bundle.'
      'ace_editor': 'ACE EDITOR: Use page.evaluate() to set value via ace.edit().setValue().'
```

### Error Guidance Best Practices

1. **Use regex patterns**: Match error variations
   ```yaml
   'Plugin.*not found': '[Fix]'  # Matches "PluginNotFoundException" and "Plugin X was not found"
   ```

2. **Include exact commands**: Provide runnable commands
   ```yaml
   'Service .* not found': 'Check service name, run drush cr'
   ```

3. **Reference specific files**: When helpful, include file paths
   ```yaml
   'CSS file not found': 'Check Dom::postSave() in docroot/modules/share/design_system/src/Entity/Entity/Dom.php'
   ```

4. **Chain guidance**: For complex errors, provide step-by-step
   ```yaml
   'PluginNotFoundException': |
      Step 1: Check plugin annotation syntax
      Step 2: Verify deriver class exists
      Step 3: Run drush cr
   ```

5. **Update iteratively**: Add new patterns as errors are discovered

---

## Feature Interaction Patterns

### Pattern 1: Error Guidance + Log Analysis

**Synergy:**
- Log analysis finds errors
- Error guidance provides fixes
- Combined: Automatic error detection and fixing

**Example:**
```yaml
logs:
  patterns:
    error: /PluginNotFoundException/i
config:
  framework:
    errorGuidance:
      'PluginNotFoundException': 'Check plugin annotation, run drush cr'
```

**Result**: When PluginNotFoundException appears in logs, AI gets specific fix instruction automatically.

### Pattern 2: Test Generation + Context Files

**Synergy:**
- Context files provide helper class examples
- Test generation uses helper method signatures
- Combined: Generated tests use correct helper APIs

**Example:**
```yaml
config:
  contextFiles:
    alwaysInclude:
      - 'tests/playwright/helpers/wizard-helper.ts'
  testGeneration:
    helperMethodSignatures:
      'waitForWizardStep': 'waitForWizardStep(stepNumber: number)'
```

**Result**: Generated tests correctly use helper methods because helper file is in context.

### Pattern 3: Codebase Discovery + Task Patterns

**Synergy:**
- Task patterns identify framework-specific tasks
- Codebase discovery finds relevant files
- Combined: AI has right context for framework-specific tasks

**Example:**
```yaml
config:
  framework:
    taskPatterns: ['docroot/modules', 'Drupal']
codebase:
  searchDirs: ['docroot/modules/share']
```

**Result**: Drupal tasks automatically get Drupal-specific file context.

---

## Complete Feature Leverage Example

Here's a complete example showing maximum feature leverage:

```yaml
---
# Dev-Loop PRD Metadata v1.0
prd:
  id: comprehensive_example
  version: 1.0.0
  status: ready

execution:
  strategy: phased
  waitForPrds: true              # ← Leverage: PRD dependencies
  parallelism:
    testGeneration: 4
    testExecution: 4
  maxIterations: 100
  timeoutMinutes: 180

dependencies:
  externalModules: ['mcp', 'tool']
  prds: ['design_system_prd']     # ← Leverage: PRD coordination

requirements:
  idPattern: "TASK-{id}"
  phases: [...]
  dependencies:                   # ← Leverage: Auto-dependency resolution
    'TASK-101': ['TASK-102']
  resolveDependencies: true
  statusTracking:                 # ← Leverage: Completion tracking
    enabled: true
    outputPath: '.devloop/example-status.json'
    completedRequirements: []

testing:
  directory: tests/playwright/example/
  framework: playwright
  parallel: true
  workers: 4

config:
  framework:                      # ← Leverage: Framework plugin
    type: drupal
    rules: [...]
    errorGuidance: {...}          # ← Leverage: Auto-error fixing
    taskPatterns: [...]
    identifierPatterns: [...]
    errorPathPatterns: [...]
  
  comprehensive_example:          # ← Leverage: PRD-specific config
    testEntityId: 42
    validationUrls: ['/example/test']
  
  contextFiles:                   # ← Leverage: Context management
    alwaysInclude: [...]
    taskSpecific: {...}
  
  testGeneration:                 # ← Leverage: Auto-test generation
    imports: [...]
    selectors: {...}
    template: "..."
    isolationRules: [...]

logs:                             # ← Leverage: Log analysis
  sources:
    - type: command
      command: 'ddev logs -s web --tail 100'
  patterns:
    error: /Error|Exception/i
    example: /example|Example/i    # Custom pattern
  ignorePatterns: [...]
  useAI: true                     # ← Leverage: AI log analysis

hooks:                            # ← Leverage: Lifecycle hooks
  preTest: ['ddev exec drush cr']
  postApply: ['ddev exec drush cr']

validation:                       # ← Leverage: Smoke tests
  enabled: true
  baseUrl: 'https://sysf.ddev.site'
  urls: ['/example/test']
  authCommand: 'ddev exec drush uli'

product:                          # ← Leverage: Product metadata
  schemaOrg:
    type: SoftwareSourceCode
  metadata:
    tags: ['example']
---
```

---

## Quick Reference: Feature Checklist

When creating a PRD, consider leveraging these features:

- [ ] **Error Guidance**: Add errorGuidance mappings for common errors
- [ ] **Context Files**: Define alwaysInclude and taskSpecific files
- [ ] **Test Generation**: Configure test templates and selectors
- [ ] **Log Patterns**: Define custom log patterns for your PRD
- [ ] **Hooks**: Add preTest/postApply commands
- [ ] **PRD Dependencies**: Specify dependencies.prds if needed
- [ ] **Status Tracking**: Enable statusTracking for progress monitoring
- [ ] **Task Dependencies**: Define requirement dependencies graph
- [ ] **Validation**: Enable validation if testing runtime behavior
- [ ] **PRD-Specific Config**: Add config.[prdId] for PRD-specific settings

---

## Next Steps

1. **Read Schema**: [`PRD_SCHEMA.md`](PRD_SCHEMA.md)
2. **Use Template**: [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md)
3. **Leverage Features**: Reference this guide for each feature section
4. **Review Examples**: Check existing PRDs in your project for examples
5. **Validate**: Use `dev-loop validate-prd <prd-path>` to ensure frontmatter follows schema before activating

---

## Additional Resources

- Dev-Loop README: `node_modules/dev-loop/README.md`
- Existing PRD Examples:
  - `design_system_prd.md` - Comprehensive config example
  - `openapi_wizard_v4.md` - Test generation example
  - `mcp_entity_bridge_prd.md` - PRD dependencies example
