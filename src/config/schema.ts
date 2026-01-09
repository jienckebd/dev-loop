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

  // PRD-driven implementation configuration
  prd: z.object({
    // PRD file path (can be overridden via CLI)
    defaultPath: z.string().default('.taskmaster/docs/prd.md'),
    // Requirement ID prefix pattern
    requirementPattern: z.string().default('REQ-'),
    // Auto-parse structured requirements (vs AI parsing)
    useStructuredParsing: z.boolean().default(true),
    // Generate implementation code (not just tests)
    generateImplementation: z.boolean().default(true),
    // Files that should never be modified
    protectedFiles: z.array(z.string()).optional(),
    // Requirement dependency graph (requirement ID -> array of prerequisite requirement IDs)
    dependencies: z.record(z.array(z.string())).optional(),
    // Execute requirements in dependency order
    resolveDependencies: z.boolean().default(false),
    // Requirement status tracking
    statusTracking: z.object({
      enabled: z.boolean().default(false),
      outputPath: z.string().default('.devloop/prd-status.json'),
    }).optional(),
    // NEW: PRD metadata support
    metadata: z.object({
      id: z.string(),
      version: z.string(),
      status: z.enum(['planning', 'ready', 'active', 'blocked', 'complete']),
    }).optional(),
    // NEW: Execution strategy configuration
    execution: z.object({
      strategy: z.enum(['sequential', 'parallel', 'phased']).default('sequential'),
      parallelism: z.object({
        testGeneration: z.number().default(1),     // Batch size for AI calls
        testExecution: z.number().default(1),       // Playwright workers
        requirementGroups: z.boolean().default(false),
      }).optional(),
      maxIterations: z.number().default(100),
      timeoutMinutes: z.number().default(60),
      waitForPrds: z.boolean().default(false),      // Block until dependent PRDs complete
    }).optional(),
    // Requirements structure and phases (now supports phase-level config overlays)
    requirements: z.object({
      idPattern: z.string().default('REQ-{id}'),
      phases: z.array(z.object({
        id: z.number(),
        name: z.string(),
        range: z.string().optional(),              // "REQ-401 to REQ-402"
        pattern: z.string().optional(),            // "REQ-4{number}"
        parallel: z.boolean().default(false),
        dependsOn: z.array(z.number()).optional(), // Phase IDs
        status: z.string().optional(),
        deferredReason: z.string().optional(),
        note: z.string().optional(),
        file: z.string().optional(),
        checkpoint: z.boolean().optional(),
        validation: z.object({
          after: z.array(z.string()).optional(),
          tests: z.array(z.string()).optional(),
          assertions: z.array(z.string()).optional(),
        }).optional(),
        // Phase config overlay (NEW) - allows phase-specific config overrides
        config: z.lazy(() => configOverlaySchema).optional(),
      })).optional(),
      dependencies: z.record(z.array(z.string())).optional(), // Explicit requirement dependencies
    }).optional(),
    // NEW: Testing configuration
    testing: z.object({
      directory: z.string(),
      framework: z.enum(['playwright', 'cypress', 'jest']).default('playwright'),
      parallel: z.boolean().default(true),
      workers: z.number().default(4),
      bundledTests: z.boolean().default(false),    // Tests embedded in requirements vs separate files
      cleanupArtifacts: z.boolean().default(true),
    }).optional(),
    // NEW: PRD-level dependencies on external modules or other PRDs
    prdDependencies: z.object({
      externalModules: z.array(z.string()).optional(),  // Drupal modules
      prds: z.array(z.string()).optional(),             // Other PRDs that must complete first
    }).optional(),
    // Config overlay from PRD (merged at runtime) - now uses typed overlay schema
    configOverlay: z.lazy(() => configOverlaySchema).optional(),

    // NEW: Product identity and Schema.org mapping
    product: z.object({
      id: z.string(),
      version: z.string(),
      status: z.enum(['planning', 'ready', 'active', 'blocked', 'complete', 'deprecated']),
      schemaOrg: z.object({
        type: z.string(),
        additionalTypes: z.array(z.string()).optional(),
        properties: z.record(z.string()).optional(),
      }).optional(),
      metadata: z.object({
        author: z.string().optional(),
        created: z.string().optional(),
        modified: z.string().optional(),
        license: z.string().optional(),
        tags: z.array(z.string()).optional(),
        category: z.string().optional(),
      }).optional(),
    }).optional(),

    // NEW: OpenAPI schema definition
    openapi: z.object({
      specUrl: z.string().url().optional(),
      specPath: z.string().optional(),
      components: z.object({
        schemas: z.record(z.any()).optional(),
      }).optional(),
      schemasToImport: z.array(z.string()).optional(),
      fieldTypeMapping: z.record(z.string(), z.string()).optional(),
    }).optional(),

    // NEW: Entity generation templates
    entityGeneration: z.object({
      entityType: z.object({
        id: z.string(),
        label: z.string(),
        type: z.enum(['config', 'content']),
        base: z.string().optional(),
        schemaOrg: z.object({
          type: z.string(),
          subtype: z.string().optional(),
        }).optional(),
      }).optional(),
      bundles: z.array(z.object({
        schemaName: z.string(),
        bundleId: z.string(),
        label: z.string(),
        schemaOrg: z.object({
          type: z.string(),
          properties: z.record(z.string()).optional(),
        }).optional(),
      })).optional(),
      fieldMappings: z.object({
        global: z.record(z.object({
          fieldName: z.string(),
          fieldType: z.string(),
          required: z.boolean().optional(),
        })).optional(),
      }).passthrough().optional(), // Allows bundle-specific mappings
    }).optional(),

    // NEW: Schema.org mapping configuration
    schemaOrg: z.object({
      namespace: z.string().url().default('https://schema.org/'),
      primaryType: z.string().optional(),
      strategy: z.enum(['manual', 'ai_assisted', 'auto']).default('manual'),
      aiProvider: z.string().optional(),
      typeMappings: z.record(z.object({
        type: z.string(),
        subTypes: z.array(z.string()).optional(),
        properties: z.record(z.string()).optional(),
      })).optional(),
      propertyMappings: z.record(z.string()).optional(),
      customVocabulary: z.object({
        prefix: z.string(),
        namespace: z.string().url(),
        terms: z.array(z.object({
          id: z.string(),
          label: z.string(),
          subClassOf: z.string().optional(),
        })).optional(),
      }).optional(),
    }).optional(),

    // NEW: Validation and acceptance criteria
    validation: z.object({
      criteriaFormat: z.enum(['gherkin', 'assertions', 'custom']).default('gherkin'),
      globalRules: z.array(z.object({
        rule: z.string(),
        description: z.string(),
        test: z.string(),
      })).optional(),
      requirementTests: z.record(z.object({
        description: z.string(),
        acceptance: z.array(z.object({
          given: z.string().optional(),
          when: z.string().optional(),
          then: z.string().optional(),
          and: z.string().optional(),
        })).optional(),
        assertions: z.array(z.any()).optional(),
        testFile: z.string().optional(),
      })).optional(),
      fieldValidation: z.record(z.array(z.object({
        constraint: z.string(),
        when: z.string().optional(),
        message: z.string().optional(),
        pattern: z.string().optional(),
      }))).optional(),
      integrationTests: z.array(z.object({
        name: z.string(),
        requirements: z.array(z.string()),
        testSuite: z.string(),
      })).optional(),
    }).optional(),

    // NEW: Sync and feed configuration
    sync: z.object({
      feeds: z.array(z.object({
        feedTypeId: z.string(),
        label: z.string(),
        importUrl: z.string(),
        schedule: z.string().optional(),
        fieldMappings: z.record(z.string()).optional(),
      })).optional(),
      webhooks: z.array(z.object({
        id: z.string(),
        path: z.string(),
        events: z.array(z.enum(['create', 'update', 'delete'])),
        targetEntity: z.string(),
        authentication: z.object({
          type: z.string(),
          header: z.string().optional(),
        }).optional(),
      })).optional(),
      conflictResolution: z.object({
        strategy: z.enum(['last_write_wins', 'server_wins', 'client_wins', 'manual']).default('last_write_wins'),
        notifyOnConflict: z.boolean().default(false),
      }).optional(),
    }).optional(),

    // NEW: PRD relationships
    relationships: z.object({
      dependsOn: z.array(z.object({
        prd: z.string(),
        reason: z.string(),
        waitForCompletion: z.boolean().default(false),
      })).optional(),
      dependedOnBy: z.array(z.object({
        prd: z.string(),
        features: z.array(z.string()).optional(),
      })).optional(),
      relatedTo: z.array(z.object({
        prd: z.string(),
        relationship: z.string(),
      })).optional(),
      entityRelationships: z.record(z.array(z.object({
        targetType: z.string(),
        relationship: z.string(),
        cardinality: z.enum(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']),
      }))).optional(),
    }).optional(),
  }).optional(),

  // Drupal-specific implementation configuration
  drupal: z.object({
    // Enable Drupal-specific code generation
    enabled: z.boolean().default(true),
    // DDEV project name (for commands)
    ddevProject: z.string().optional(),
    // Cache clear command
    cacheCommand: z.string().default('ddev exec drush cr'),
    // Site health check URL
    healthCheckUrl: z.string().optional(),
    // Service registry path (for dependency injection context)
    servicesPath: z.string().default('docroot/modules/share/*/services.yml'),
    // Schema path (for config schema context)
    schemaPath: z.string().default('docroot/modules/share/bd/config/schema/bd.schema.yml'),
    // Field type mapping (OpenAPI type -> Drupal field type)
    fieldTypeMapping: z.record(z.string(), z.string()).optional(),
    // Entity type builder service
    entityTypeBuilder: z.string().default('entity_type.builder'),
    // Common import namespaces
    namespaces: z.array(z.string()).optional(),
    // Wizard-specific patterns
    wizardPatterns: z.object({
      prePopulationHook: z.string().optional(),
      entitySaveHook: z.string().optional(),
      thirdPartySettings: z.record(z.array(z.string())).optional(),
      idFormats: z.object({
        feedType: z.string().optional(),
        webhook: z.string().optional(),
        maxLength: z.number().optional(),
      }).optional(),
      validationPatterns: z.array(z.string()).optional(),
    }).optional(),
    // Drupal coding standards
    codingStandards: z.array(z.string()).optional(),
  }).optional(),

  // Wizard-specific testing configuration
  wizard: z.object({
    // Base URL for wizard
    baseUrl: z.string().default('/admin/content/wizard/add/api_spec'),
    // Existing wizard edit URL pattern
    editUrlPattern: z.string().default('/admin/content/wizard/{id}/edit'),
    // Steps configuration (for test generation)
    steps: z.array(z.object({
      number: z.number(),
      name: z.string(),
      formMode: z.string(),
      visibilityCondition: z.string().optional(),
      keyFields: z.array(z.string()),
      nextButtonText: z.string().optional(),
    })).optional(),
    // IEF widget selectors
    iefSelectors: z.object({
      container: z.string().default('[data-drupal-selector*="inline-entity-form"]'),
      table: z.string().default('.ief-table, table.ief-entity-table'),
      addButton: z.string().default('input[value*="Add"], button:has-text("Add")'),
    }).optional(),
    // Sample OpenAPI schemas for testing
    sampleSchemas: z.array(z.object({
      name: z.string(),
      path: z.string(),
    })).optional(),
    // Hook processing documentation
    hooks: z.object({
      prePopulation: z.string().optional(),
      stepSave: z.string().optional(),
      fieldCreation: z.string().optional(),
    }).optional(),
    // Step processing order
    stepProcessing: z.record(z.string()).optional(),
    // Validation requirements
    validationRequirements: z.record(z.array(z.string())).optional(),
  }).optional(),

  // Design System module configuration
  designSystem: z.object({
    // === THEME ENTITY ===
    themeEntity: z.object({
      testEntityId: z.number().default(21),
      editUrl: z.string().default('/theme_entity/{id}/edit'),
      tabs: z.array(z.string()).default([
        'Theme', 'Layout', 'Components', 'Elements',
        'Colors', 'Fonts', 'Devices', 'Integrations',
      ]),
      fields: z.array(z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean().default(false),
      })).default([
        { name: 'field_layout', type: 'entity_reference_revisions', required: false },
        { name: 'field_color_scheme', type: 'entity_reference', required: false },
        { name: 'field_dom_tag', type: 'entity_reference', required: false },
        { name: 'field_tag_group', type: 'entity_reference', required: false },
        { name: 'field_selector', type: 'entity_reference', required: false },
        { name: 'field_breakpoint', type: 'entity_reference', required: false },
        { name: 'field_font', type: 'entity_reference', required: false },
        { name: 'field_integration', type: 'entity_reference', required: false },
      ]),
      formModes: z.array(z.string()).default(['default', 'edit']),
      viewModes: z.array(z.string()).default(['default', 'full', 'teaser']),
      thirdPartySettings: z.object({
        design_system: z.object({
          autotheme: z.object({
            enabled: z.boolean().default(true),
            outputDir: z.string().default('docroot/autotheme'),
            filePattern: z.string().default('autotheme__{id}'),
          }).optional(),
        }).optional(),
      }).optional(),
    }).optional(),

    // === PARAGRAPH ENTITY ===
    paragraph: z.object({
      containerField: z.object({
        name: z.string().default('container'),
        type: z.string().default('entity_reference_revisions'),
        targetType: z.string().default('paragraph'),
        maxDepth: z.number().default(10),
      }).optional(),
      layoutTypes: z.array(z.object({
        id: z.string(),
        label: z.string(),
        regions: z.array(z.string()).optional(),
      })).default([
        { id: 'layout', label: 'Layout', regions: ['header', 'content', 'footer', 'sidebar_left', 'sidebar_right'] },
        { id: 'layout_row', label: 'Layout Row', regions: ['left', 'center', 'right'] },
        { id: 'region', label: 'Region', regions: [] },
      ]),
      domStyleField: z.string().default('field_dom_style'),
    }).optional(),

    // === DOM ENTITY ===
    dom: z.object({
      expectedBundleCount: z.number().default(25),
      bundles: z.array(z.object({
        id: z.string(),
        label: z.string(),
        category: z.enum(['core', 'structure', 'css', 'media', 'utility', 'layout', 'typography', 'theme']),
        keyFields: z.array(z.string()).optional(),
      })).default([
        { id: 'style', label: 'Style', category: 'core', keyFields: ['field_background', 'field_padding', 'field_margin'] },
        { id: 'color', label: 'Color', category: 'core', keyFields: ['field_color', 'field_opacity'] },
        { id: 'breakpoint', label: 'Breakpoint', category: 'core', keyFields: ['field_min_width', 'field_max_width'] },
        { id: 'collection', label: 'Collection', category: 'structure', keyFields: ['field_dom'] },
        { id: 'tag', label: 'Tag', category: 'structure', keyFields: ['field_tag_name'] },
        { id: 'tag_group', label: 'Tag Group', category: 'structure', keyFields: ['field_dom_tag'] },
        { id: 'element', label: 'Element', category: 'structure', keyFields: [] },
        { id: 'selector', label: 'Selector', category: 'structure', keyFields: ['field_selector_value'] },
        { id: 'pseudo_class', label: 'Pseudo Class', category: 'css', keyFields: [] },
        { id: 'pseudo_element', label: 'Pseudo Element', category: 'css', keyFields: [] },
        { id: 'transition', label: 'Transition', category: 'css', keyFields: [] },
        { id: 'transform', label: 'Transform', category: 'css', keyFields: [] },
        { id: 'keyframe', label: 'Keyframe', category: 'css', keyFields: [] },
        { id: 'effect', label: 'Effect', category: 'css', keyFields: [] },
        { id: 'media_type', label: 'Media Type', category: 'media', keyFields: [] },
        { id: 'media_feature', label: 'Media Feature', category: 'media', keyFields: [] },
        { id: 'media_group', label: 'Media Group', category: 'media', keyFields: [] },
        { id: 'utility', label: 'Utility', category: 'utility', keyFields: [] },
        { id: 'property', label: 'Property', category: 'utility', keyFields: [] },
        { id: 'property_group', label: 'Property Group', category: 'utility', keyFields: [] },
        { id: 'attribute', label: 'Attribute', category: 'utility', keyFields: [] },
        { id: 'layout_section', label: 'Layout Section', category: 'layout', keyFields: [] },
        { id: 'font', label: 'Font', category: 'typography', keyFields: ['field_font_family', 'field_font_weight'] },
        { id: 'link_type', label: 'Link Type', category: 'typography', keyFields: [] },
        { id: 'collection_color', label: 'Collection Color', category: 'theme', keyFields: [] },
      ]),
      cssGeneration: z.object({
        outputDir: z.string().default('public://design-system/auto/dom/'),
        filePattern: z.string().default('{id}.css'),
        buildMethod: z.string().default('buildCss'),
        bindMethod: z.string().default('bindToElement'),
      }).optional(),
    }).optional(),

    // === FONT ENTITY ===
    font: z.object({
      fields: z.array(z.object({
        name: z.string(),
        type: z.string(),
      })).default([
        { name: 'field_font_family', type: 'string' },
        { name: 'field_font_weight', type: 'list_string' },
        { name: 'field_font_style', type: 'list_string' },
        { name: 'field_font_subset', type: 'list_string' },
      ]),
      selectionModal: z.object({
        selector: z.string().default('[data-drupal-selector*="font-selection"]'),
        filters: z.array(z.string()).default(['Font name', 'CSS Style', 'CSS Weight', 'Sort by', 'Order']),
      }).optional(),
    }).optional(),

    // === INTEGRATION ENTITY ===
    integration: z.object({
      status: z.enum(['incomplete', 'partial', 'complete']).default('incomplete'),
      fields: z.array(z.object({
        name: z.string(),
        type: z.string(),
      })).optional(),
    }).optional(),

    // === DEVICE ENTITY (Breakpoints) ===
    device: z.object({
      fields: z.array(z.object({
        name: z.string(),
        type: z.string(),
      })).default([
        { name: 'field_min_width', type: 'integer' },
        { name: 'field_max_width', type: 'integer' },
        { name: 'field_device_type', type: 'list_string' },
      ]),
      defaultBreakpoints: z.array(z.object({
        name: z.string(),
        minWidth: z.number(),
        maxWidth: z.number().optional(),
      })).default([
        { name: 'mobile', minWidth: 0, maxWidth: 767 },
        { name: 'tablet', minWidth: 768, maxWidth: 1023 },
        { name: 'desktop', minWidth: 1024 },
      ]),
    }).optional(),

    // === IPE BUILDER ===
    ipeBuilder: z.object({
      fieldWidgetBlock: z.object({
        pluginPrefix: z.string().default('field_widget:'),
        expectedCount: z.number().default(100),
        deriverClass: z.string().default('Drupal\\design_system\\Plugin\\Derivative\\FieldWidgetDeriver'),
        blockClass: z.string().default('Drupal\\design_system\\Plugin\\Block\\FieldWidget'),
      }).optional(),
      mercuryEditor: z.object({
        formOperation: z.string().default('mercury_editor'),
        tempstoreService: z.string().default('mercury_editor.tempstore_repository'),
        contextService: z.string().default('mercury_editor.context'),
      }).optional(),
      templateStorage: z.object({
        formDisplay: z.string().default('entity_form_display.{entity_type}.{bundle}.{mode}.third_party_settings.design_system'),
        viewDisplay: z.string().default('entity_view_display.{entity_type}.{bundle}.{mode}.third_party_settings.design_system'),
      }).optional(),
    }).optional(),

    // === PLAYWRIGHT VALIDATION ===
    playwrightValidation: z.object({
      // Element selectors and expected states
      selectors: z.object({
        // DOM styling
        domId: z.object({
          selector: z.string().default('[data-dom-id]'),
          minCount: z.number().default(1),
          description: z.string().default('Elements with DOM entity styling applied'),
        }).optional(),
        htmlDomId: z.object({
          selector: z.string().default('html[data-dom-id]'),
          minCount: z.number().default(1),
          description: z.string().default('HTML element with DOM ID attribute'),
        }).optional(),
        // Regions
        region: z.object({
          selector: z.string().default('[data-region]'),
          minCount: z.number().default(3),
          expectedRegions: z.array(z.string()).default(['header', 'content', 'footer']),
        }).optional(),
        // Theme entity tabs
        themeTabs: z.object({
          selector: z.string().default('.vertical-tabs__menu-item'),
          minCount: z.number().default(8),
        }).optional(),
        // Mercury Editor
        mercuryEditor: z.object({
          container: z.string().default('[data-mercury-editor]'),
          toolbar: z.string().default('.mercury-editor-toolbar'),
          dropZone: z.string().default('.layout-paragraphs-drop-zone'),
        }).optional(),
        // Form elements
        formWidget: z.object({
          container: z.string().default('.field-widget-block'),
          input: z.string().default('[data-drupal-selector]'),
          error: z.string().default('.form-item--error'),
        }).optional(),
        // Layout
        layoutSection: z.object({
          selector: z.string().default('.layout-section'),
          minCount: z.number().default(1),
        }).optional(),
      }).optional(),
      // Page-specific validations
      pages: z.array(z.object({
        name: z.string(),
        url: z.string(),
        assertions: z.array(z.object({
          selector: z.string(),
          assertion: z.enum(['visible', 'hidden', 'count', 'text', 'attribute']),
          expected: z.union([z.string(), z.number()]).optional(),
          attribute: z.string().optional(),
        })),
      })).optional(),
    }).optional(),

    // === CONTEXT FILES ===
    contextFiles: z.object({
      alwaysInclude: z.array(z.string()).default([
        'docroot/modules/share/design_system/src/DesignSystem.php',
        'docroot/modules/share/design_system/src/EntityDisplay.php',
        'docroot/modules/share/design_system/src/Preprocess.php',
        'docroot/modules/share/design_system/src/Entity/Entity/Dom.php',
        'docroot/modules/share/bd/src/Plugin/EntityPluginBase.php',
        'docroot/modules/share/bd/src/Service/EntityHelper.php',
        'docroot/modules/share/openapi_entity/src/Hooks/OpenApiEntityHooks.php',
        'docroot/modules/share/design_system/design_system.services.yml',
        'docroot/modules/share/design_system/config/schema/design_system.schema.yml',
      ]),
      taskSpecific: z.record(z.array(z.string())).optional(),
      methodSignatures: z.array(z.object({
        class: z.string(),
        method: z.string(),
        purpose: z.string(),
      })).default([
        { class: 'Dom', method: 'bindToElement', purpose: 'Applies DOM styles as HTML attributes' },
        { class: 'Dom', method: 'buildCss', purpose: 'Generates CSS from style entity' },
        { class: 'EntityDisplay', method: 'alterThemeEntityForm', purpose: 'Theme entity form tabs' },
        { class: 'Preprocess', method: 'recurseAttachContainer', purpose: 'Recursive container processing' },
        { class: 'EntityPluginBase', method: 'buildConfigurationForm', purpose: 'Auto-generates plugin config forms' },
      ]),
    }).optional(),

    // === ERROR GUIDANCE ===
    errorGuidance: z.record(z.string(), z.string()).default({
      'Service .* not found': 'Check service name in design_system.services.yml, verify class exists, run drush cr',
      'PluginNotFoundException': 'Check plugin annotation syntax, verify deriver class, clear cache with drush cr',
      'Plugin .* was not found': 'Plugin may be commented out. Check FieldWidget.php for Task 7.1',
      'Entity type .* does not exist': 'Check bd.entity_type.*.yml exists in config/default, run drush cr',
      'Bundle .* not found': 'Check bd.bundle.*.yml exists, verify bundle is enabled, run drush cr',
      'Form submission timeout': 'Check for infinite loops in form handlers, reduce AJAX complexity, check browser console',
      'Form save error': 'Check entity validation, verify required fields are populated',
      'CSS file not found': 'Check Dom::postSave() is called, verify public://design-system/ is writable',
      'Permission denied.*design-system': 'Run: ddev exec chmod -R 775 /var/www/html/docroot/sites/default/files/design-system',
      'mercury_editor.*not found': 'Verify Mercury Editor module is enabled: drush pm:list | grep mercury_editor',
      'Layout paragraphs.*error': 'Check layout_paragraphs module is enabled and configured',
      'networkidle.*timeout': 'Replace waitForLoadState("networkidle") with waitForLoadState("domcontentloaded")',
      'element not visible': 'Add scrollIntoViewIfNeeded() before interaction, increase timeout',
      'locator resolved to .* elements': 'Make selector more specific or use .first()/.nth()',
      'Allowed memory size': 'Find infinite loop - DO NOT restart DDEV. Check ddev logs -s web for stack trace',
      'Maximum execution time': 'Reduce loop iterations, add early returns, check for recursive calls',
      'Class .* not found': 'Check namespace matches directory (PSR-4), run composer dump-autoload',
      'Call to protected method': 'Change method visibility from protected to public',
    }),

    // === PATTERN SEEDS ===
    patternSeeds: z.array(z.object({
      id: z.string(),
      pattern: z.string(),
      fix: z.string(),
      context: z.array(z.string()),
      severity: z.enum(['info', 'warning', 'error', 'critical']),
      taskIds: z.array(z.string()).optional(),
    })).default([
      {
        id: 'drupal-protected-method',
        pattern: 'Call to protected method',
        fix: 'Change method visibility from protected to public',
        context: ['PHP', 'Drupal'],
        severity: 'error',
      },
      {
        id: 'drupal-networkidle',
        pattern: 'waitForLoadState.*networkidle|Timeout.*networkidle',
        fix: 'Replace networkidle with domcontentloaded - Drupal keeps connections alive',
        context: ['Playwright', 'test'],
        severity: 'warning',
      },
      {
        id: 'drupal-memory',
        pattern: 'Allowed memory size .* exhausted',
        fix: 'Find infinite loop in code - DO NOT restart DDEV. Check recent changes for recursive calls.',
        context: ['PHP', 'Drupal'],
        severity: 'critical',
      },
      {
        id: 'drupal-form-api',
        pattern: "'#type' => 'textfield'|'#type' => 'select'",
        fix: 'Use config_schema_subform instead of direct Form API elements for configuration',
        context: ['Drupal', 'form'],
        severity: 'warning',
      },
      {
        id: 'drupal-hook-procedural',
        pattern: 'function .*_form_alter\\(|function .*_preprocess_',
        fix: 'Use #[Hook("hook_name")] attribute in service class instead of procedural hook',
        context: ['Drupal', 'hook'],
        severity: 'warning',
      },
      {
        id: 'design-system-css-missing',
        pattern: 'CSS file not found|design-system/auto/dom/.*.css',
        fix: 'Check Dom::postSave() is called, verify CSS directory is writable',
        context: ['design_system', 'CSS'],
        severity: 'error',
        taskIds: ['401'],
      },
      {
        id: 'design-system-dom-binding',
        pattern: 'data-dom-id.*missing|bindToElement not called',
        fix: 'Verify Preprocess::html() is executing and DOM entities are retrieved',
        context: ['design_system', 'DOM'],
        severity: 'error',
        taskIds: ['201', '801'],
      },
      {
        id: 'design-system-fieldwidget',
        pattern: 'field_widget:.* not found|FieldWidget block missing',
        fix: 'Ensure FieldWidget.php is uncommented and cache cleared',
        context: ['design_system', 'block'],
        severity: 'error',
        taskIds: ['701'],
      },
      {
        id: 'design-system-deriver',
        pattern: 'FieldWidgetDeriver.*error|derivative.*failed',
        fix: 'FieldWidgetDeriver is already implemented. Check FieldWidget.php block class annotation matches deriver.',
        context: ['design_system', 'plugin'],
        severity: 'error',
        taskIds: ['701'],
      },
    ]),

    // === TEST NODE ===
    testNode: z.object({
      id: z.number().default(30),
      url: z.string().default('/node/30'),
    }).optional(),
  }).optional(),

  // Test generation configuration (for AI prompts)
  testGeneration: z.object({
    // Import statements for generated tests
    imports: z.array(z.string()).optional(),
    // Base URL for tests
    baseUrl: z.string().optional(),
    // Test setup boilerplate pattern
    setupPattern: z.string().optional(),
    // Selector documentation
    selectors: z.record(z.any()).optional(),
    // Entity save timing rules
    entitySaveTiming: z.object({
      rules: z.array(z.object({
        id: z.string(),
        description: z.string(),
      })).optional(),
      stepProcessing: z.record(z.string()).optional(),
      validationRequirements: z.record(z.array(z.string())).optional(),
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
        sessionsPath: z.string().default('.devloop/cursor-sessions.json'),
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
    rules: z.record(z.enum(['error', 'warn', 'off'])).optional(),
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
});

export type Config = z.infer<typeof configSchema>;

// =============================================================================
// CONFIGURATION OVERLAY SCHEMAS
// =============================================================================
// These schemas support hierarchical configuration merging:
// Project Config -> Framework Config -> PRD Set Config -> PRD Config -> Phase Config
// Later levels override earlier levels. Overlays use passthrough() for extensibility.
// =============================================================================

/**
 * Framework configuration schema (strict, extracted from Config)
 * Used for framework-specific validation
 */
export const frameworkConfigSchema = z.object({
  type: z.string().optional(),
  rules: z.array(z.string()).optional(),
  taskPatterns: z.array(z.string()).optional(),
  errorPathPatterns: z.array(z.string()).optional(),
  errorGuidance: z.record(z.string(), z.string()).optional(),
  identifierPatterns: z.array(z.string()).optional(),
  templatePath: z.string().optional(),
});

export type FrameworkConfig = z.infer<typeof frameworkConfigSchema>;

/**
 * Configuration overlay schema (flexible, with passthrough for extensibility)
 * All Config keys are optional in overlays. Used for PRD set, PRD, and phase config.
 */
export const configOverlaySchema = z.object({
  debug: z.boolean().optional(),
  metrics: z.object({
    enabled: z.boolean().optional(),
    path: z.string().optional(),
  }).optional(),
  ai: z.object({
    provider: z.enum(['anthropic', 'openai', 'gemini', 'ollama', 'cursor']).optional(),
    model: z.string().optional(),
    fallback: z.string().optional(),
    apiKey: z.string().optional(),
    maxTokens: z.number().optional(),
    maxContextChars: z.number().optional(),
  }).optional(),
  templates: z.object({
    source: z.enum(['builtin', 'ai-dev-tasks', 'custom']).optional(),
    customPath: z.string().optional(),
  }).optional(),
  testing: z.object({
    runner: z.enum(['playwright', 'cypress']).optional(),
    command: z.string().optional(),
    timeout: z.number().optional(),
    artifactsDir: z.string().optional(),
  }).optional(),
  validation: z.object({
    enabled: z.boolean().optional(),
    baseUrl: z.string().optional(),
    urls: z.array(z.string()).optional(),
    timeout: z.number().optional(),
    authCommand: z.string().optional(),
  }).optional(),
  logs: z.object({
    sources: z.array(logSourceSchema).optional(),
    patterns: z.object({
      error: z.union([z.string(), z.instanceof(RegExp)]).optional(),
      warning: z.union([z.string(), z.instanceof(RegExp)]).optional(),
    }).optional(),
    ignorePatterns: z.array(z.string()).optional(),
    useAI: z.boolean().optional(),
    outputPath: z.string().optional(),
  }).optional(),
  intervention: z.object({
    mode: z.enum(['autonomous', 'review', 'hybrid']).optional(),
    approvalRequired: z.array(z.string()).optional(),
  }).optional(),
  taskMaster: z.object({
    tasksPath: z.string().optional(),
  }).optional(),
  hooks: z.object({
    preTest: z.array(z.string()).optional(),
    postTest: z.array(z.string()).optional(),
    postApply: z.array(z.string()).optional(),
  }).optional(),
  rules: z.object({
    cursorRulesPath: z.string().optional(),
  }).optional(),
  codebase: z.object({
    extensions: z.array(z.string()).optional(),
    searchDirs: z.array(z.string()).optional(),
    excludeDirs: z.array(z.string()).optional(),
    filePathPatterns: z.array(z.string()).optional(),
    ignoreGlobs: z.array(z.string()).optional(),
    identifierStopwords: z.array(z.string()).optional(),
  }).optional(),
  framework: frameworkConfigSchema.optional(),
  context: z.object({
    includeSkeleton: z.boolean().optional(),
    includeImports: z.boolean().optional(),
    maxHelperSignatures: z.number().optional(),
  }).optional(),
  preValidation: z.object({
    enabled: z.boolean().optional(),
    maxRetries: z.number().optional(),
    validateSyntax: z.boolean().optional(),
    validateReferences: z.boolean().optional(),
  }).optional(),
  patternLearning: z.object({
    enabled: z.boolean().optional(),
    patternsPath: z.string().optional(),
    useBuiltinPatterns: z.boolean().optional(),
  }).optional(),
  autonomous: z.object({
    enabled: z.boolean().optional(),
    skipInvestigation: z.boolean().optional(),
    testGeneration: z.object({
      framework: z.enum(['playwright', 'cypress', 'jest']).optional(),
      testDir: z.string().optional(),
      baseTestTemplate: z.string().optional(),
    }).optional(),
    maxIterations: z.number().optional(),
    maxTaskRetries: z.number().optional(),
    stuckDetectionWindow: z.number().optional(),
    contextPath: z.string().optional(),
    maxHistoryIterations: z.number().optional(),
    testEvolutionInterval: z.number().optional(),
    learnFromSuccess: z.boolean().optional(),
    learnFromFailure: z.boolean().optional(),
  }).optional(),
  browser: z.object({
    headless: z.boolean().optional(),
    timeout: z.number().optional(),
    screenshotOnFailure: z.boolean().optional(),
    screenshotsDir: z.string().optional(),
    videoOnFailure: z.boolean().optional(),
  }).optional(),
  // PRD-level config is typically set at the PRD level, but can be overridden
  prd: z.any().optional(),
  drupal: z.any().optional(),
  wizard: z.any().optional(),
  designSystem: z.any().optional(),
  testGeneration: z.any().optional(),
  scan: z.any().optional(),
  cursor: z.any().optional(),
  aiPatterns: z.any().optional(),
  ast: z.any().optional(),
  playwrightMCP: z.any().optional(),
  documentation: z.any().optional(),
  security: z.any().optional(),
  style: z.any().optional(),
  health: z.any().optional(),
  refactoring: z.any().optional(),
}).passthrough(); // Allow unknown keys for future extensibility

export type ConfigOverlay = z.infer<typeof configOverlaySchema>;

/**
 * PRD Set configuration schema (alias to ConfigOverlay)
 * Used for PRD set level configuration
 */
export const prdSetConfigSchema = configOverlaySchema;
export type PrdSetConfig = ConfigOverlay;

/**
 * Phase configuration schema (alias to ConfigOverlay)
 * Used for phase level configuration in PRD frontmatter
 */
export const phaseConfigSchema = configOverlaySchema;
export type PhaseConfig = ConfigOverlay;

/**
 * Phase definition schema with optional config overlay
 */
export const phaseDefinitionSchema = z.object({
  id: z.number(),
  name: z.string(),
  range: z.string().optional(),
  pattern: z.string().optional(),
  parallel: z.boolean().optional(),
  dependsOn: z.array(z.number()).optional(),
  status: z.string().optional(),
  deferredReason: z.string().optional(),
  note: z.string().optional(),
  file: z.string().optional(),
  checkpoint: z.boolean().optional(),
  validation: z.object({
    after: z.array(z.string()).optional(),
    tests: z.array(z.string()).optional(),
    assertions: z.array(z.string()).optional(),
  }).optional(),
  // Phase config overlay (NEW)
  config: phaseConfigSchema.optional(),
});

export type PhaseDefinition = z.infer<typeof phaseDefinitionSchema>;

/**
 * Validates config overlay at any level
 * Returns validation result with errors and warnings
 */
export function validateConfigOverlay(
  overlay: unknown,
  level: 'project' | 'framework' | 'prd-set' | 'prd' | 'phase' = 'prd'
): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Use passthrough schema to allow unknown keys but validate known ones
    const result = configOverlaySchema.safeParse(overlay);

    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        errors.push(`[${level}] ${path}: ${issue.message}`);
      }
    }

    // Warn about unknown keys at top level (they're allowed but might be typos)
    if (typeof overlay === 'object' && overlay !== null) {
      const knownKeys = new Set([
        'debug', 'metrics', 'ai', 'templates', 'testing', 'validation', 'logs',
        'intervention', 'taskMaster', 'hooks', 'rules', 'codebase', 'framework',
        'context', 'preValidation', 'patternLearning', 'autonomous', 'browser',
        'prd', 'drupal', 'wizard', 'designSystem', 'testGeneration', 'scan',
        'cursor', 'aiPatterns', 'ast', 'playwrightMCP', 'documentation',
        'security', 'style', 'health', 'refactoring',
      ]);
      for (const key of Object.keys(overlay)) {
        if (!knownKeys.has(key)) {
          warnings.push(`[${level}] Unknown config key: ${key} (allowed but may be a typo)`);
        }
      }
    }
  } catch (error) {
    errors.push(`[${level}] Validation error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateConfig(data: unknown): Config {
  return configSchema.parse(data);
}

// Export the main config schema for external use
export { configSchema };
