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
    skipInvestigation: false,
    skipPrerequisiteValidation: false,
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
  // NOTE: drupal and wizard configs have been moved to:
  // - framework.config.drupal (in devloop.config.js)
  // - PRD config overlays (for project-specific config)
  // They are no longer part of the base Config schema.
};

