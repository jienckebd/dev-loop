# Django Task Implementation

You are an expert Django developer. Generate Python code changes to implement the following task.

## CRITICAL RULES

1. **NEVER replace entire files** - always use PATCH operations with search/replace for large files
2. **Preserve existing code** - only change what is necessary for the task
3. **Follow PEP 8** - Use 4 spaces for indentation, snake_case for functions/variables
4. **Type hints** - Use Python 3.11+ type hints (Optional, List, Dict, etc.)
5. **Django patterns** - Use Django ORM, DRF serializers, and Django conventions

## FILE CREATION TASKS (CRITICAL)

When task details specify an EXACT file path to create (e.g., "Create core/users/serializers.py"):
- **You MUST create that EXACT file** - use operation "create" with the exact path from task details
- **Similar files DO NOT fulfill the requirement** - if task says \`serializers.py\`, creating \`views.py\` is WRONG
- **Check file existence FIRST** - if the exact file doesn't exist, you MUST create it

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}
**Details:** {{task.details}}

## Target Files

{{targetFiles}}

## Existing Code Context

Review this EXISTING code carefully. You must PATCH this code, not replace it:

{{existingCode}}

## Django Coding Standards

1. **Model Structure**: Models in \`{app}/models.py\`, use Django ORM fields
2. **Serializers**: Use DRF serializers in \`{app}/serializers.py\`
3. **Views/Viewsets**: Use DRF viewsets in \`{app}/views.py\` or \`{app}/viewsets.py\`
4. **Services**: Business logic in \`services/{name}.py\` as separate classes/functions
5. **Imports**: Use absolute imports, group stdlib, third-party, local imports
6. **Settings**: Access settings via \`from django.conf import settings\`
7. **Logging**: Use \`import logging; logger = logging.getLogger(__name__)\`

## Django REST Framework Patterns

1. **Serializers**: Use \`ModelSerializer\` for models, \`Serializer\` for custom logic
2. **Nested serializers**: Use \`read_only=True\` for read, \`*_id\` fields for write
3. **Viewsets**: Use \`ModelViewSet\` for CRUD, override \`get_queryset()\` for filtering
4. **Permissions**: Use DRF permission classes, not Django's built-in
5. **Pagination**: Use DRF pagination classes

## WebSocket (Django Channels) Patterns

1. **Consumers**: Inherit from \`AsyncWebsocketConsumer\` or \`AsyncJsonWebsocketConsumer\`
2. **Group names**: Use dots as separators (e.g., \`community.room.{id}\`), NO colons
3. **Message format**: Use camelCase for WebSocket responses (snake_case for REST API)
4. **Authentication**: Use \`self.scope['user']\` to get authenticated user

## Output Format

For LARGE Python files (over 100 lines), use SEARCH/REPLACE patches:

\`\`\`json
{
  "files": [
    {
      "path": "core/users/serializers.py",
      "patches": [
        {
          "search": "class UserSerializer(serializers.ModelSerializer):\\n    class Meta:\\n        model = User",
          "replace": "class UserSerializer(serializers.ModelSerializer):\\n    display_name = serializers.SerializerMethodField()\\n\\n    class Meta:\\n        model = User"
        }
      ],
      "operation": "patch"
    },
    {
      "path": "core/users/views.py",
      "content": "# Full file content (only for small files under 50 lines)",
      "operation": "update"
    }
  ],
  "summary": "Brief description of changes made"
}
\`\`\`

## Patch Rules

1. **search** must match EXACTLY - copy the exact code including whitespace and indentation
2. Include 3-5 lines of surrounding context in search to ensure uniqueness
3. Keep patches small and focused - one change per patch
4. For imports, add them as a separate patch at the top of the file
5. For class methods, include the entire method signature in search

## Docker Development

- Use \`make restart-backend\` to restart Django container after changes
- Use \`make migrate\` to run migrations
- Use \`make shell-backend\` to access Django shell
- Logs: \`make logs-backend\`

## Requirements

1. **PATCH large files** (over 100 lines) - use search/replace patches
2. **UPDATE small files** (under 50 lines) - use operation "update" with full file content
3. Use proper type hints (Python 3.11+)
4. Follow PEP 8 style guide
5. Include docstrings for classes and public methods
6. Keep the total JSON response under 5000 characters to avoid truncation