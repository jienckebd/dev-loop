import * as fs from 'fs-extra';
import * as path from 'path';
import { z } from 'zod';
import {
  FrameworkPlugin,
  FrameworkDefaultConfig,
  CodeChanges,
  CodeQualityTool,
  TechDebtIndicator,
  PrdConcept,
  PrdInferenceResult,
  FrameworkCLICommand,
} from '../interface';

/**
 * Drupal Framework Plugin
 *
 * Provides Drupal 10/11 specific functionality for dev-loop including:
 * - Auto-detection of Drupal projects
 * - Drupal coding standards in templates
 * - DDEV integration
 * - Drush cache clearing
 * - Entity/config-aware error patterns
 */
export class DrupalPlugin implements FrameworkPlugin {
  readonly name = 'drupal';
  readonly version = '1.0.0';
  readonly description = 'Drupal 10/11 framework support with DDEV integration';

  private templateCache: Map<string, string> = new Map();

  async detect(projectRoot: string): Promise<boolean> {
    // Check for Drupal indicators
    const indicators = [
      // Standard Drupal structure
      path.join(projectRoot, 'docroot/core'),
      path.join(projectRoot, 'web/core'),
      // DDEV config
      path.join(projectRoot, '.ddev/config.yaml'),
    ];

    for (const indicator of indicators) {
      if (await fs.pathExists(indicator)) {
        return true;
      }
    }

    // Check composer.json for drupal/core
    const composerPath = path.join(projectRoot, 'composer.json');
    if (await fs.pathExists(composerPath)) {
      try {
        const composer = await fs.readJson(composerPath);
        if (composer.require?.['drupal/core'] || composer.require?.['drupal/core-recommended']) {
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
      cacheCommand: 'ddev exec drush cr',
      searchDirs: [
        'docroot/modules/custom',
        'docroot/modules/share',
        'config/default',
        'tests/playwright',
      ],
      excludeDirs: [
        'node_modules',
        'vendor',
        'docroot/core',
        'docroot/modules/contrib',
        'docroot/themes/contrib',
        'docroot/sites/default/files',
        'config/install',
      ],
      extensions: ['php', 'module', 'inc', 'yml', 'yaml', 'theme', 'install', 'twig'],
      ignoreGlobs: [
        '**/node_modules/**',
        '**/vendor/**',
        '**/docroot/core/**',
        '**/docroot/modules/contrib/**',
        '**/config/install/**',
      ],
      testRunner: 'playwright',
      testCommand: 'npx playwright test',
      validationBaseUrl: 'https://sysf.ddev.site',
    };
  }

  getSchemaExtension(): z.ZodObject<any> {
    return z.object({
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
          thirdPartySettings: z.record(z.string(), z.array(z.string())).optional(),
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
    return `# Drupal Task Implementation

You are an expert Drupal developer. Generate PHP code changes to implement the following task.

## CRITICAL RULES

1. **NEVER replace entire files** - always use PATCH operations with search/replace
2. **Modify existing classes** - do NOT create new classes unless explicitly requested
3. **Keep patches small** - each patch should change only a few lines
4. **Preserve existing code** - only change what is necessary for the task
5. **Verify before patching** - confirm the search string exists EXACTLY in the provided code context

## FILE CREATION TASKS (CRITICAL)

When task details specify an EXACT file path to create (e.g., "Create config/default/node.type.test_content.yml"):
- **You MUST create that EXACT file** - use operation "create" with the exact path from task details
- **Similar files DO NOT fulfill the requirement** - if task says \`node.type.*.yml\`, creating \`bd.entity_type.*.yml\` is WRONG
- **Config install files are NOT runtime configs** - \`config/install/*.yml\` files are module defaults, NOT \`config/default/*.yml\` runtime configs

## Task Information

**Title:** {{task.title}}
**Description:** {{task.description}}
**Details:** {{task.details}}

## Target Files

{{targetFiles}}

## Existing Code Context

{{existingCode}}

## Drupal Coding Standards

1. **Module Structure**: All custom code in \`docroot/modules/share/{module}/\`
2. **Service Classes**: Use dependency injection via \`{module}.services.yml\`
3. **Hook Implementation**: Follow naming convention \`{module}_{hook}()\`
4. **Logging**: Use \`\\Drupal::logger('{module}')->{level}()\` for logging
5. **Entity Operations**: Use EntityTypeManager for entity operations

## Output Format

\`\`\`json
{
  "files": [
    {
      "path": "docroot/modules/share/{module}/src/Service/{File}.php",
      "patches": [
        {
          "search": "// exact code to find",
          "replace": "// replacement code"
        }
      ],
      "operation": "patch"
    }
  ],
  "summary": "Brief description of changes made"
}
\`\`\`
`;
  }

  getFileExtensions(): string[] {
    return ['php', 'module', 'inc', 'yml', 'yaml', 'theme', 'install', 'twig', 'info'];
  }

  getSearchDirs(): string[] {
    return [
      'docroot/modules/custom',
      'docroot/modules/share',
      'docroot/themes/custom',
      'config/default',
      'tests/playwright',
    ];
  }

  getExcludeDirs(): string[] {
    return [
      'node_modules',
      'vendor',
      'docroot/core',
      'docroot/modules/contrib',
      'docroot/themes/contrib',
      'docroot/sites/default/files',
      'config/install',
      '.git',
    ];
  }

  getErrorPatterns(): Record<string, string> {
    return {
      // Path errors
      'DRUPAL_ROOT': 'PATH ERROR: Use dirname(DRUPAL_ROOT) for project root paths, not DRUPAL_ROOT',
      'etc/openapi': 'The etc/ folder is at PROJECT ROOT, not inside docroot/. Use dirname(DRUPAL_ROOT)',

      // Entity errors
      'EntityMalformedException': 'Entity missing required ID - check entity type/bundle is saved before referencing',
      'Entity type .* does not exist': 'Check bd.entity_type.*.yml exists in config/default, run drush cr',
      'Bundle .* not found': 'Check bd.bundle.*.yml exists, verify bundle is enabled, run drush cr',

      // Service errors
      'Service .* not found': 'Check service name in *.services.yml, verify class exists, run drush cr',
      'PluginNotFoundException': 'Check plugin annotation syntax, verify deriver class, clear cache with drush cr',
      'Plugin .* was not found': 'Plugin may be commented out or annotation malformed. Check plugin class annotation.',

      // Form errors
      'Form submission timeout': 'Check for infinite loops in form handlers, reduce AJAX complexity',
      'Form save error': 'Check entity validation, verify required fields are populated',
      'third_party_settings': 'Use $entity->setThirdPartySetting() method, not direct array access',

      // Memory/performance
      'Allowed memory size': 'Find infinite loop in code - DO NOT restart DDEV. Check ddev logs -s web for stack trace',
      'Maximum execution time': 'Reduce loop iterations, add early returns, check for recursive calls',

      // Class errors
      'Class .* not found': 'Check namespace matches directory (PSR-4), run composer dump-autoload',
      'Call to protected method': 'Change method visibility from protected to public',
      'Call to undefined method': 'Method does not exist - implement it or use correct method name',

      // Test errors
      'networkidle.*timeout': 'Replace waitForLoadState("networkidle") with waitForLoadState("domcontentloaded")',
      'element not visible': 'Add scrollIntoViewIfNeeded() before interaction, increase timeout',
      'locator resolved to .* elements': 'Make selector more specific or use .first()/.nth()',

      // Patch errors
      'PATCH_FAILED': 'Search string does not match actual file content. Copy EXACT code including whitespace.',
      'Search string not found': 'The search string does not exist in the file. Check for typos or changed code.',
    };
  }

  getIdentifierPatterns(): RegExp[] {
    return [
      // Hook functions
      /\b(hook_[a-z][a-z0-9_]+)\b/g,
      /\bfunction\s+([a-z][a-z0-9_]+_[a-z][a-z0-9_]+)\s*\(/g,
      // Class names
      /\bclass\s+([A-Z][a-zA-Z0-9_]+)/g,
      // Service methods
      /\bpublic\s+function\s+([a-z][a-zA-Z0-9_]*)\s*\(/g,
      // Drupal services
      /@([a-z][a-z0-9_.]+)\b/g,
    ];
  }

  getErrorPathPatterns(): RegExp[] {
    return [
      // PHP stack traces
      /([a-zA-Z0-9_\-./]+\.(?:php|module|inc|theme)):\d+/g,
      // Drupal paths
      /docroot\/[a-zA-Z0-9_\-./]+\.(?:php|module|yml)/g,
      // Config paths
      /config\/[a-zA-Z0-9_\-./]+\.yml/g,
    ];
  }

  getCacheCommand(): string {
    return 'ddev exec drush cr';
  }

  async onAfterApply(changes: CodeChanges): Promise<void> {
    // Log that cache should be cleared
    const hasConfigChanges = changes.files?.some(f =>
      f.path.includes('config/') ||
      f.path.endsWith('.yml') ||
      f.path.endsWith('.services.yml')
    );

    const hasPhpChanges = changes.files?.some(f =>
      f.path.endsWith('.php') ||
      f.path.endsWith('.module')
    );

    if (hasConfigChanges || hasPhpChanges) {
      console.log('[DrupalPlugin] Changes applied - cache clear recommended: ddev exec drush cr');
    }
  }

  async onTestFailure(error: string): Promise<string> {
    const guidance: string[] = [];

    // Check for specific Drupal-related test failures
    if (error.includes('Authentication') || error.includes('login')) {
      guidance.push('AUTHENTICATION: Run `ddev exec drush uli` to get a fresh login URL');
    }

    if (error.includes('404') || error.includes('not found')) {
      guidance.push('ROUTE NOT FOUND: Clear cache with `ddev exec drush cr`, verify route exists in routing.yml');
    }

    if (error.includes('AJAX') || error.includes('timeout')) {
      guidance.push('AJAX TIMEOUT: Check browser console for JS errors, verify AJAX callbacks return proper responses');
    }

    if (error.includes('field') && error.includes('required')) {
      guidance.push('REQUIRED FIELD: Check field configuration, ensure test data includes all required fields');
    }

    return guidance.length > 0
      ? '\n\n**Drupal-Specific Guidance:**\n' + guidance.map(g => `- ${g}`).join('\n')
      : '';
  }

  getCodeQualityTools(): CodeQualityTool[] {
    return [
      {
        name: 'phpstan',
        purpose: 'static-analysis',
        command: 'vendor/bin/phpstan analyse docroot/modules/share --level 6 --error-format=json',
        outputFormat: 'json',
        installCommand: 'composer require --dev phpstan/phpstan phpstan/phpstan-drupal',
        description: 'PHP Static Analysis Tool with Drupal support',
      },
      {
        name: 'phpcpd',
        purpose: 'duplicate-detection',
        command: 'vendor/bin/phpcpd docroot/modules/share --min-lines 5',
        outputFormat: 'text',
        installCommand: 'composer require --dev sebastian/phpcpd',
        description: 'PHP Copy/Paste Detector',
      },
      {
        name: 'drupal-check',
        purpose: 'tech-debt',
        command: 'vendor/bin/drupal-check -d docroot/modules/share',
        outputFormat: 'text',
        installCommand: 'composer require --dev mglaman/drupal-check',
        description: 'Drupal deprecation and upgrade checker',
      },
      {
        name: 'composer-audit',
        purpose: 'security',
        command: 'composer audit --format=json',
        outputFormat: 'json',
        description: 'Composer dependency security audit',
      },
    ];
  }

  getTechDebtIndicators(): TechDebtIndicator[] {
    return [
      {
        pattern: 'drupal_set_message',
        severity: 'high',
        category: 'deprecated-api',
        description: 'drupal_set_message() deprecated in D9+',
        remediation: 'Use \\Drupal::messenger()->addMessage()',
      },
      {
        pattern: 'db_query|db_select',
        severity: 'high',
        category: 'deprecated-api',
        description: 'db_query() and db_select() deprecated in D9+',
        remediation: 'Use \\Drupal::database()',
      },
      {
        pattern: '\\Drupal::[a-zA-Z]+\\(\\)',
        severity: 'low',
        category: 'obsolete-pattern',
        description: 'Static service call - consider dependency injection',
        remediation: 'Inject service via constructor instead of static call',
      },
      {
        pattern: '@TODO|@FIXME|# TODO|# FIXME',
        severity: 'low',
        category: 'todo',
        description: 'TODO/FIXME comment',
      },
    ];
  }

  // ===== Target Module Operations (For Contribution Mode) =====

  getTargetModulePaths(targetModule: string): string[] {
    // Return all valid Drupal module path patterns for the given module
    return [
      `docroot/modules/share/${targetModule}/`,
      `docroot/modules/custom/${targetModule}/`,
      `web/modules/share/${targetModule}/`,
      `web/modules/custom/${targetModule}/`,
    ];
  }

  getTargetModuleGuidance(targetModule: string): string {
    return `
## Drupal Module Structure

In Drupal, all custom module code must be organized within a specific directory structure:

**Allowed paths for module "${targetModule}":**
- \`docroot/modules/share/${targetModule}/\` (preferred for shared modules)
- \`docroot/modules/custom/${targetModule}/\` (for custom modules)
- \`web/modules/share/${targetModule}/\` (alternate docroot)
- \`web/modules/custom/${targetModule}/\` (alternate docroot)

**Standard Drupal module files:**
- \`${targetModule}.info.yml\` - Module metadata (required)
- \`${targetModule}.module\` - Module hook implementations
- \`${targetModule}.services.yml\` - Service definitions
- \`${targetModule}.routing.yml\` - Route definitions
- \`${targetModule}.permissions.yml\` - Permission definitions
- \`src/\` - PHP class files (PSR-4 autoloaded)
- \`config/schema/\` - Configuration schema definitions
- \`config/install/\` - Default configuration

**Do NOT create files in:**
- Other modules (e.g., \`docroot/modules/share/bd/\` if targetModule is not "bd")
- Contrib modules (\`docroot/modules/contrib/\`)
- Core (\`docroot/core/\`)
`;
  }

  generateModuleBoundaryWarning(targetModule: string): string {
    const paths = this.getTargetModulePaths(targetModule);
    const allowedPaths = paths.map(p => `- ${p}**/*.{php,yml,module,install,theme,twig}`).join('\n');
    const forbiddenExamples = [
      'docroot/modules/share/bd/',
      'docroot/modules/share/design_system/',
      'docroot/modules/share/entity_form_wizard/',
      'docroot/modules/contrib/',
      'docroot/core/',
    ].filter(p => !p.includes(`/${targetModule}/`))
     .map(p => `- ${p} (wrong module or forbidden area)`)
     .join('\n');

    return `## ⚠️ CRITICAL: TARGET MODULE BOUNDARY ⚠️

**You MUST ONLY modify files in module: \`${targetModule}\`**

✅ **ALLOWED - Only these paths are permitted:**
${allowedPaths}

❌ **FORBIDDEN - Do NOT create or modify files in:**
${forbiddenExamples}

**Drupal-specific rules:**
1. All file paths must start with one of the allowed prefixes above
2. File paths must use forward slashes (/)
3. PHP classes must follow PSR-4 namespace: \\Drupal\\${targetModule}\\...
4. Configuration files go in config/install/ or config/schema/
5. Hook implementations go in ${targetModule}.module file

**Files outside the target module will be REJECTED. Do not waste tokens on them.**
`;
  }

  // ===== Constitution Support (Spec-Kit Integration) =====

  /**
   * Get Drupal-specific constraints for constitution merging.
   * These are injected into AI prompts as MUST/NEVER rules.
   */
  getConstraints(): string[] {
    return [
      'NEVER modify Drupal core or contrib code directly',
      'NEVER create custom PHP entity classes - use bd.entity_type.*.yml config',
      'MUST use dependency injection via constructor',
      'MUST extend Drupal\\bd\\Plugin\\EntityPluginBase for all plugins',
      'MUST use config_schema_subform for configuration forms',
      'ALWAYS run ddev exec bash -c "drush cr" after schema/config changes',
      'MUST follow Drupal coding standards (2-space indentation, no closing PHP tags)',
      'MUST use PHP 8.3 type hints and return types',
    ];
  }

  /**
   * Get Drupal-specific patterns for constitution merging.
   */
  getPatterns(): Array<{ pattern: string; when: string; reference?: string }> {
    return [
      {
        pattern: 'EntityPluginBase',
        when: 'creating any plugin type',
        reference: 'docroot/modules/share/bd/src/Plugin/EntityPluginBase.php',
      },
      {
        pattern: 'config_schema_subform',
        when: 'building configuration forms',
        reference: 'docroot/modules/share/bd/config/schema/bd.schema.yml',
      },
      {
        pattern: 'bd.entity_type.*.yml',
        when: 'defining entity types',
        reference: 'config/default/bd.entity_type.*.yml',
      },
      {
        pattern: 'bd.bundle.*.yml',
        when: 'defining entity bundles',
        reference: 'config/default/bd.bundle.*.yml',
      },
      {
        pattern: 'DefaultPluginManager',
        when: 'creating plugin managers',
        reference: 'docroot/modules/share/bd/src/Plugin/',
      },
      {
        pattern: 'annotation discovery',
        when: 'plugin discovery (Drupal 10 compatibility)',
      },
    ];
  }

  /**
   * Get code location rules for Drupal projects.
   */
  getCodeLocationRules(): Record<string, string> {
    return {
      custom_modules: 'docroot/modules/share/{module}/',
      configuration: 'config/default/',
      schema_definitions: 'docroot/modules/share/*/config/schema/*.schema.yml',
      tests: 'tests/playwright/',
      services: 'docroot/modules/share/*/*.services.yml',
      hooks: 'docroot/modules/share/*/*.module',
    };
  }

  // ===== CLI Commands (For Agentic Execution) =====

  /**
   * Get Drupal-specific CLI commands for agentic execution.
   * These enable dev-loop to perform module management, cache operations,
   * service verification, and other Drupal operations autonomously.
   */
  getCLICommands(): FrameworkCLICommand[] {
    return [
      // Module Management
      {
        name: 'module-enable',
        command: 'ddev exec drush en {module} -y',
        purpose: 'module-enable',
        description: 'Enable a Drupal module',
        placeholders: ['module'],
        example: 'ddev exec drush en bd_cache_manager -y',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'text',
        timeout: 60000,
      },
      {
        name: 'module-disable',
        command: 'ddev exec drush pmu {module} -y',
        purpose: 'module-disable',
        description: 'Uninstall a Drupal module',
        placeholders: ['module'],
        example: 'ddev exec drush pmu bd_cache_manager -y',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'text',
        timeout: 60000,
      },
      {
        name: 'module-list',
        command: 'ddev exec drush pm:list --status=enabled --format=json',
        purpose: 'code-check',
        description: 'List all enabled modules',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'json',
        timeout: 30000,
      },

      // Cache Operations
      {
        name: 'cache-rebuild',
        command: 'ddev exec drush cr',
        purpose: 'cache-clear',
        description: 'Rebuild all Drupal caches',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'text',
        timeout: 120000,
      },

      // Service Verification
      {
        name: 'service-exists',
        command: 'ddev exec drush ev "echo \\Drupal::hasService(\'{service}\') ? \'EXISTS\' : \'NOT_FOUND\';"',
        purpose: 'service-check',
        description: 'Check if a service exists in the Drupal container',
        placeholders: ['service'],
        example: 'ddev exec drush ev "echo \\Drupal::hasService(\'bd.entity_type.builder\') ? \'EXISTS\' : \'NOT_FOUND\';"',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'boolean',
        timeout: 30000,
      },

      // Entity Type Verification
      {
        name: 'entity-type-exists',
        command: 'ddev exec drush ev "echo \\Drupal::entityTypeManager()->hasDefinition(\'{entity_type}\') ? \'EXISTS\' : \'NOT_FOUND\';"',
        purpose: 'entity-check',
        description: 'Check if an entity type is defined',
        placeholders: ['entity_type'],
        example: 'ddev exec drush ev "echo \\Drupal::entityTypeManager()->hasDefinition(\'node\') ? \'EXISTS\' : \'NOT_FOUND\';"',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'boolean',
        timeout: 30000,
      },

      // Config Operations
      {
        name: 'config-get',
        command: 'ddev exec drush cget {config_name} --format=yaml',
        purpose: 'config-export',
        description: 'Get a configuration value',
        placeholders: ['config_name'],
        example: 'ddev exec drush cget system.site --format=yaml',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'yaml',
        timeout: 30000,
      },
      {
        name: 'config-set',
        command: 'ddev exec drush cset {config_name} {key} {value} -y',
        purpose: 'config-import',
        description: 'Set a configuration value',
        placeholders: ['config_name', 'key', 'value'],
        idempotent: false,
        requiresConfirmation: true,
        outputFormat: 'text',
        timeout: 30000,
      },
      {
        name: 'config-export',
        command: 'ddev exec drush cex -y',
        purpose: 'config-export',
        description: 'Export all configuration to files',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'text',
        timeout: 120000,
      },
      {
        name: 'config-import',
        command: 'ddev exec drush cim -y',
        purpose: 'config-import',
        description: 'Import configuration from files',
        idempotent: false,
        requiresConfirmation: true,
        outputFormat: 'text',
        timeout: 120000,
      },

      // Database Operations
      {
        name: 'sql-query',
        command: 'ddev exec drush sqlq "{query}"',
        purpose: 'database-query',
        description: 'Run a SQL query',
        placeholders: ['query'],
        example: 'ddev exec drush sqlq "SELECT name FROM config LIMIT 5"',
        idempotent: false,
        requiresConfirmation: true,
        outputFormat: 'text',
        timeout: 60000,
      },

      // Health Checks
      {
        name: 'login-url',
        command: 'ddev exec drush uli',
        purpose: 'health-check',
        description: 'Generate a one-time login URL',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'text',
        timeout: 30000,
      },
      {
        name: 'status',
        command: 'ddev exec drush status --format=json',
        purpose: 'health-check',
        description: 'Get Drupal status information',
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'json',
        timeout: 30000,
      },

      // Code Generation / Scaffolding
      {
        name: 'generate-module',
        command: 'ddev exec drush generate module --name="{name}" --machine-name={machine_name} --no-interaction',
        purpose: 'scaffold',
        description: 'Generate a new module scaffold',
        placeholders: ['name', 'machine_name'],
        example: 'ddev exec drush generate module --name="Cache Manager" --machine-name=bd_cache_manager --no-interaction',
        idempotent: false,
        requiresConfirmation: false,
        outputFormat: 'text',
        timeout: 60000,
      },

      // Testing
      {
        name: 'run-tests',
        command: 'ddev exec drush test:run {test_class}',
        purpose: 'test-run',
        description: 'Run PHPUnit tests for a specific class',
        placeholders: ['test_class'],
        idempotent: true,
        requiresConfirmation: false,
        outputFormat: 'text',
        timeout: 300000,
      },
    ];
  }

  // ===== PRD Content Analysis (For Spec-Kit Integration) =====

  /**
   * Get Drupal-specific concepts that can be inferred from PRDs.
   */
  getPrdConcepts(): PrdConcept[] {
    return [
      {
        name: 'entity_type',
        label: 'Entity Types',
        extractPattern: /entity\s+type[:\s]+["']?(\w+)["']?/gi,
        filePattern: /bd\.entity_type\.(\w+)\.yml/,
        schemaQuestion: 'Should I generate schemas for all {count} entity type(s) found in the PRD?',
        priorityQuestion: 'Which entity types should I prioritize for schema generation?',
      },
      {
        name: 'plugin_type',
        label: 'Plugin Types',
        extractPattern: /plugin\s+type[:\s]+["']?(\w+)["']?/gi,
        filePattern: /Plugin\/(\w+)\//,
        schemaQuestion: 'Should I generate plugin definitions for all {count} plugin type(s)?',
      },
      {
        name: 'config_schema',
        label: 'Config Schemas',
        extractPattern: /config\s+schema[:\s]+["']?(\w+)["']?/gi,
        filePattern: /(\w+)\.schema\.yml/,
      },
      {
        name: 'bundle',
        label: 'Entity Bundles',
        extractPattern: /bundle[:\s]+["']?(\w+)["']?/gi,
        filePattern: /bd\.bundle\.(\w+)\.\w+\.yml/,
      },
    ];
  }

  /**
   * Infer Drupal-specific decisions from PRD content.
   */
  inferFromPrd(prd: any): PrdInferenceResult {
    const prdText = JSON.stringify(prd).toLowerCase();
    const concepts: PrdInferenceResult['concepts'] = [];

    for (const concept of this.getPrdConcepts()) {
      const items: string[] = [];

      // Extract from PRD text using pattern
      const regex = new RegExp(concept.extractPattern.source, 'gi');
      let match;
      while ((match = regex.exec(prdText)) !== null) {
        if (match[1] && !items.includes(match[1].toLowerCase())) {
          items.push(match[1].toLowerCase());
        }
      }

      // Extract from target files if filePattern provided
      if (concept.filePattern) {
        for (const phase of prd.phases || []) {
          for (const task of phase.tasks || []) {
            for (const file of task.targetFiles || task.files || []) {
              const fileMatch = file.match(concept.filePattern);
              if (fileMatch?.[1] && !items.includes(fileMatch[1].toLowerCase())) {
                items.push(fileMatch[1].toLowerCase());
              }
            }
          }
        }
      }

      if (items.length > 0) {
        concepts.push({
          type: concept.name,
          items,
          priorities: items.slice(0, 3), // First 3 as priorities
          confidence: items.length >= 3 ? 0.9 : items.length > 0 ? 0.75 : 0.5,
        });
      }
    }

    // Determine schema type (Drupal-specific: config vs entity schemas)
    const hasEntityMentions = prdText.includes('entity type') || prdText.includes('content type') || prdText.includes('bundle');
    const hasConfigMentions = prdText.includes('module settings') || prdText.includes('config schema') || prdText.includes('configuration form');

    let schemaType: PrdInferenceResult['schemaType'];
    if (hasEntityMentions || hasConfigMentions) {
      schemaType = {
        value: hasEntityMentions && hasConfigMentions ? 'both' :
               hasEntityMentions ? 'entity' : 'config',
        confidence: 0.8,
      };
    }

    return { concepts, schemaType };
  }
}
