/**
 * JSON Schema for CodeChanges
 * 
 * This schema ensures consistent parsing of AI provider responses across
 * all providers (OpenAI, Anthropic, Gemini, Cursor, etc.)
 * 
 * Based on JSON Schema Draft 7 specification for maximum compatibility.
 */

export const CODE_CHANGES_JSON_SCHEMA = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "title": "CodeChanges",
  "description": "Structured code changes response from AI provider",
  "required": ["files", "summary"],
  "properties": {
    "files": {
      "type": "array",
      "description": "Array of file changes",
      "items": {
        "type": "object",
        "required": ["path", "operation"],
        "properties": {
          "path": {
            "type": "string",
            "description": "File path relative to project root",
            "pattern": "^[^\\0]+$"
          },
          "content": {
            "type": "string",
            "description": "Full file content (for create/update operations)"
          },
          "patches": {
            "type": "array",
            "description": "Array of search/replace patches (for patch operations)",
            "items": {
              "type": "object",
              "required": ["search", "replace"],
              "properties": {
                "search": {
                  "type": "string",
                  "description": "Exact code to find (must match exactly including whitespace)"
                },
                "replace": {
                  "type": "string",
                  "description": "Replacement code (use empty string for deletions)"
                }
              },
              "additionalProperties": false
            }
          },
          "operation": {
            "type": "string",
            "enum": ["create", "update", "delete", "patch"],
            "description": "Operation type: create (new file), update (replace entire file), delete (remove file), patch (search/replace)"
          }
        },
        "additionalProperties": false,
        "oneOf": [
          {
            "description": "For create/update operations, content is required",
            "properties": {
              "operation": {
                "enum": ["create", "update"]
              },
              "content": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": ["content"]
          },
          {
            "description": "For patch operations, patches array is required",
            "properties": {
              "operation": {
                "enum": ["patch"]
              },
              "patches": {
                "type": "array",
                "minItems": 1
              }
            },
            "required": ["patches"]
          },
          {
            "description": "For delete operations, only path and operation are required",
            "properties": {
              "operation": {
                "enum": ["delete"]
              }
            }
          }
        ]
      }
    },
    "summary": {
      "type": "string",
      "description": "Brief description of the changes made",
      "minLength": 1
    }
  },
  "additionalProperties": false
};

/**
 * JSON Schema as a string for inclusion in prompts
 */
export const CODE_CHANGES_JSON_SCHEMA_STRING = JSON.stringify(CODE_CHANGES_JSON_SCHEMA, null, 2);

/**
 * Example CodeChanges object for prompt examples
 */
export const CODE_CHANGES_EXAMPLE = {
  files: [
    {
      path: "docroot/modules/share/my_module/my_module.module",
      content: "<?php\n\n/**\n * @file\n * Module file.\n */",
      operation: "create"
    },
    {
      path: "docroot/modules/share/my_module/src/Service/MyService.php",
      patches: [
        {
          search: "  protected $property;\n\n  public function __construct() {",
          replace: "  protected $property;\n  protected $newProperty;\n\n  public function __construct() {"
        }
      ],
      operation: "patch"
    }
  ],
  summary: "Created module file and added new property to service"
};

/**
 * Example CodeChanges JSON string for prompts
 */
export const CODE_CHANGES_EXAMPLE_JSON = JSON.stringify(CODE_CHANGES_EXAMPLE, null, 2);
