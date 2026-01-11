import { z } from 'zod';

/**
 * Framework configuration schema (strict, extracted from Config)
 * Used for framework-specific validation.
 *
 * The `config` object allows framework-specific extensions:
 * - framework.config.drupal - Drupal-specific config
 * - framework.config.react - React-specific config
 * - framework.config.django - Django-specific config
 */
export const frameworkConfigSchema = z.object({
  type: z.string().optional(),
  rules: z.array(z.string()).optional(),
  taskPatterns: z.array(z.string()).optional(),
  errorPathPatterns: z.array(z.string()).optional(),
  errorGuidance: z.record(z.string(), z.string()).optional(),
  identifierPatterns: z.array(z.string()).optional(),
  templatePath: z.string().optional(),
  // Framework-specific config extensions (e.g., framework.config.drupal)
  config: z.record(z.string(), z.any()).optional(),
  // NEW: PRD Generation configuration
  prdGeneration: z.object({
    scenarios: z.object({
      schema: z.object({
        patterns: z.array(z.string()).optional().describe('Framework-specific schema patterns (e.g., bd.entity_type.*.yml)'),
        conventions: z.array(z.string()).optional().describe('Schema naming and structure conventions'),
        examples: z.array(z.string()).optional().describe('Example schema files to reference'),
      }).optional(),
      test: z.object({
        patterns: z.array(z.string()).optional().describe('Test file patterns (e.g., tests/playwright/auto/*.spec.ts)'),
        framework: z.string().optional().describe('Test framework (playwright, cypress, jest)'),
        conventions: z.array(z.string()).optional().describe('Test naming and structure conventions'),
        examples: z.array(z.string()).optional().describe('Example test files to reference'),
      }).optional(),
      feature: z.object({
        patterns: z.array(z.string()).optional().describe('Feature implementation patterns'),
        conventions: z.array(z.string()).optional().describe('Feature structure conventions'),
        examples: z.array(z.string()).optional().describe('Example feature implementations'),
      }).optional(),
    }).optional(),
    codeQualityTools: z.array(z.object({
      name: z.string(),
      purpose: z.enum(['static-analysis', 'duplicate-detection', 'security', 'complexity', 'tech-debt', 'dependency-audit']),
      command: z.string(),
      outputFormat: z.enum(['json', 'xml', 'text', 'sarif']),
      installCommand: z.string().optional(),
      description: z.string().optional(),
    })).optional().describe('Code quality tools from framework plugin'),
    techDebtIndicators: z.array(z.object({
      pattern: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
      category: z.enum(['deprecated-api', 'todo', 'fixme', 'hack', 'obsolete-pattern', 'missing-test', 'security', 'tech-debt']),
      description: z.string(),
      remediation: z.string().optional(),
    })).optional().describe('Tech debt patterns from framework plugin'),
    recommendationPatterns: z.array(z.object({
      id: z.string(),
      pattern: z.string(),
      recommendationType: z.enum(['error-pattern', 'config-schema', 'new-plugin']),
      description: z.string(),
      priority: z.enum(['low', 'medium', 'high']),
    })).optional().describe('Recommendation patterns from framework plugin'),
  }).optional(),
});

export type FrameworkConfig = z.infer<typeof frameworkConfigSchema>;

