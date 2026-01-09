import { z } from 'zod';
import { configSchema } from './core';
import { createConfigOverlaySchema } from './overlays';

/**
 * Validation functions for configuration schemas
 */

// Create configOverlaySchema for validation
const configOverlaySchema = createConfigOverlaySchema(configSchema);

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
        'prd', 'testGeneration', 'scan',
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

export function validateConfig(data: unknown): z.infer<typeof configSchema> {
  return configSchema.parse(data);
}

