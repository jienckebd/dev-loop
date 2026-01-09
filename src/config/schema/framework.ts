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
});

export type FrameworkConfig = z.infer<typeof frameworkConfigSchema>;

