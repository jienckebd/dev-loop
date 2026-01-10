import * as fs from 'fs-extra';
import * as path from 'path';
import { z } from 'zod';
import { FrameworkPlugin, FrameworkDefaultConfig, CodeChanges, CodeQualityTool, TechDebtIndicator } from '../interface';

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
}
