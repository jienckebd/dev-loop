import * as fs from 'fs-extra';
import * as path from 'path';
import { z } from 'zod';
import { FrameworkPlugin, FrameworkDefaultConfig, CodeChanges } from '../interface';

/**
 * React/Vite Framework Plugin
 *
 * Provides React + TypeScript + Vite specific functionality for dev-loop including:
 * - Auto-detection of React projects
 * - TypeScript/React coding standards
 * - Vite build system integration
 * - Component and hook patterns
 */
export class ReactPlugin implements FrameworkPlugin {
  readonly name = 'react';
  readonly version = '1.0.0';
  readonly description = 'React + TypeScript + Vite framework support';

  private templateCache: Map<string, string> = new Map();

  async detect(projectRoot: string): Promise<boolean> {
    // Check for React/Vite indicators
    const indicators = [
      // Vite config
      path.join(projectRoot, 'vite.config.ts'),
      path.join(projectRoot, 'vite.config.js'),
      // React entry points
      path.join(projectRoot, 'src/main.tsx'),
      path.join(projectRoot, 'src/main.ts'),
      path.join(projectRoot, 'src/index.tsx'),
      path.join(projectRoot, 'src/index.ts'),
      // React app structure
      path.join(projectRoot, 'src/App.tsx'),
      path.join(projectRoot, 'src/App.jsx'),
    ];

    for (const indicator of indicators) {
      if (await fs.pathExists(indicator)) {
        return true;
      }
    }

    // Check package.json for React
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const pkg = await fs.readJson(packageJsonPath);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (
          deps.react ||
          deps['react-dom'] ||
          deps.vite ||
          deps['@vitejs/plugin-react']
        ) {
          return true;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    return false;
  }

  getDefaultConfig(): FrameworkDefaultConfig {
    return {
      searchDirs: [
        'src',
        'e2e',
        'public',
      ],
      excludeDirs: [
        'node_modules',
        'dist',
        'build',
        '.next',
        'coverage',
        '.git',
        '.vite',
      ],
      extensions: ['ts', 'tsx', 'js', 'jsx', 'css', 'json', 'md'],
      ignoreGlobs: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/coverage/**',
      ],
      testRunner: 'playwright',
      testCommand: 'npm run test:e2e',
      validationBaseUrl: 'http://localhost:3000',
    };
  }

  getSchemaExtension(): z.ZodObject<any> {
    return z.object({
      react: z.object({
        // Enable React-specific code generation
        enabled: z.boolean().default(true),
        // Vite dev server port
        devPort: z.number().default(3000),
        // Build output directory
        buildDir: z.string().default('dist'),
        // TypeScript strict mode
        strictMode: z.boolean().default(true),
        // Testing framework
        testFramework: z.enum(['vitest', 'jest', 'playwright']).default('vitest'),
        // Common component patterns
        componentPatterns: z.object({
          // Default component style (functional, class)
          style: z.enum(['functional', 'class']).default('functional'),
          // Use TypeScript interfaces
          useTypescript: z.boolean().default(true),
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
    return `# React Task Implementation

You are an expert React + TypeScript developer. Generate code changes to implement the following task.

## CRITICAL RULES

1. **NEVER replace entire files** - always use PATCH operations with search/replace for large files
2. **Preserve existing code** - only change what is necessary for the task
3. **TypeScript types** - Use proper TypeScript types, interfaces, and generics
4. **React hooks** - Use functional components with hooks (useState, useEffect, etc.)
5. **Component structure** - Follow existing component patterns in the codebase

## FILE CREATION TASKS (CRITICAL)

When task details specify an EXACT file path to create (e.g., "Create src/components/Button.tsx"):
- **You MUST create that EXACT file** - use operation "create" with the exact path from task details
- **Similar files DO NOT fulfill the requirement** - if task says \`Button.tsx\`, creating \`Button.jsx\` is WRONG
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

## React + TypeScript Coding Standards

1. **Component Structure**: Functional components with TypeScript interfaces
2. **Hooks**: Use React hooks (useState, useEffect, useContext, useCallback, useMemo)
3. **Props**: Define Props interface with TypeScript, use destructuring
4. **State**: Use useState or state management library (Zustand, Redux, etc.)
5. **Imports**: Group imports (React, third-party, local), use absolute imports when configured
6. **File naming**: PascalCase for components (\`Button.tsx\`), camelCase for utilities (\`utils.ts\`)

## TypeScript Patterns

1. **Interfaces**: Use interfaces for props and object shapes
2. **Types**: Use types for unions, intersections, and complex types
3. **Generics**: Use generics for reusable components and functions
4. **Optional chaining**: Use \`?.\` for optional properties
5. **Type assertions**: Avoid \`as any\`, use proper type guards when needed

## React Patterns

1. **Functional components**: Always use functional components (no class components)
2. **Custom hooks**: Extract reusable logic into custom hooks (\`use*.ts\`)
3. **Memoization**: Use \`React.memo\` for expensive components, \`useMemo\`/\`useCallback\` for values/functions
4. **Event handlers**: Use arrow functions or \`useCallback\` for event handlers
5. **Conditional rendering**: Use ternary or \`&&\` for conditional rendering

## Vite-Specific Patterns

1. **Imports**: Use ES module imports (Vite handles transpilation)
2. **Assets**: Import assets directly (images, CSS) - Vite handles optimization
3. **Environment variables**: Use \`import.meta.env.VITE_*\` for env vars
4. **Build**: Vite handles TypeScript, JSX, CSS preprocessing automatically

## Output Format

For LARGE TypeScript/React files (over 100 lines), use SEARCH/REPLACE patches:

\`\`\`json
{
  "files": [
    {
      "path": "src/components/Button.tsx",
      "patches": [
        {
          "search": "interface ButtonProps {\\n  label: string;\\n}",
          "replace": "interface ButtonProps {\\n  label: string;\\n  onClick?: () => void;\\n  variant?: 'primary' | 'secondary';\\n}"
        }
      ],
      "operation": "patch"
    },
    {
      "path": "src/hooks/useAuth.ts",
      "content": "// Full file content (only for small files under 50 lines)",
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
5. For component props, include the entire interface in search

## Testing Patterns

- Use \`@testing-library/react\` for component tests
- Use Playwright for E2E tests
- Use Vitest for unit tests
- Mock external dependencies and API calls

## Requirements

1. **PATCH large files** (over 100 lines) - use search/replace patches
2. **UPDATE small files** (under 50 lines) - use operation "update" with full file content
3. Use TypeScript types throughout (no \`any\` unless necessary)
4. Follow React best practices (hooks, functional components)
5. Keep components focused and single-responsibility
6. Keep the total JSON response under 5000 characters to avoid truncation
`;
  }

  getFileExtensions(): string[] {
    return ['ts', 'tsx', 'js', 'jsx', 'css', 'json', 'md'];
  }

  getSearchDirs(): string[] {
    return [
      'src',
      'e2e',
      'public',
    ];
  }

  getExcludeDirs(): string[] {
    return [
      'node_modules',
      'dist',
      'build',
      '.next',
      'coverage',
      '.git',
      '.vite',
    ];
  }

  getErrorPatterns(): Record<string, string> {
    return {
      // TypeScript errors
      "TS2304": 'Cannot find name - check import statement, verify type is defined',
      "TS2322": 'Type is not assignable - check prop types, verify interface matches',
      "TS2339": "Property does not exist on type - check interface definition, verify property name",
      "TS2345": 'Argument type mismatch - check function parameter types',
      "TS2554": 'Expected X arguments but got Y - check function signature',
      'Type .* is not assignable': 'Type mismatch - verify types match expected interface',
      'Cannot find module': 'Import error - check module path, verify package is installed',

      // React errors
      'Cannot read property': 'Undefined/null access - add null check or optional chaining (?.)',
      'Hooks can only be called': 'React hooks rule violation - hooks must be at top level, not in conditionals',
      'Invalid hook call': 'Hook called incorrectly - ensure component is functional, check React import',
      'Maximum update depth exceeded': 'Infinite loop in useEffect or render - add dependency array, check conditions',
      'Objects are not valid as a React child': 'Trying to render object - convert to string/JSX, check render return value',

      // Vite errors
      'Failed to resolve import': 'Import path error - check file path, verify file exists',
      'Module not found': 'Cannot find module - check import path, verify package is in package.json',
      'Vite build failed': 'Build error - check TypeScript errors, verify all imports are valid',

      // ESLint errors
      'react-hooks/exhaustive-deps': 'Missing dependency in useEffect/useMemo/useCallback - add to dependency array',
      'no-unused-vars': 'Unused variable - remove or use the variable',
      'prefer-const': 'Use const instead of let - change let to const if variable is not reassigned',

      // Test errors
      'Element not found': 'Test element not found - check selector, verify element is rendered',
      'Text not found': 'Test text not found - check text content, verify component renders correctly',
      'Timeout': 'Test timeout - increase timeout, check async operations complete',
      'TypeError': 'Type error in test - check mock setup, verify types match',

      // Build errors
      'Build failed': 'Build error - check for TypeScript errors, verify all dependencies are installed',
      'npm ERR': 'npm error - check package.json, verify dependencies are valid',
    };
  }

  getIdentifierPatterns(): RegExp[] {
    return [
      // React components
      /(?:export\s+)?(?:default\s+)?(?:function\s+|const\s+)([A-Z][a-zA-Z0-9_]*)\s*(?:=\s*(?:\([^)]*\)\s*=>|async\s*\([^)]*\)\s*=>))/g,
      // TypeScript interfaces
      /\binterface\s+([A-Z][a-zA-Z0-9_]*)/g,
      // TypeScript types
      /\btype\s+([A-Z][a-zA-Z0-9_]*)\s*=/g,
      // Custom hooks
      /(?:export\s+)?(?:default\s+)?(?:function\s+|const\s+)use([A-Z][a-zA-Z0-9_]*)\s*\(/g,
      // Function declarations
      /(?:export\s+)?(?:default\s+)?(?:function\s+|const\s+)([a-z][a-zA-Z0-9_]*)\s*[=:]?\s*(?:\(|async\s*\()/g,
    ];
  }

  getErrorPathPatterns(): RegExp[] {
    return [
      // TypeScript/Vite error paths
      /([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)/g,
      // Stack trace paths
      /at\s+([a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx)):(\d+):(\d+)/g,
    ];
  }

  getBuildCommand(): string {
    return 'npm run build';
  }

  async onAfterApply(changes: CodeChanges): Promise<void> {
    const hasTypeScriptChanges = changes.files?.some(f =>
      f.path.endsWith('.ts') || f.path.endsWith('.tsx')
    );

    const hasComponentChanges = changes.files?.some(f =>
      f.path.includes('/components/') || f.path.includes('/pages/')
    );

    if (hasTypeScriptChanges) {
      console.log('[ReactPlugin] TypeScript changes applied - type check recommended: npm run type-check');
    }

    if (hasComponentChanges) {
      console.log('[ReactPlugin] Component changes applied - verify in browser: npm run dev');
    }
  }

  async onTestFailure(error: string): Promise<string> {
    const guidance: string[] = [];

    // Check for specific React-related test failures
    if (error.includes('TypeError') || error.includes('Cannot read')) {
      guidance.push('TYPE ERROR: Add null checks or optional chaining (?.) for potentially undefined values');
    }

    if (error.includes('Hooks') || error.includes('Invalid hook')) {
      guidance.push('HOOKS ERROR: Ensure hooks are called at top level of functional component, not in conditionals');
    }

    if (error.includes('Module not found') || error.includes('Cannot find module')) {
      guidance.push('IMPORT ERROR: Check import path, verify package is in package.json, run npm install');
    }

    if (error.includes('Timeout') || error.includes('waiting for')) {
      guidance.push('TIMEOUT: Increase test timeout, check async operations complete (await, waitFor)');
    }

    if (error.includes('Element not found') || error.includes('locator')) {
      guidance.push('SELECTOR ERROR: Check element selector, verify component renders the element');
    }

    if (error.includes('Type') && error.includes('not assignable')) {
      guidance.push('TYPE MISMATCH: Check TypeScript types match, verify interface/prop definitions');
    }

    return guidance.length > 0
      ? '\n\n**React-Specific Guidance:**\n' + guidance.map(g => `- ${g}`).join('\n')
      : '';
  }
}