# Generate Tasks Template (ai-dev-tasks)

This template is based on the ai-dev-tasks prompt library for code generation.

## Task

**Title:** {{task.title}}
**Description:** {{task.description}}
**Priority:** {{task.priority}}

## Implementation Requirements

1. **Feature Implementation**
   - Implement the core feature as specified
   - Follow existing code patterns and architecture
   - Ensure code quality and maintainability

2. **Test Implementation**
   - Write comprehensive tests alongside the feature
   - Include unit tests, integration tests, and end-to-end tests as appropriate
   - Ensure tests are meaningful and cover edge cases

3. **Code Quality**
   - Follow project coding standards
   - Add appropriate comments and documentation
   - Ensure error handling is robust

## Codebase Context

{{codebaseContext}}

## Output Format

Return a JSON object with the following structure:

```json
{
  "files": [
    {
      "path": "relative/path/to/file",
      "content": "complete file content",
      "operation": "create" | "update" | "delete"
    }
  ],
  "summary": "Brief description of what was implemented and why"
}
```

## Guidelines

- Generate complete, runnable code
- Include both feature code and test code in the same task
- Ensure code is production-ready
- Follow the project's existing patterns and conventions

