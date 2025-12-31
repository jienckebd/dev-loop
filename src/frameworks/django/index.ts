import * as fs from 'fs-extra';
import * as path from 'path';
import { z } from 'zod';
import { FrameworkPlugin, FrameworkDefaultConfig, CodeChanges } from '../interface';

/**
 * Django Framework Plugin
 *
 * Provides Django 5+ specific functionality for dev-loop including:
 * - Auto-detection of Django projects
 * - Django/DRF coding standards in templates
 * - Docker-based development workflow
 * - Django ORM and serializer patterns
 * - Django Channels (WebSocket) support
 */
export class DjangoPlugin implements FrameworkPlugin {
  readonly name = 'django';
  readonly version = '1.0.0';
  readonly description = 'Django 5+ framework support with Docker integration';

  private templateCache: Map<string, string> = new Map();

  async detect(projectRoot: string): Promise<boolean> {
    // Check for Django indicators
    const indicators = [
      // Django management script
      path.join(projectRoot, 'manage.py'),
      // Django settings module
      path.join(projectRoot, 'config/settings.py'),
      path.join(projectRoot, 'settings.py'),
      // Docker setup (common in Django projects)
      path.join(projectRoot, 'docker-compose.yml'),
      path.join(projectRoot, 'Makefile'), // Often used for Django make commands
    ];

    for (const indicator of indicators) {
      if (await fs.pathExists(indicator)) {
        return true;
      }
    }

    // Check requirements.txt for Django
    const requirementsPath = path.join(projectRoot, 'requirements.txt');
    if (await fs.pathExists(requirementsPath)) {
      try {
        const content = await fs.readFile(requirementsPath, 'utf-8');
        if (content.includes('Django') || content.includes('django')) {
          return true;
        }
      } catch {
        // Ignore read errors
      }
    }

    // Check pyproject.toml for Django
    const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
    if (await fs.pathExists(pyprojectPath)) {
      try {
        const content = await fs.readFile(pyprojectPath, 'utf-8');
        if (content.includes('Django') || content.includes('djangorestframework')) {
          return true;
        }
      } catch {
        // Ignore read errors
      }
    }

    return false;
  }

  getDefaultConfig(): FrameworkDefaultConfig {
    return {
      cacheCommand: 'make restart-backend', // Docker-based restart
      searchDirs: [
        'core',
        'services',
        'config',
        'templates',
      ],
      excludeDirs: [
        '.venv',
        'venv',
        'env',
        '__pycache__',
        'migrations',
        'media',
        'staticfiles',
        'node_modules',
        '.git',
        '.pytest_cache',
      ],
      extensions: ['py', 'html', 'yml', 'yaml', 'json', 'toml'],
      ignoreGlobs: [
        '**/__pycache__/**',
        '**/.venv/**',
        '**/venv/**',
        '**/migrations/**',
        '**/media/**',
        '**/staticfiles/**',
        '**/node_modules/**',
      ],
      testRunner: 'playwright',
      testCommand: 'make test',
      validationBaseUrl: 'http://localhost:8000',
    };
  }

  getSchemaExtension(): z.ZodObject<any> {
    return z.object({
      django: z.object({
        // Enable Django-specific code generation
        enabled: z.boolean().default(true),
        // Django settings module path
        settingsModule: z.string().default('config.settings'),
        // Docker container name (if using Docker)
        dockerContainer: z.string().optional(),
        // Cache clear command (if different from default)
        cacheCommand: z.string().optional(),
        // Base URL for API validation
        apiBaseUrl: z.string().optional(),
        // WebSocket URL (if using Django Channels)
        websocketUrl: z.string().optional(),
        // Common Django app names for context
        appNames: z.array(z.string()).optional(),
        // DRF-specific patterns
        restFramework: z.object({
          // Default serializer base class
          serializerBase: z.string().default('serializers.ModelSerializer'),
          // Default viewset base class
          viewsetBase: z.string().default('viewsets.ModelViewSet'),
        }).optional(),
      }).optional(),
    });
  }

  getTaskTemplate(): string {
    // Try to load from file first, fall back to embedded
    if (!this.templateCache.has('task')) {
      const templatePath = path.join(__dirname, 'templates', 'task.md');
      try {
        if (fs.existsSync(templatePath)) {
          this.templateCache.set('task', fs.readFileSync(templatePath, 'utf-8'));
        } else {
          this.templateCache.set('task', this.getEmbeddedTaskTemplate());
        }
      } catch {
        this.templateCache.set('task', this.getEmbeddedTaskTemplate());
      }
    }
    return this.templateCache.get('task')!;
  }

  private getEmbeddedTaskTemplate(): string {
    return `# Django Task Implementation

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
`;
  }

  getFileExtensions(): string[] {
    return ['py', 'html', 'yml', 'yaml', 'json', 'toml', 'txt'];
  }

  getSearchDirs(): string[] {
    return [
      'core',
      'services',
      'config',
      'templates',
    ];
  }

  getExcludeDirs(): string[] {
    return [
      '.venv',
      'venv',
      'env',
      '__pycache__',
      'migrations',
      'media',
      'staticfiles',
      'node_modules',
      '.git',
      '.pytest_cache',
      'load_testing',
    ];
  }

  getErrorPatterns(): Record<string, string> {
    return {
      // Import errors
      'ImportError': 'Check import path, verify module exists, ensure virtual environment is activated',
      'ModuleNotFoundError': 'Verify the module is installed (requirements.txt), check PYTHONPATH',
      'No module named': 'Module not found - check if package is in requirements.txt, install with pip',

      // Django ORM errors
      'DoesNotExist': 'Object does not exist in database - check query filters, ensure object is created',
      'MultipleObjectsReturned': 'Query returned multiple objects - add .get() filter or use .filter().first()',
      'IntegrityError': 'Database constraint violation - check unique constraints, foreign keys, required fields',
      'OperationalError': 'Database connection issue - verify database is running (docker-compose up db)',
      'FieldError': 'Invalid field name in query - check model fields, verify field exists on model',

      // DRF serializer errors
      'ValidationError': 'Serializer validation failed - check field types, required fields, custom validators',
      'serializers.ValidationError': 'Field validation error - verify input data matches serializer fields',
      'serializer.errors': 'Serializer has errors - check field definitions, required fields, read_only fields',

      // Django model errors
      'RelatedObjectDoesNotExist': 'Related object not set - ensure related object exists before accessing',
      'Cannot assign': 'Cannot assign to related field - use related manager methods (add, set, remove)',
      'ForeignKey': 'Foreign key constraint - verify referenced object exists and is saved first',

      // Django Channels errors
      'WebSocketError': 'WebSocket connection failed - check consumer routing, verify channels is configured',
      'Group name': 'Invalid group name - use dots/periods as separators, no colons allowed',
      'scope': 'Consumer scope error - verify user is authenticated, check consumer setup',

      // Migration errors
      'Migration': 'Migration conflict - run makemigrations, check for conflicting migrations',
      'django.db.migrations': 'Migration issue - verify model changes, run migrate to apply',
      'CircularDependencyError': 'Circular import or dependency - refactor to break circular dependency',

      // Test errors
      'pytest': 'Test failure - check test assertions, verify test data setup, run with pytest -v for details',
      'AssertionError': 'Test assertion failed - verify expected vs actual values',
      'FixtureNotFoundError': 'Test fixture not found - check conftest.py, verify fixture is defined',

      // Docker errors
      'Connection refused': 'Cannot connect to service - verify docker-compose up, check service name',
      'docker-compose': 'Docker error - verify docker-compose.yml is valid, check container logs',

      // General Python errors
      'IndentationError': 'Indentation error - use 4 spaces consistently, check for mixed tabs/spaces',
      'SyntaxError': 'Syntax error - check for missing colons, brackets, or quotes',
      'AttributeError': 'Attribute does not exist - verify object type, check method/attribute name',
      'TypeError': 'Type mismatch - verify argument types, check return types',
      'NameError': 'Undefined variable - check variable name spelling, verify variable is defined',
    };
  }

  getIdentifierPatterns(): RegExp[] {
    return [
      // Class names
      /\bclass\s+([A-Z][a-zA-Z0-9_]+)/g,
      // Function definitions
      /\bdef\s+([a-z_][a-z0-9_]*)\s*\(/g,
      // Django models
      /\bclass\s+([A-Z][a-zA-Z0-9_]+)\s*\(.*models\.(?:Model|TimeStampedModel)/g,
      // DRF serializers
      /\bclass\s+([A-Z][a-zA-Z0-9_]+Serializer)\s*\(/g,
      // DRF viewsets
      /\bclass\s+([A-Z][a-zA-Z0-9_]+ViewSet)\s*\(/g,
      // Django views
      /\bclass\s+([A-Z][a-zA-Z0-9_]+View)\s*\(/g,
    ];
  }

  getErrorPathPatterns(): RegExp[] {
    return [
      // Python stack traces
      /File "([^"]+\.py)", line (\d+)/g,
      // Django paths
      /([a-zA-Z0-9_\-./]+\.py):(\d+)/g,
      // Template paths
      /([a-zA-Z0-9_\-./]+\.html)/g,
    ];
  }

  getCacheCommand(): string {
    return 'make restart-backend';
  }

  async onAfterApply(changes: CodeChanges): Promise<void> {
    const hasPythonChanges = changes.files?.some(f =>
      f.path.endsWith('.py')
    );

    const hasModelChanges = changes.files?.some(f =>
      f.path.includes('/models.py') || f.path.includes('models/')
    );

    const hasSettingsChanges = changes.files?.some(f =>
      f.path.includes('settings.py')
    );

    if (hasModelChanges) {
      console.log('[DjangoPlugin] Model changes detected - migrations may be needed: make makemigrations && make migrate');
    }

    if (hasSettingsChanges) {
      console.log('[DjangoPlugin] Settings changes detected - restart required: make restart-backend');
    } else if (hasPythonChanges) {
      console.log('[DjangoPlugin] Python changes applied - restart recommended: make restart-backend');
    }
  }

  async onTestFailure(error: string): Promise<string> {
    const guidance: string[] = [];

    // Check for specific Django-related test failures
    if (error.includes('Database') || error.includes('migration')) {
      guidance.push('DATABASE: Run `make migrate` to apply migrations');
    }

    if (error.includes('404') || error.includes('not found')) {
      guidance.push('ROUTE NOT FOUND: Check urls.py configuration, verify view/url name exists');
    }

    if (error.includes('403') || error.includes('permission')) {
      guidance.push('PERMISSION: Check DRF permission classes, verify user has required permissions');
    }

    if (error.includes('serializer') && error.includes('error')) {
      guidance.push('SERIALIZER: Check serializer field definitions, verify required fields are provided');
    }

    if (error.includes('WebSocket') || error.includes('channels')) {
      guidance.push('WEBSOCKET: Verify Django Channels is configured, check consumer routing');
    }

    if (error.includes('docker') || error.includes('Connection refused')) {
      guidance.push('DOCKER: Ensure services are running: `make up` or `docker-compose up`');
    }

    return guidance.length > 0
      ? '\n\n**Django-Specific Guidance:**\n' + guidance.map(g => `- ${g}`).join('\n')
      : '';
  }
}