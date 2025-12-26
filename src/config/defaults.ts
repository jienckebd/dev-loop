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
};

