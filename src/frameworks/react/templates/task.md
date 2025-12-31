# React Task Implementation

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