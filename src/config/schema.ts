import { z } from 'zod';

const logSourceSchema = z.object({
  type: z.enum(['file', 'command']),
  path: z.string().optional(),
  command: z.string().optional(),
});

const configSchema = z.object({
  debug: z.boolean().default(false),
  metrics: z.object({
    enabled: z.boolean().default(true),
    path: z.string().default('.devloop/metrics.json'),
  }).optional(),
  ai: z.object({
    provider: z.enum(['anthropic', 'openai', 'gemini', 'ollama']),
    model: z.string(),
    fallback: z.string().optional(),
    apiKey: z.string().optional(),
    maxTokens: z.number().optional(),
    maxContextChars: z.number().optional(),
  }),
  templates: z.object({
    source: z.enum(['builtin', 'ai-dev-tasks', 'custom']),
    customPath: z.string().optional(),
  }),
  testing: z.object({
    runner: z.enum(['playwright', 'cypress']),
    command: z.string(),
    timeout: z.number(),
    artifactsDir: z.string(),
  }),
  // Smoke test validation - validates runtime behavior via HTTP requests
  validation: z.object({
    // Whether to run smoke tests after code changes
    enabled: z.boolean().default(true),
    // Base URL for smoke tests
    baseUrl: z.string(),
    // URLs to test (relative to baseUrl)
    urls: z.array(z.string()),
    // Timeout for each request in ms
    timeout: z.number().optional(),
    // Command to get authentication (e.g., "ddev exec drush uli")
    authCommand: z.string().optional(),
  }).optional(),
  logs: z.object({
    sources: z.array(logSourceSchema),
    patterns: z.object({
      error: z.union([z.string(), z.instanceof(RegExp)]),
      warning: z.union([z.string(), z.instanceof(RegExp)]),
    }),
    ignorePatterns: z.array(z.string()).optional(),
    useAI: z.boolean(),
    // Path to dev-loop's own log file (captures debug output, AI calls, etc.)
    outputPath: z.string().optional(),
  }),
  intervention: z.object({
    mode: z.enum(['autonomous', 'review', 'hybrid']),
    approvalRequired: z.array(z.string()),
  }),
  taskMaster: z.object({
    tasksPath: z.string(),
  }),
  hooks: z.object({
    preTest: z.array(z.string()).optional(),
    postTest: z.array(z.string()).optional(),
    postApply: z.array(z.string()).optional(),
  }).optional(),
  // Cursor rules configuration for injecting project rules into AI prompts
  rules: z.object({
    cursorRulesPath: z.string().optional(),
  }).optional(),
  // Codebase configuration for dynamic file discovery
  codebase: z.object({
    // File extensions to search for when discovering files
    extensions: z.array(z.string()).optional(),
    // Directories to search in (relative to project root)
    searchDirs: z.array(z.string()).optional(),
    // Directories to exclude from search
    excludeDirs: z.array(z.string()).optional(),
    // File path patterns to extract from task text (regex patterns)
    filePathPatterns: z.array(z.string()).optional(),
    // Glob patterns to ignore during file discovery
    ignoreGlobs: z.array(z.string()).optional(),
    // Stopwords to filter out from identifier search
    identifierStopwords: z.array(z.string()).optional(),
  }).optional(),
  // Framework-specific configuration (makes dev-loop framework-agnostic)
  framework: z.object({
    // Framework type for template selection (e.g., 'drupal', 'laravel', 'rails', 'nextjs')
    type: z.string().optional(),
    // Custom rules to inject into AI prompts for this framework
    rules: z.array(z.string()).optional(),
    // Patterns to detect framework-specific tasks (regex patterns matched against task text)
    taskPatterns: z.array(z.string()).optional(),
    // File path patterns for extracting paths from error messages (regex patterns)
    errorPathPatterns: z.array(z.string()).optional(),
    // Error message guidance - maps error substrings to helpful guidance
    errorGuidance: z.record(z.string(), z.string()).optional(),
    // Identifier patterns for extracting function/class names (regex patterns)
    identifierPatterns: z.array(z.string()).optional(),
    // Custom template path for framework-specific task templates
    templatePath: z.string().optional(),
  }).optional(),

  // Enhanced context configuration for better AI prompts
  context: z.object({
    // Include file skeleton in prompts (shows available helpers)
    includeSkeleton: z.boolean().default(true),
    // Include import section explicitly
    includeImports: z.boolean().default(true),
    // Max helper signatures to show
    maxHelperSignatures: z.number().default(20),
  }).optional(),

  // Pre-apply validation configuration
  preValidation: z.object({
    // Enable pre-apply validation
    enabled: z.boolean().default(true),
    // Max validation retries before creating fix task
    maxRetries: z.number().default(2),
    // Validate TypeScript syntax
    validateSyntax: z.boolean().default(true),
    // Validate function references exist (more expensive)
    validateReferences: z.boolean().default(false),
  }).optional(),

  // Pattern learning configuration
  patternLearning: z.object({
    // Enable pattern learning
    enabled: z.boolean().default(true),
    // Path to patterns file
    patternsPath: z.string().default('.devloop/patterns.json'),
    // Include builtin patterns
    useBuiltinPatterns: z.boolean().default(true),
  }).optional(),

  // Autonomous PRD execution configuration
  autonomous: z.object({
    // Enable autonomous mode
    enabled: z.boolean().default(true),
    // Test generation configuration
    testGeneration: z.object({
      framework: z.enum(['playwright', 'cypress', 'jest']).default('playwright'),
      testDir: z.string().default('tests/playwright/auto'),
      baseTestTemplate: z.string().optional(),
    }).optional(),
    // Iteration limits
    maxIterations: z.number().default(100),
    maxTaskRetries: z.number().default(3),
    stuckDetectionWindow: z.number().default(5),
    // Context management
    contextPath: z.string().default('.devloop/prd-context'),
    maxHistoryIterations: z.number().default(50),
    // Test evolution
    testEvolutionInterval: z.number().default(5),
    // Learning
    learnFromSuccess: z.boolean().default(true),
    learnFromFailure: z.boolean().default(true),
  }).optional(),

  // Browser automation configuration
  browser: z.object({
    headless: z.boolean().default(true),
    timeout: z.number().default(30000),
    screenshotOnFailure: z.boolean().default(true),
    screenshotsDir: z.string().default('.devloop/screenshots'),
    videoOnFailure: z.boolean().default(false),
  }).optional(),
});

export type Config = z.infer<typeof configSchema>;

export function validateConfig(data: unknown): Config {
  return configSchema.parse(data);
}
