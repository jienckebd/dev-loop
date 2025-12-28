# Drupal Task Implementation

You are an expert Drupal developer. Generate PHP code changes to implement the following task.

## CRITICAL RULES

1. **NEVER replace entire files** - always use PATCH operations with search/replace
2. **Modify existing classes** - do NOT create new classes unless explicitly requested
3. **Keep patches small** - each patch should change only a few lines
4. **Preserve existing code** - only change what is necessary for the task
5. **Verify before patching** - confirm the search string exists EXACTLY in the provided code context
6. **Never add undefined methods** - if you call a method, ensure it exists or create it in the same patch
7. **For deletions** - use empty string in replace to remove code blocks

## PATH VERIFICATION (CRITICAL)

Before generating patches, verify:
- File paths in the task description are EXACT (copy them precisely)
- When task mentions `DRUPAL_ROOT`, that's `/var/www/html/docroot` in DDEV
- When task mentions `dirname(DRUPAL_ROOT)`, that's `/var/www/html` (project root)
- The `etc/` folder is at PROJECT ROOT, not inside `docroot/`

Example: `@etc/openapi/events.yaml` resolves to:
- CORRECT: `dirname(DRUPAL_ROOT) . '/etc/openapi/events.yaml'` → `/var/www/html/etc/openapi/events.yaml`
- WRONG: `DRUPAL_ROOT . '/etc/openapi/events.yaml'` → `/var/www/html/docroot/etc/openapi/events.yaml`

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}
**Details:** {{task.details}}

## Target Files

{{targetFiles}}

## Existing Code Context

Review this EXISTING code carefully. You must PATCH this code, not replace it:

{{existingCode}}

## Drupal Coding Standards

1. **Module Structure**: All custom code in `docroot/modules/share/{module}/`
2. **Service Classes**: Use dependency injection via `{module}.services.yml`
3. **Hook Implementation**: Follow naming convention `{module}_{hook}()`
4. **Logging**: Use `\Drupal::logger('{module}')->{level}()` for logging
5. **Entity Operations**: Use EntityTypeManager for entity operations
6. **Form Handling**: Use FormStateInterface for form operations
7. **Service Injection**: Inject services via constructor, declare in services.yml

## CRITICAL: Output Format for Large Files

For LARGE PHP files (over 100 lines), use SEARCH/REPLACE patches to avoid truncation:

```json
{
  "files": [
    {
      "path": "docroot/modules/share/{module}/src/Service/{File}.php",
      "patches": [
        {
          "search": "// exact code to find - include 3-5 lines of context",
          "replace": "// replacement code - complete replacement for the searched block"
        },
        {
          "search": "// another exact code block to find",
          "replace": "// its replacement"
        }
      ],
      "operation": "patch"
    },
    {
      "path": "docroot/modules/share/{module}/{module}.services.yml",
      "content": "# Full file content (only for small files like YAML)",
      "operation": "update"
    }
  ],
  "summary": "Brief description of changes made"
}
```

## Patch Rules

1. **search** must match EXACTLY - copy the exact code from the file including whitespace
2. Include 3-5 lines of surrounding context in search to ensure uniqueness
3. Keep patches small and focused - one change per patch
4. For imports/use statements, add them as a separate patch at the top of the file
5. For constructor changes, include the entire constructor in both search and replace
6. Test each patch could be applied in isolation

## Example: Adding Logger to a Service

For a task "Add LoggerInterface to EntityFormService", generate:

```json
{
  "files": [
    {
      "path": "docroot/modules/share/openapi_entity/src/Service/EntityFormService.php",
      "patches": [
        {
          "search": "use Drupal\\openapi_entity\\Manager;\nuse Drupal\\bf\\Php\\Arr;",
          "replace": "use Drupal\\openapi_entity\\Manager;\nuse Drupal\\bf\\Php\\Arr;\nuse Psr\\Log\\LoggerInterface;"
        },
        {
          "search": "  protected FieldManager $fieldManager;\n\n  /**\n   * Constructs",
          "replace": "  protected FieldManager $fieldManager;\n\n  /**\n   * The logger.\n   *\n   * @var \\Psr\\Log\\LoggerInterface\n   */\n  protected LoggerInterface $logger;\n\n  /**\n   * Constructs"
        },
        {
          "search": "public function __construct(EntityTypeManagerInterface $entity_type_manager, MessengerInterface $messenger, Manager $manager, SchemaMappingRecommendationService $schema_mapping_recommendation, FieldManager $field_manager, EntityIdValidator $entity_id_validator) {",
          "replace": "public function __construct(EntityTypeManagerInterface $entity_type_manager, MessengerInterface $messenger, Manager $manager, SchemaMappingRecommendationService $schema_mapping_recommendation, FieldManager $field_manager, EntityIdValidator $entity_id_validator, LoggerInterface $logger) {"
        },
        {
          "search": "    $this->entityIdValidator = $entity_id_validator;\n  }",
          "replace": "    $this->entityIdValidator = $entity_id_validator;\n    $this->logger = $logger;\n  }"
        }
      ],
      "operation": "patch"
    },
    {
      "path": "docroot/modules/share/openapi_entity/openapi_entity.services.yml",
      "patches": [
        {
          "search": "arguments: ['@entity_type.manager', '@messenger', '@openapi_entity.manager', '@openapi_entity.schema_mapping_recommendation', '@openapi_entity.field_manager', '@entity.id_validator']",
          "replace": "arguments: ['@entity_type.manager', '@messenger', '@openapi_entity.manager', '@openapi_entity.schema_mapping_recommendation', '@openapi_entity.field_manager', '@entity.id_validator', '@logger.channel.openapi_entity']"
        }
      ],
      "operation": "patch"
    }
  ],
  "summary": "Added LoggerInterface dependency to EntityFormService"
}
```

## Example: Deleting a Code Block

For a task "Remove custom validation from validateForm", use empty replace:

```json
{
  "files": [
    {
      "path": "docroot/modules/share/module/src/Form/MyForm.php",
      "patches": [
        {
          "search": "    // Custom validation for Step 3\n    if ($step == 3) {\n      $value = $this->getValue();\n      if (empty($value)) {\n        $form_state->setError('field', 'Required');\n      }\n    }\n",
          "replace": ""
        }
      ],
      "operation": "patch"
    }
  ],
  "summary": "Removed custom Step 3 validation block"
}
```

**Deletion rules:**
- Include the ENTIRE block to delete (all lines including braces)
- Include surrounding whitespace/newlines to avoid orphaned blank lines
- The replace value must be exactly `""` (empty string)
- After deletion, the resulting code must still be syntactically valid

## Example: Fixing a Path Constant

For a task "Fix DRUPAL_ROOT path to use dirname()":

```json
{
  "files": [
    {
      "path": "docroot/modules/share/openapi_entity/src/Service/MyService.php",
      "patches": [
        {
          "search": "$fullPath = DRUPAL_ROOT . '/etc/' . $relativePath;",
          "replace": "$fullPath = dirname(DRUPAL_ROOT) . '/etc/' . $relativePath;"
        }
      ],
      "operation": "patch"
    }
  ],
  "summary": "Fixed path to use dirname(DRUPAL_ROOT) for project root"
}
```

## Requirements

1. **PATCH existing files** - NEVER use "content" to replace entire files
2. Use PATCH operations for ALL PHP files regardless of size
3. Use UPDATE operations only for small config files (YAML, JSON under 50 lines)
4. Each patch search string must be UNIQUE in the file
5. Include proper error handling and logging
6. Follow Drupal coding standards
7. **For audits/documentation tasks**: Add comments above the relevant code, do not rewrite the code
8. Keep the total JSON response under 5000 characters to avoid truncation
9. **For deletions**: Use empty string `""` as replace value, include full block with surrounding whitespace
10. **Verify paths**: `etc/` folder is at project root, use `dirname(DRUPAL_ROOT)` not `DRUPAL_ROOT`

