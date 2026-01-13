# Drupal Task Implementation

You are an expert Drupal developer. Generate PHP code changes to implement the following task.

{{#if specKit.constitution}}
## Project Constitution (MUST FOLLOW)

### Constraints
{{#each specKit.constitution.constraints}}
- {{this}}
{{/each}}

### Required Patterns
{{#each specKit.constitution.patterns}}
- Use **{{pattern}}** when {{when}}
{{/each}}

{{#if specKit.constitution.avoid}}
### Avoid
{{#each specKit.constitution.avoid}}
- {{this}}
{{/each}}
{{/if}}
{{/if}}

{{#if task.context.clarifications}}
## Resolved Clarifications

{{#each task.context.clarifications}}
**Q:** {{question}}
**A:** {{answer}}

{{/each}}
{{/if}}

{{#if task.context.researchFindings}}
## Research Findings

{{#each task.context.researchFindings}}
### {{topic}}
{{findings}}
{{#if relevantFiles}}
Reference files:
{{#each relevantFiles}}
- `{{this}}`
{{/each}}
{{/if}}

{{/each}}
{{/if}}

---

## CRITICAL RULES

1. **NEVER replace entire files** - always use PATCH operations with search/replace
2. **Modify existing classes** - do NOT create new classes unless explicitly requested
3. **Keep patches small** - each patch should change only a few lines
4. **Preserve existing code** - only change what is necessary for the task
5. **Verify before patching** - confirm the search string exists EXACTLY in the provided code context
6. **Never add undefined methods** - if you call a method, ensure it exists or create it in the same patch
7. **For deletions** - use empty string in replace to remove code blocks

## FILE CREATION TASKS (CRITICAL)

### Before Returning Empty Files Array - VERIFY:

1. **Does the task say "Create [path]"?** If YES, you MUST create that exact file
2. **Does the exact file already exist at the exact path?** If NO, you MUST create it
3. **Did you find a SIMILAR file?** Similar is NOT the same:
   - `bd.entity_type.*.yml` is NOT `node.type.*.yml`
   - `config/install/*.yml` is NOT `config/default/*.yml`
   - Files in module directories are NOT files in `config/default/`

### File Creation Rules

When task details specify an EXACT file path to create (e.g., "Create config/default/node.type.test_content.yml"):
- **You MUST create that EXACT file** - use operation "create" with the exact path from task details
- **Similar files DO NOT fulfill the requirement** - if task says `node.type.*.yml`, creating `bd.entity_type.*.yml` is WRONG
- **Config install files are NOT runtime configs** - `config/install/*.yml` files are module defaults, NOT `config/default/*.yml` runtime configs
- **Check file existence FIRST** - if the exact file doesn't exist, you MUST create it
- **Never assume** - if task says "Create X" and X doesn't exist, return it in your files array with operation "create"

### Common AI Mistakes to AVOID:

1. **Seeing similar files and assuming task is done**: Finding `bd.entity_type.test_content.yml` does NOT mean `node.type.test_content.yml` exists
2. **Wrong location**: Creating in `config/install/` instead of `config/default/`
3. **Wrong file type**: Creating BD entity type config when Node content type is required
4. **Empty response with "already exists"**: If the EXACT file at the EXACT path doesn't exist, this is WRONG

### Example: Task says "Create config/default/node.type.test_content.yml"

✅ CORRECT Response:
```json
{
  "files": [
    {
      "path": "config/default/node.type.test_content.yml",
      "operation": "create",
      "content": "langcode: en\nstatus: true\ndependencies: {}\nname: Test Content\ntype: test_content\ndescription: 'Test content type for dev-loop validation'\nhelp: ''\nnew_revision: true\npreview_mode: 1\ndisplay_submitted: true"
    }
  ],
  "summary": "Created Node content type configuration for test_content"
}
```

❌ WRONG Responses:
- Returning empty files array because you found `config/install/node.type.test_content.yml`
- Returning empty files array because you found `bd.entity_type.test_content.yml`
- Returning `{"files": [], "summary": "Configuration already exists"}` when the exact file doesn't exist

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

## CRITICAL: Copying Exact Code

**YOU MUST COPY-PASTE EXACTLY from the "Existing Code Context" section above.**

Common mistakes to AVOID:
- Using `EntityInterface` when the code has `ContentEntityInterface`
- Using `$entity` when the code has `$this->entity`
- Adding/removing whitespace or newlines
- Changing variable names or type hints
- "Improving" the code style (keep it exactly as-is)

When the existing code shows:
```
317|  public function prepopulateSchemaMappings(ContentEntityInterface $entity, FormStateInterface $form_state): void {
```

Your search string MUST start with exactly:
```
  public function prepopulateSchemaMappings(ContentEntityInterface $entity, FormStateInterface $form_state): void {
```

NOT `EntityInterface`, NOT different spacing, NOT a different docblock format.

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

## DEBUGGING TASKS

If the task asks to "add logging" or "debug", your patches should:
1. Add `\Drupal::logger('openapi_entity')->debug()` statements
2. Log the values of key variables
3. NOT change any logic - only add visibility

Example debug patch:
```json
{
  "search": "    $entity->save();\n",
  "replace": "    \\Drupal::logger('openapi_entity')->debug('Saving entity @id with @count mappings', [\n      '@id' => $entity->id(),\n      '@count' => count($schema_mapping_ids),\n    ]);\n    $entity->save();\n"
}
```

## Requirements

1. **PATCH large files** (over 500 lines) - use search/replace patches
2. **UPDATE medium files** (under 500 lines) - you MAY use operation "update" with full file content if patching is causing issues
3. Use UPDATE operations for small config files (YAML, JSON under 50 lines)
4. Each patch search string must be UNIQUE in the file
5. Include proper error handling and logging
6. Follow Drupal coding standards
7. **For audits/documentation tasks**: Add comments above the relevant code, do not rewrite the code
8. Keep the total JSON response under 5000 characters to avoid truncation
9. **For deletions**: Use empty string `""` as replace value, include full block with surrounding whitespace
10. **Verify paths**: `etc/` folder is at project root, use `dirname(DRUPAL_ROOT)` not `DRUPAL_ROOT`
11. **SMALLEST POSSIBLE PATCHES**: Each patch search should be 1-3 lines maximum to reduce match errors

