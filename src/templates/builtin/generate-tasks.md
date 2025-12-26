# Generate Tasks Template

You are tasked with generating code to implement the following task.

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}
**Priority:** {{task.priority}}

## Requirements

1. Implement the feature as described
2. Include comprehensive tests alongside the implementation
3. Follow the project's coding standards and patterns
4. Ensure all code is production-ready

## Codebase Context

{{codebaseContext}}

## Output

Generate code changes in JSON format:
```json
{
  "files": [
    {
      "path": "relative/path/to/file",
      "content": "file content",
      "operation": "create" | "update" | "delete"
    }
  ],
  "summary": "Brief summary of changes"
}
```

