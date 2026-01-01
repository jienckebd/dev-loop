# Dev-Loop AI Agent Guide

Complete guide for AI agents creating PRDs and leveraging dev-loop capabilities.

## Overview

Dev-loop transforms PRDs into validated code through autonomous execution. This guide helps AI agents create effective PRDs that leverage all dev-loop features.

## Quick Start

1. **Read this guide** to understand dev-loop's capabilities
2. **Use the PRD template** as a starting point
3. **Reference the schema** to ensure valid frontmatter
4. **Validate your PRD** before activation

## Documentation Structure

All PRD documentation is in this directory (`docs/ai/`):

- [`PRD_SCHEMA.md`](PRD_SCHEMA.md) - Complete schema reference with validation rules, field definitions, and phase dependency guidelines
- [`PRD_FEATURES.md`](PRD_FEATURES.md) - Comprehensive guide showing how PRDs can leverage ALL 17 dev-loop features with examples and best practices
- [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) - Copy-paste template with all optional sections and inline documentation

## Creating Valid PRDs

### Step 1: Use the Template

Start with [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md). It includes:
- All required fields with inline comments
- All optional sections with explanations
- Placeholders for easy replacement
- Links to detailed documentation

### Step 2: Reference the Schema

When writing frontmatter, consult [`PRD_SCHEMA.md`](PRD_SCHEMA.md) for:
- Required vs optional fields
- Valid field values and types
- Phase dependency rules
- Common mistakes to avoid

### Step 3: Leverage Features

Read [`PRD_FEATURES.md`](PRD_FEATURES.md) to understand how to:
- Configure error guidance for automatic error fixing
- Set up context files for AI agents
- Enable test generation
- Configure log analysis patterns
- And 13+ more features

### Step 4: Validate

Use the validation command before activating PRDs:

```bash
dev-loop validate-prd <prd-path>
```

This checks:
- Required fields present
- Phase dependencies valid (no circular, no optional/deferred deps)
- Field types correct
- Status values valid
- idPattern format correct

## Key Concepts

### Phase Dependencies

Phases define execution order. Key rules:
- No circular dependencies
- Cannot depend on phases with `status: optional` or `status: deferred`
- All referenced phase IDs must exist

### Error Guidance

Configure `config.framework.errorGuidance` to teach dev-loop how to fix common errors automatically:

```yaml
config:
  framework:
    errorGuidance:
      'PluginNotFoundException': 'Check plugin annotation syntax, verify deriver class, clear cache with drush cr'
```

### Context Files

Ensure AI agents have critical files in context:

```yaml
config:
  contextFiles:
    alwaysInclude:
      - 'docroot/modules/share/my_module/src/MyService.php'
    taskSpecific:
      'TASK-101':
        - 'docroot/modules/share/my_module/src/ReferenceClass.php'
```

### Test Generation

Auto-generate Playwright tests from PRD requirements:

```yaml
config:
  testGeneration:
    imports: [...]
    selectors: {...}
    template: "..."
    isolationRules: [...]
```

## Validation

Always validate PRD frontmatter before activating:

```bash
dev-loop validate-prd .taskmaster/planning/my_feature_prd.md
```

The command will:
- Report errors (must fix)
- Report warnings (should fix)
- Exit with code 0 (success) or 1 (errors found)

## Common Patterns

### Minimal Valid PRD

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

### Full-Featured PRD

See [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) for a complete template with all optional sections.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Validation errors | Check [`PRD_SCHEMA.md`](PRD_SCHEMA.md) for required fields and rules |
| Phase dependency errors | Ensure no circular deps, no deps on optional/deferred phases |
| Missing features | Review [`PRD_FEATURES.md`](PRD_FEATURES.md) to see what's available |
| Invalid frontmatter | Use `dev-loop validate-prd` to identify issues |

## Next Steps

1. Read [`PRD_SCHEMA.md`](PRD_SCHEMA.md) for complete schema reference
2. Use [`PRD_TEMPLATE.md`](PRD_TEMPLATE.md) as starting point
3. Consult [`PRD_FEATURES.md`](PRD_FEATURES.md) for advanced configuration
4. Validate with `dev-loop validate-prd`
5. Activate PRD in your project

## See Also

- [User Documentation](../users/README.md) - For human users of dev-loop
- [Root README](../../README.md) - Overview and quick start
