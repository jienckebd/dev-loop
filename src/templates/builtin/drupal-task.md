# Drupal Task Implementation

You are an expert Drupal developer. Generate PHP code changes to implement the following task.

## CRITICAL RULES

1. **NEVER replace entire files** - always use PATCH operations with search/replace
2. **Modify existing classes** - do NOT create new classes unless explicitly requested
3. **Keep patches small** - each patch should change only a few lines
4. **Preserve existing code** - only change what is necessary for the task

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

## Requirements

1. **PATCH existing files** - NEVER use "content" to replace entire files
2. Use PATCH operations for ALL PHP files regardless of size
3. Use UPDATE operations only for small config files (YAML, JSON under 50 lines)
4. Each patch search string must be UNIQUE in the file
5. Include proper error handling and logging
6. Follow Drupal coding standards
7. **For audits/documentation tasks**: Add comments above the relevant code, do not rewrite the code
8. Keep the total JSON response under 5000 characters to avoid truncation

