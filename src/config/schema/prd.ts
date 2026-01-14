import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

/**
 * PRD configuration schemas
 *
 * Note: This file defines the prd schema but uses z.lazy() for configOverlaySchema
 * to avoid circular dependencies. The actual configOverlaySchema is defined in overlays.ts
 */

/**
 * Creates the PRD schema with a lazy reference to configOverlaySchema
 * This allows us to avoid circular dependencies between prd.ts and overlays.ts
 */
export function createPrdSchema(configOverlaySchema: ZodTypeAny) {
  return z.object({
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
    dependencies: z.record(z.string(), z.array(z.string())).optional(),
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
      dependencies: z.record(z.string(), z.array(z.string())).optional(), // Explicit requirement dependencies
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
        properties: z.record(z.string(), z.string()).optional(),
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
        schemas: z.record(z.string(), z.any()).optional(),
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
          properties: z.record(z.string(), z.string()).optional(),
        }).optional(),
      })).optional(),
      fieldMappings: z.object({
        global: z.record(z.string(), z.object({
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
      typeMappings: z.record(z.string(), z.object({
        type: z.string(),
        subTypes: z.array(z.string()).optional(),
        properties: z.record(z.string(), z.string()).optional(),
      })).optional(),
      propertyMappings: z.record(z.string(), z.string()).optional(),
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
      requirementTests: z.record(z.string(), z.object({
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
      fieldValidation: z.record(z.string(), z.array(z.object({
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
        fieldMappings: z.record(z.string(), z.string()).optional(),
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
      entityRelationships: z.record(z.string(), z.array(z.object({
        targetType: z.string(),
        relationship: z.string(),
        cardinality: z.enum(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']),
      }))).optional(),
    }).optional(),

    // NEW: Lifecycle hooks for PRD execution
    lifecycle: z.object({
      // Run at start of PRD execution
      onStart: z.array(z.object({
        type: z.enum(['cli_command', 'shell', 'callback']),
        command: z.string().optional(),
        cliCommand: z.string().optional(), // Framework CLI command name
        args: z.record(z.string(), z.string()).optional(),
        description: z.string().optional(),
        continueOnError: z.boolean().default(false),
      })).optional(),
      // Run at start of each phase
      onPhaseStart: z.array(z.object({
        type: z.enum(['cli_command', 'shell', 'callback']),
        command: z.string().optional(),
        cliCommand: z.string().optional(),
        args: z.record(z.string(), z.string()).optional(),
        description: z.string().optional(),
        continueOnError: z.boolean().default(false),
      })).optional(),
      // Run after each task completes successfully
      onTaskComplete: z.array(z.object({
        type: z.enum(['cli_command', 'shell', 'callback']),
        command: z.string().optional(),
        cliCommand: z.string().optional(),
        args: z.record(z.string(), z.string()).optional(),
        description: z.string().optional(),
        continueOnError: z.boolean().default(true),
      })).optional(),
      // Run at successful completion of PRD
      onComplete: z.array(z.object({
        type: z.enum(['cli_command', 'shell', 'callback']),
        command: z.string().optional(),
        cliCommand: z.string().optional(),
        args: z.record(z.string(), z.string()).optional(),
        description: z.string().optional(),
      })).optional(),
      // Run when a task/phase fails
      onFailure: z.array(z.object({
        type: z.enum(['cli_command', 'shell', 'callback', 'recovery']),
        command: z.string().optional(),
        cliCommand: z.string().optional(),
        args: z.record(z.string(), z.string()).optional(),
        description: z.string().optional(),
        // Recovery-specific options
        pattern: z.string().optional(), // Error pattern to match
        recoveryStrategy: z.string().optional(), // Recovery strategy name
      })).optional(),
    }).optional(),

    // NEW: Recovery configuration for automatic failure recovery
    recovery: z.object({
      enabled: z.boolean().default(true),
      maxRecoveryAttempts: z.number().default(3),
      // Custom recovery strategies
      strategies: z.array(z.object({
        pattern: z.string(), // Regex pattern to match errors
        name: z.string().optional(),
        action: z.enum(['cli_command', 'retry', 'retry_fuzzy', 'skip', 'escalate']),
        cliCommands: z.array(z.string()).optional(), // Framework CLI commands to run
        shellCommands: z.array(z.string()).optional(), // Raw shell commands
        maxAttempts: z.number().default(2),
        retryAfterRecovery: z.boolean().default(true),
      })).optional(),
      // Fallback strategy when no pattern matches
      fallbackStrategy: z.enum(['create_fix_task', 'skip', 'escalate']).default('create_fix_task'),
    }).optional(),

    // NEW: Verification configuration for post-task validation
    verification: z.object({
      // Expected services to exist after completion
      expectedServices: z.array(z.string()).optional(),
      // CLI commands to run for verification
      cliCommands: z.array(z.string()).optional(),
      // Expected files to exist
      expectedFiles: z.array(z.string()).optional(),
      // Health checks to run
      healthChecks: z.array(z.object({
        type: z.enum(['http', 'cli', 'file', 'service']),
        target: z.string(),
        expectedStatus: z.string().optional(),
        timeout: z.number().optional(),
      })).optional(),
    }).optional(),
  });
}

