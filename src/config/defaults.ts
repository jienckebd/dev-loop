import { Config } from './schema';

export const defaultConfig: Partial<Config> = {
  ai: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  templates: {
    source: 'builtin',
  },
  testing: {
    runner: 'playwright',
    command: 'npm test',
    timeout: 300000,
    artifactsDir: 'test-results',
  },
  logs: {
    sources: [],
    patterns: {
      error: /Error|Exception|Fatal/i,
      warning: /Warning|Deprecated/i,
    },
    useAI: true,
  },
  intervention: {
    mode: 'autonomous',
    approvalRequired: ['delete', 'schema-change'],
  },
  taskMaster: {
    tasksPath: '.taskmaster/tasks/tasks.json',
  },
  autonomous: {
    enabled: true,
    testGeneration: {
      framework: 'playwright',
      testDir: 'tests/playwright/auto',
    },
    maxIterations: 100,
    maxTaskRetries: 3,
    stuckDetectionWindow: 5,
    contextPath: '.devloop/prd-context',
    maxHistoryIterations: 50,
    testEvolutionInterval: 5,
    learnFromSuccess: true,
    learnFromFailure: true,
  },
  browser: {
    headless: true,
    timeout: 30000,
    screenshotOnFailure: true,
    screenshotsDir: '.devloop/screenshots',
    videoOnFailure: false,
  },
  prd: {
    defaultPath: '.taskmaster/docs/prd.md',
    requirementPattern: 'REQ-',
    useStructuredParsing: true,
    generateImplementation: true,
    resolveDependencies: false,
  },
  drupal: {
    enabled: true,
    cacheCommand: 'ddev exec drush cr',
    servicesPath: 'docroot/modules/share/*/services.yml',
    schemaPath: 'docroot/modules/share/bd/config/schema/bd.schema.yml',
    entityTypeBuilder: 'entity_type.builder',
  },
  wizard: {
    baseUrl: '/admin/content/wizard/add/api_spec',
    editUrlPattern: '/admin/content/wizard/{id}/edit',
    iefSelectors: {
      container: '[data-drupal-selector*="inline-entity-form"]',
      table: '.ief-table, table.ief-entity-table',
      addButton: 'input[value*="Add"], button:has-text("Add")',
    },
  },
};

