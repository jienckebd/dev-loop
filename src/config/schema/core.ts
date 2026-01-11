import { z } from 'zod';
import { logSourceSchema } from './base';
import { frameworkConfigSchema } from './framework';
import { createPrdSchema } from './prd';
import { createConfigOverlaySchema } from './overlays';

/**
 * Core configuration schema
 *
 * This is the main configuration schema for dev-loop.
 * It includes all core configuration options except PRD-specific schemas
 * which are defined separately in prd.ts.
 */

// We'll create configOverlaySchema and prdSchema after configSchema is defined
// to resolve circular dependencies
let configOverlaySchema: any;
let prdSchema: any;

// Create configSchema with lazy prd field
const configSchemaBase = z.object({
  debug: z.boolean().default(false),
  metrics: z.object({
    enabled: z.boolean().default(true),
    path: z.string().default('.devloop/metrics.json'),
  }).optional(),
  ai: z.object({
    provider: z.enum(['anthropic', 'openai', 'gemini', 'ollama', 'cursor']),
    model: z.string(), // For cursor: 'auto' (default) or specific model name
    fallback: z.string().optional(),
    apiKey: z.string().optional(), // Not used for cursor provider
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
  // PRD Building configuration
  prdBuilding: z.object({
    preProductionDir: z.string().default('.taskmaster/pre-production'),
    productionDir: z.string().default('.taskmaster/production'),
    refinement: z.object({
      interactive: z.boolean().default(true),
      askPrePhaseQuestions: z.boolean().default(true),
      askMidPhaseQuestions: z.boolean().default(true),
      askPostPhaseQuestions: z.boolean().default(true),
      maxRefinementIterations: z.number().default(3).describe('Maximum refinement iterations per phase'),
      showCodebaseInsights: z.boolean().default(true),
      // NEW: Domain-specific rules
      domainRules: z.object({
        conventions: z.array(z.string()).optional().describe('Project-specific coding conventions'),
        architecturalPatterns: z.array(z.string()).optional().describe('Architectural patterns to follow'),
        businessRules: z.array(z.string()).optional().describe('Business domain rules'),
        namingConventions: z.record(z.string(), z.string()).optional().describe('Naming convention patterns'),
      }).optional(),
      // NEW: Pattern libraries
      patternLibraries: z.object({
        schemas: z.array(z.string()).optional().describe('Schema pattern library paths'),
        tests: z.array(z.string()).optional().describe('Test pattern library paths'),
        features: z.array(z.string()).optional().describe('Feature pattern library paths'),
      }).optional(),
      // NEW: Semantic discovery config
      semanticDiscovery: z.object({
        enabled: z.boolean().default(true),
        minScore: z.number().default(0.6).describe('Minimum semantic similarity score'),
        maxResults: z.number().default(10).describe('Maximum files to return per query'),
        cacheEmbeddings: z.boolean().default(true),
      }).optional(),
    }).optional(),
    // NEW: Learning files configuration (patterns, observations, test results)
    learningFiles: z.object({
      enabled: z.boolean().optional().default(true).describe('Enable/disable learning from past data'),
      patterns: z.string().optional().default('.devloop/patterns.json').describe('Path to patterns.json'),
      observations: z.string().optional().default('.devloop/observations.json').describe('Path to observations.json'),
      testResults: z.string().optional().default('.devloop/test-results.json/test-results.json').describe('Path to test-results.json'),
      prdSetState: z.string().optional().default('.devloop/execution-state.json').describe('Path to execution-state.json (unified execution state)'),
      // Filtering options to prevent stale data from interfering
      filtering: z.object({
        patternsRetentionDays: z.number().optional().default(180).describe('Keep patterns used in last N days'),
        observationsRetentionDays: z.number().optional().default(180).describe('Keep observations from last N days'),
        testResultsRetentionDays: z.number().optional().default(180).describe('Keep test results from last N days'),
        prdStateRetentionDays: z.number().optional().default(90).describe('Keep PRD states for completed PRDs'),
        relevanceThreshold: z.number().optional().default(0.5).describe('Minimum relevance score (0-1)'),
        autoPrune: z.boolean().optional().default(true).describe('Auto-prune old entries when loading'),
      }).optional(),
    }).optional(),
  }).optional(),
  // MCP (Model Context Protocol) configuration
  mcp: z.object({
    // Event monitoring configuration for proactive intervention
    eventMonitoring: z.object({
      enabled: z.boolean().default(false),
      pollingInterval: z.number().default(5000).describe('Polling interval in milliseconds'),
      thresholds: z.record(z.string(), z.object({
        count: z.number().optional().describe('Number of events before triggering'),
        rate: z.number().optional().describe('Percentage rate (0-1) before triggering'),
        windowMs: z.number().optional().describe('Time window in milliseconds (0 = no time limit)'),
        autoAction: z.boolean().default(false).describe('Whether to auto-execute fix'),
        confidence: z.number().min(0).max(1).default(0.7).describe('Confidence level required (0-1)'),
      })).optional(),
      actions: z.object({
        requireApproval: z.array(z.string()).default([]).describe('Events that require approval before action'),
        autoExecute: z.array(z.string()).default([]).describe('Events that can auto-execute'),
        maxInterventionsPerHour: z.number().default(10).describe('Rate limiting for interventions'),
      }).optional(),
      metrics: z.object({
        trackInterventions: z.boolean().default(true),
        trackSuccessRate: z.boolean().default(true),
        trackRollbacks: z.boolean().default(true),
      }).optional(),
    }).optional(),
    // Contribution mode issue detection configuration
    contributionMode: z.object({
      enabled: z.boolean().default(true).describe('Enable contribution mode issue detection'),
      issueDetection: z.object({
        codeGenerationDegradation: z.object({
          enabled: z.boolean().default(true),
          alertThreshold: z.number().default(0.20).describe('Alert if degradation rate exceeds X%'),
          trendWindowHours: z.number().default(24).describe('Time window for trend analysis in hours'),
          autoAction: z.boolean().default(false),
          confidence: z.number().min(0).max(1).default(0.75),
        }).optional(),
        contextWindowInefficiency: z.object({
          enabled: z.boolean().default(true),
          efficiencyThreshold: z.number().default(0.001).describe('Minimum acceptable efficiency ratio'),
          missingFileRateThreshold: z.number().default(0.20).describe('Alert if missing file rate exceeds X%'),
          autoAction: z.boolean().default(false),
          confidence: z.number().min(0).max(1).default(0.70),
        }).optional(),
        taskDependencyDeadlock: z.object({
          enabled: z.boolean().default(true),
          maxWaitTimeMinutes: z.number().default(30).describe('Max wait time before alerting in minutes'),
          autoAction: z.boolean().default(true),
          confidence: z.number().min(0).max(1).default(0.80),
        }).optional(),
        testGenerationQuality: z.object({
          enabled: z.boolean().default(true),
          successRateThreshold: z.number().default(0.70).describe('Minimum acceptable success rate'),
          immediateFailureRateThreshold: z.number().default(0.30).describe('Alert if immediate failure rate exceeds X%'),
          autoAction: z.boolean().default(false),
          confidence: z.number().min(0).max(1).default(0.75),
        }).optional(),
        validationGateOverBlocking: z.object({
          enabled: z.boolean().default(true),
          falsePositiveRateThreshold: z.number().default(0.30).describe('Alert if false positive rate exceeds X%'),
          autoAction: z.boolean().default(false),
          confidence: z.number().min(0).max(1).default(0.70),
        }).optional(),
        aiProviderInstability: z.object({
          enabled: z.boolean().default(true),
          errorRateThreshold: z.number().default(0.10).describe('Alert if error rate exceeds X%'),
          timeoutRateThreshold: z.number().default(0.10).describe('Alert if timeout rate exceeds X%'),
          qualityTrendThreshold: z.number().default(-0.10).describe('Alert if quality trend is below X (negative = degrading)'),
          autoAction: z.boolean().default(true),
          confidence: z.number().min(0).max(1).default(0.75),
        }).optional(),
        resourceExhaustion: z.object({
          enabled: z.boolean().default(true),
          memoryUsageThreshold: z.number().default(0.80).describe('Alert if memory usage exceeds X%'),
          diskUsageThreshold: z.number().default(0.80).describe('Alert if disk usage exceeds X%'),
          timeoutRateThreshold: z.number().default(0.10).describe('Alert if timeout rate exceeds X%'),
          autoAction: z.boolean().default(false),
          confidence: z.number().min(0).max(1).default(0.70),
        }).optional(),
        phaseProgressionStalling: z.object({
          enabled: z.boolean().default(true),
          minProgressRate: z.number().default(0.1).describe('Minimum acceptable progress rate (tasks/hour)'),
          maxStallDurationMinutes: z.number().default(60).describe('Max stall duration before alerting in minutes'),
          autoAction: z.boolean().default(true),
          confidence: z.number().min(0).max(1).default(0.75),
        }).optional(),
        patternLearningInefficacy: z.object({
          enabled: z.boolean().default(true),
          matchToApplicationRateThreshold: z.number().default(0.50).describe('Minimum acceptable match-to-application rate'),
          recurringPatternRateThreshold: z.number().default(0.30).describe('Alert if recurring pattern rate exceeds X%'),
          autoAction: z.boolean().default(false),
          confidence: z.number().min(0).max(1).default(0.70),
        }).optional(),
        schemaValidationConsistency: z.object({
          enabled: z.boolean().default(true),
          falsePositiveRateThreshold: z.number().default(0.20).describe('Alert if false positive rate exceeds X%'),
          validationTimeTrendThreshold: z.number().default(1000).describe('Alert if validation time trend exceeds X ms'),
          autoAction: z.boolean().default(false),
          confidence: z.number().min(0).max(1).default(0.70),
        }).optional(),
      }).optional(),
    }).optional(),
    // MCP adapter configurations (for future open source MCP integration)
    adapters: z.object({
      filesystem: z.object({
        enabled: z.boolean().default(false),
        allowedPaths: z.array(z.string()).optional(),
        readOnlyPaths: z.array(z.string()).optional(),
        tddIntegration: z.object({
          enabled: z.boolean().default(false),
          testFilePatterns: z.array(z.string()).optional(),
          implementationFilePatterns: z.array(z.string()).optional(),
          comparePairs: z.boolean().default(true),
          trackCoverage: z.boolean().default(true),
        }).optional(),
      }).optional(),
      git: z.object({
        enabled: z.boolean().default(false),
        devloopPath: z.string().default('node_modules/dev-loop'),
        autoCommit: z.boolean().default(false),
        validateBeforeCommit: z.boolean().default(true),
        tddValidation: z.object({
          enabled: z.boolean().default(false),
          enforceTestFirst: z.boolean().default(true),
          checkCommitOrder: z.boolean().default(true),
          maxTimeBetweenCommits: z.number().default(3600),
        }).optional(),
      }).optional(),
      playwright: z.object({
        enabled: z.boolean().default(false),
        browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
        headless: z.boolean().default(true),
        screenshotOnFailure: z.boolean().default(true),
        traceOnFailure: z.boolean().default(true),
        tddIntegration: z.object({
          enabled: z.boolean().default(false),
          testFirstExecution: z.boolean().default(true),
          generateTestsFromBrowser: z.boolean().default(true),
          visualRegression: z.boolean().default(true),
          traceAnalysis: z.boolean().default(true),
          testGeneration: z.object({
            recordInteractions: z.boolean().default(true),
            generateAssertions: z.boolean().default(true),
            framework: z.string().default('playwright'),
          }).optional(),
        }).optional(),
      }).optional(),
      database: z.object({
        enabled: z.boolean().default(false),
        type: z.string().optional(),
        connectionString: z.string().optional(),
        readOnly: z.boolean().default(true),
        tddIntegration: z.object({
          enabled: z.boolean().default(false),
          schemaValidation: z.boolean().default(true),
          stateReset: z.boolean().default(true),
          dataSeeding: z.boolean().default(true),
        }).optional(),
      }).optional(),
    }).optional(),
    // MCP tools configuration
    tools: z.object({
      observation: z.object({
        enabled: z.boolean().default(true),
        patternDetection: z.boolean().default(true),
      }).optional(),
      testAutomation: z.object({
        enabled: z.boolean().default(true),
        testFirst: z.boolean().default(true),
      }).optional(),
      codeQuality: z.object({
        enabled: z.boolean().default(true),
        realTime: z.boolean().default(false),
      }).optional(),
      workflowOrchestration: z.object({
        enabled: z.boolean().default(true),
        parallelControl: z.boolean().default(true),
      }).optional(),
    }).optional(),
  }).optional(),
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
    // NEW: Paths to search for documentation files
    documentationPaths: z.array(z.string()).optional().describe('Paths to search for documentation (e.g., docs/, .taskmaster/docs/)'),
    // NEW: Paths where code can be edited during PRD generation
    editablePaths: z.array(z.string()).optional().describe('Paths where code can be edited (e.g., docroot/modules/share/, tests/playwright/auto/)'),
    // NEW: Paths that should never be edited (protected files/directories)
    protectedPaths: z.array(z.string()).optional().describe('Paths that should never be edited (e.g., docroot/core/, docroot/modules/contrib/, playwright.config.ts)'),
  }).optional(),
  // Framework-specific configuration (makes dev-loop framework-agnostic)
  // Framework-specific extensions go in framework.config.{frameworkType}
  framework: frameworkConfigSchema.optional(),

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
    // Skip investigation task creation (investigation slows down execution)
    skipInvestigation: z.boolean().default(false),
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
    // Test refinement interval
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

  // PRD-driven implementation configuration
  // Use z.lazy() to avoid circular dependency - will be resolved after prdSchema is created
  prd: z.lazy(() => {
    if (!prdSchema) {
      throw new Error('prdSchema not initialized. This should not happen.');
    }
    return prdSchema;
  }).optional(),

  // NOTE: Drupal-specific config has been moved to framework.config.drupal
  // See: framework: { config: { drupal: { ... } } }
  // This makes dev-loop framework-agnostic while allowing framework-specific extensions

  // NOTE: Wizard and DesignSystem are project-specific schemas
  // They should only exist in PRD config overlays, not in base dev-loop config
  // See PRD frontmatter config: section for project-specific configuration

  // Test generation configuration (for AI prompts)
  testGeneration: z.object({
    // Import statements for generated tests
    imports: z.array(z.string()).optional(),
    // Base URL for tests
    baseUrl: z.string().optional(),
    // Test setup boilerplate pattern
    setupPattern: z.string().optional(),
    // Selector documentation
    selectors: z.record(z.string(), z.any()).optional(),
    // Entity save timing rules
    entitySaveTiming: z.object({
      rules: z.array(z.object({
        id: z.string(),
        description: z.string(),
      })).optional(),
      stepProcessing: z.record(z.string(), z.string()).optional(),
      validationRequirements: z.record(z.string(), z.array(z.string())).optional(),
    }).optional(),
    // Test isolation rules
    isolationRules: z.array(z.string()).optional(),
    // Test template with placeholders
    template: z.string().optional(),
  }).optional(),

  // Code quality scanning configuration
  scan: z.object({
    enabled: z.boolean().default(true),
    schedule: z.enum(['manual', 'pre-commit', 'nightly']).default('manual'),
    tools: z.object({
      staticAnalysis: z.boolean().default(true),
      duplicateDetection: z.boolean().default(true),
      security: z.boolean().default(true),
      complexity: z.boolean().default(false),
      techDebt: z.boolean().default(true),
    }).optional(),
    thresholds: z.object({
      maxDuplicateLines: z.number().default(10),
      maxComplexity: z.number().default(15),
      failOnSecurityVulnerability: z.boolean().default(true),
    }).optional(),
    output: z.object({
      path: z.string().default('.devloop/scan-results'),
      formats: z.array(z.enum(['json', 'markdown', 'sarif'])).default(['json', 'markdown']),
    }).optional(),
    taskCreation: z.object({
      enabled: z.boolean().default(false),
      minSeverity: z.enum(['info', 'warning', 'error']).default('warning'),
      groupBy: z.enum(['file', 'rule', 'severity']).default('rule'),
    }).optional(),
  }).optional(),

  // Cursor AI provider configuration
  cursor: z.object({
    // Path for Cursor AI request/response files (relative to project root)
    requestsPath: z.string().default('files-private/cursor'),
    // Agent name for multi-agent workflows (matches AGENTS.md)
    agentName: z.string().default('DevLoopCodeGen'),
    // Default model to request (auto, claude-sonnet, gpt-4, etc.)
    model: z.string().default('auto'),
    // Agent configuration for auto-generation and chat creation
    agents: z.object({
      // Enable agent auto-generation and chat request system
      enabled: z.boolean().default(true),
      // Automatically generate agent config files in .cursor/agents/
      autoGenerate: z.boolean().default(true),
      // Path to agent config files directory (relative to project root)
      agentsPath: z.string().default('.cursor/agents'),
      // Path to chat requests JSON file
      chatRequestsPath: z.string().default('files-private/cursor/chat-requests.json'),
      // Path to chat instruction files directory (use .cursor/chat-instructions/ so Cursor can detect them)
      chatInstructionsPath: z.string().default('.cursor/chat-instructions'),
      // Default chat mode (Ask, Chat, Compose)
      defaultMode: z.enum(['Ask', 'Chat', 'Compose']).default('Ask'),
      // Auto-process chat requests in watch mode (100% automation)
      autoProcess: z.boolean().default(true),
      // Enable file watching for new chat requests
      watchMode: z.boolean().default(true),
      // Polling interval in milliseconds for checking new requests
      processInterval: z.number().default(2000),
      // Automatically open instruction files in Cursor when created
      autoOpen: z.boolean().default(true),
      // Automatically open chats via CLI when created
      autoOpenChats: z.boolean().default(true),
      // Open as agent chat (vs editor tab)
      openAsAgent: z.boolean().default(true),
      // Open as editor tab (alternative to agent)
      openAsTab: z.boolean().default(false),
      // Strategy for opening chats: 'auto', 'cli', 'agent', 'ide', 'file', 'manual'
      openStrategy: z.enum(['auto', 'cli', 'agent', 'ide', 'file', 'manual']).default('agent'),
      // Fallback to manual instructions if auto-open fails
      fallbackToManual: z.boolean().default(true),
      // Prefer IDE chat integration (prompt files for composer) over terminal agent
      preferIdeChat: z.boolean().default(false),
      // Enable keyboard automation for macOS (AppleScript-based Cmd+L simulation)
      keyboardAutomation: z.boolean().default(false),
      // Fully automate chat opening (skip file opening, go straight to composer with paste)
      // Requires keyboardAutomation: true and macOS
      fullAutomation: z.boolean().default(false),
      // Format for prompt files: 'markdown' or 'plain'
      promptFileFormat: z.enum(['markdown', 'plain']).default('markdown'),
      // Path to composer-ready prompt files
      chatPromptsPath: z.string().default('.cursor/chat-prompts'),
      // Use background agent mode (--print) for headless operation
      useBackgroundAgent: z.boolean().default(true),
      // Output format for background agent: 'json', 'text', or 'stream-json'
      agentOutputFormat: z.enum(['json', 'text', 'stream-json']).default('json'),
      // Create visible chat agents for observability and guidance (runs parallel to background agents)
      createObservabilityChats: z.boolean().default(true),
      // Strategy for opening observability chats: 'agent', 'ide', 'file', 'manual'
      observabilityStrategy: z.enum(['agent', 'ide', 'file', 'manual']).default('agent'),
      // Fallback to file-based method if background agent fails
      fallbackToFileBased: z.boolean().default(true),
      // Session management for context persistence between background agent calls
      sessionManagement: z.object({
        // Enable session management (default: true)
        enabled: z.boolean().default(true),
        // Maximum session age in milliseconds before cleanup (default: 1 hour)
        maxSessionAge: z.number().int().default(3600000),
        // Maximum number of history entries per session (default: 50)
        maxHistoryItems: z.number().int().default(50),
        // Path to sessions storage file (relative to project root)
        // Note: Sessions are now stored in execution-state.json, but this path can be used for backward compatibility
        sessionsPath: z.string().default('.devloop/execution-state.json'),
      }).optional(),
    }).optional(),
  }).optional(),

  // AI pattern detection configuration
  aiPatterns: z.object({
    enabled: z.boolean().default(false),
    provider: z.enum(['anthropic', 'openai', 'ollama', 'auto']).default('auto'),
    providers: z.object({
      anthropic: z.object({
        apiKey: z.string().optional(),
        model: z.string().default('claude-3-haiku-20240307'),
        embeddingModel: z.string().default('voyage-3'),
      }).optional(),
      openai: z.object({
        apiKey: z.string().optional(),
        model: z.string().default('gpt-4o-mini'),
        embeddingModel: z.string().default('text-embedding-3-small'),
      }).optional(),
      ollama: z.object({
        baseUrl: z.string().default('http://localhost:11434'),
        model: z.string().default('codellama'),
        embeddingModel: z.string().default('nomic-embed-text'),
      }).optional(),
    }).optional(),
    analysis: z.object({
      mode: z.enum(['embeddings-only', 'llm-only', 'hybrid']).default('hybrid'),
      similarityThreshold: z.number().min(0).max(1).default(0.85),
      minOccurrences: z.number().int().min(2).default(3),
    }).optional(),
    costs: z.object({
      maxTokensPerScan: z.number().int().default(100000),
      maxRequestsPerScan: z.number().int().default(50),
      enableCaching: z.boolean().default(true),
      batchSize: z.number().int().default(10),
    }).optional(),
    learning: z.object({
      enabled: z.boolean().default(false),
      feedbackFile: z.string().default('.devloop/ai-feedback.json'),
    }).optional(),
  }).optional(),

  // AST parsing configuration (Phase 1 enhancement)
  ast: z.object({
    enabled: z.boolean().default(true),
    languages: z.array(z.enum(['typescript', 'javascript', 'python', 'php'])).default(['typescript', 'javascript', 'php']),
    includeDocComments: z.boolean().default(true),
    includeSignatures: z.boolean().default(true),
    maxFileSizeBytes: z.number().default(1024 * 1024),
    cacheEnabled: z.boolean().default(true),
    cachePath: z.string().default('.devloop/ast-cache.json'),
  }).optional(),

  // Playwright MCP integration for TDD (Phase 5 enhancement)
  playwrightMCP: z.object({
    enabled: z.boolean().default(true),
    server: z.string().default('playwright'),
    tdd: z.object({
      enabled: z.boolean().default(true),
      writeTestsFirst: z.boolean().default(true),
      runTestsAfterImplementation: z.boolean().default(true),
      fixRootCauses: z.boolean().default(true),
    }).optional(),
    browser: z.object({
      headless: z.boolean().default(true),
      timeout: z.number().default(30000),
      screenshotsDir: z.string().default('.devloop/screenshots'),
    }).optional(),
  }).optional(),

  // Documentation generation configuration (Phase 6 enhancement)
  documentation: z.object({
    enabled: z.boolean().default(false),
    outputDir: z.string().default('docs/api'),
    includePrivate: z.boolean().default(false),
    includeExamples: z.boolean().default(true),
    generateDiagrams: z.boolean().default(true),
    generateOnChange: z.boolean().default(false),
  }).optional(),

  // Security scanning configuration (Phase 7 enhancement)
  security: z.object({
    enabled: z.boolean().default(true),
    scanOnPush: z.boolean().default(true),
    patterns: z.array(z.object({
      id: z.string(),
      pattern: z.string(),
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      message: z.string(),
      remediation: z.string().optional(),
    })).optional(),
    ignorePaths: z.array(z.string()).optional(),
    codeQLEnabled: z.boolean().default(false),
    snykEnabled: z.boolean().default(false),
    dependencyCheck: z.boolean().default(true),
  }).optional(),

  // Code style enforcement (Phase 7 enhancement)
  style: z.object({
    enabled: z.boolean().default(true),
    autoFix: z.boolean().default(true),
    configPath: z.string().optional(),
    rules: z.record(z.string(), z.enum(['error', 'warn', 'off'])).optional(),
  }).optional(),

  // Health scoring configuration (Phase 8 enhancement)
  health: z.object({
    enabled: z.boolean().default(true),
    historyPath: z.string().default('.devloop/health-history.json'),
    thresholds: z.object({
      quality: z.number().default(70),
      maintainability: z.number().default(70),
      testCoverage: z.number().default(60),
      documentation: z.number().default(50),
      security: z.number().default(80),
    }).optional(),
    reportOnComplete: z.boolean().default(true),
  }).optional(),

  // Refactoring configuration (Phase 9 enhancement)
  refactoring: z.object({
    enabled: z.boolean().default(false),
    autoSuggest: z.boolean().default(true),
    maxSuggestions: z.number().default(20),
    minConfidence: z.number().default(0.7),
    backupBeforeApply: z.boolean().default(true),
  }).optional(),

  // Archive configuration
  archive: z.object({
    defaultPath: z.string().optional().default('.devloop/archive').describe('Default archive directory path'),
    excludeLearningFiles: z.boolean().optional().default(true).describe('Don\'t archive learning JSON files (patterns.json, observations.json, test-results.json)'),
    // Pruning options (only applies when --prune is used)
    pruning: z.object({
      enabled: z.boolean().optional().default(false).describe('Auto-prune on archive (default: false, manual via --prune flag)'),
      patternsRetentionDays: z.number().optional().default(180).describe('Keep patterns used in last N days'),
      observationsRetentionDays: z.number().optional().default(180).describe('Keep observations from last N days'),
      testResultsRetentionDays: z.number().optional().default(180).describe('Keep test results from last N days'),
      prdStateRetentionDays: z.number().optional().default(90).describe('Keep PRD states for completed/cancelled PRDs'),
      checkpointRetentionDays: z.number().optional().default(30).describe('Keep PRD building checkpoints for N days'),
    }).optional(),
  }).optional(),
});

// Now create the full configSchema with prd field
export const configSchema = configSchemaBase;

export type Config = z.infer<typeof configSchema>;

// Initialize circular dependencies after configSchema is defined
// Create configOverlaySchema from configSchema
configOverlaySchema = createConfigOverlaySchema(configSchema);

// Create prdSchema using configOverlaySchema
prdSchema = createPrdSchema(configOverlaySchema);

// Export configOverlaySchema for use in other files
export { configOverlaySchema };

