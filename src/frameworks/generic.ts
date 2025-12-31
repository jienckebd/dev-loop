import { FrameworkPlugin, FrameworkDefaultConfig } from './interface';

/**
 * Generic Framework Plugin
 *
 * Fallback plugin used when no specific framework is detected or configured.
 * Provides sensible defaults for general development projects.
 */
export class GenericPlugin implements FrameworkPlugin {
  readonly name = 'generic';
  readonly version = '1.0.0';
  readonly description = 'Generic framework support for any project type';

  async detect(_projectRoot: string): Promise<boolean> {
    // Generic always returns false - it's only used as fallback
    return false;
  }

  getDefaultConfig(): FrameworkDefaultConfig {
    return {
      searchDirs: ['src', 'lib', 'app'],
      excludeDirs: ['node_modules', 'vendor', 'dist', 'build', '.git'],
      extensions: ['ts', 'js', 'tsx', 'jsx', 'json', 'yml', 'yaml'],
      ignoreGlobs: ['**/node_modules/**', '**/dist/**', '**/build/**'],
      testRunner: 'playwright',
    };
  }

  getTaskTemplate(): string {
    return `# Task Implementation

You are an expert developer. Generate code changes to implement the following task.

## CRITICAL RULES

1. **Preserve existing code** - Only change what is necessary
2. **Use PATCH operations for large files** - search/replace is safer than full file replacement
3. **Verify paths** - Ensure file paths match exactly what exists in the codebase

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}
**Details:** {{task.details}}

## Target Files

{{targetFiles}}

## Existing Code Context

{{existingCode}}

## Output Format

Return JSON with code changes:

\`\`\`json
{
  "files": [
    {
      "path": "path/to/file",
      "content": "file content for small files",
      "operation": "update"
    },
    {
      "path": "path/to/large/file",
      "patches": [
        {
          "search": "exact code to find",
          "replace": "replacement code"
        }
      ],
      "operation": "patch"
    }
  ],
  "summary": "Description of changes"
}
\`\`\`

## Requirements

1. Keep patches small and focused
2. Include 3-5 lines of context in search strings for uniqueness
3. Test each patch could be applied in isolation
`;
  }

  getFileExtensions(): string[] {
    return ['ts', 'js', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'json', 'yml', 'yaml', 'md'];
  }

  getSearchDirs(): string[] {
    return ['src', 'lib', 'app', 'packages'];
  }

  getExcludeDirs(): string[] {
    return ['node_modules', 'vendor', 'dist', 'build', '.git', '__pycache__', '.venv'];
  }

  getErrorPatterns(): Record<string, string> {
    return {
      'SyntaxError': 'Check for missing brackets, parentheses, or semicolons',
      'TypeError': 'Verify types match expected values',
      'ReferenceError': 'Check that all variables and imports are defined',
      'ModuleNotFoundError': 'Verify the import path and that the module is installed',
      'ENOENT': 'File or directory not found - check the path exists',
    };
  }

  getIdentifierPatterns(): RegExp[] {
    return [
      /\bfunction\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
      /\bclass\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      /\bconst\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g,
      /\bexport\s+(?:default\s+)?(?:function|class|const)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
    ];
  }
}
