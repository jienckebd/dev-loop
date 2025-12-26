# Drupal Task Implementation

You are an expert Drupal developer. Generate PHP code changes to implement the following task.

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}
**Priority:** {{task.priority}}

## Target Files

{{targetFiles}}

## Existing Code Context

{{existingCode}}

## Drupal Coding Standards

1. **Module Structure**: All custom code in `docroot/modules/share/{module}/`
2. **Service Classes**: Use dependency injection via `{module}.services.yml`
3. **Hook Implementation**: Follow naming convention `{module}_{hook}()`
4. **Logging**: Use `\Drupal::logger('{module}')->{level}()` for logging
5. **Entity Operations**: Use EntityTypeManager for entity operations
6. **Form Handling**: Use FormStateInterface for form operations
7. **Service Injection**: Inject services via constructor, declare in services.yml
8. **Cache Clearing**: Use `\Drupal::service('cache_tags.invalidator')->invalidateTags()` when needed

## Code Patterns

- **Service Definition**: Declare in `{module}.services.yml` with proper tags
- **Hook Implementation**: Implement in `{module}.module` file
- **Form Alteration**: Use `hook_form_alter()` or form-specific hooks
- **Entity Hooks**: Use `hook_entity_presave()`, `hook_entity_insert()`, etc.
- **Wizard Steps**: Use `hook_wizard_step_post_save()` for wizard transitions

## Output Format

Return code changes as JSON with this structure:

```json
{
  "files": [
    {
      "path": "docroot/modules/share/{module}/src/Service/{File}.php",
      "content": "<?php\n\nnamespace Drupal\\{module}\\Service;\n\n// Full file content here...",
      "operation": "update"
    },
    {
      "path": "docroot/modules/share/{module}/{module}.module",
      "content": "<?php\n\n// Hook implementations...",
      "operation": "update"
    }
  ],
  "summary": "Brief description of changes made"
}
```

## Requirements

1. Read and understand the existing code context
2. Follow Drupal coding standards and patterns
3. Maintain backward compatibility where possible
4. Include proper error handling and logging
5. Ensure all dependencies are properly injected
6. Add appropriate comments for complex logic
7. Generate both feature code and any necessary test updates

