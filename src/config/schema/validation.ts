import { z } from 'zod';
import { configSchema } from './core';
import { createConfigOverlaySchema } from './overlays';
import {
  patternsFileSchema,
  observationsFileSchema,
  metricsFileSchema,
  stateFileSchema,
  testResultsFileSchema,
} from './runtime';
import {
  prdSetMetricsFileSchema,
  prdMetricsFileSchema,
  phaseMetricsFileSchema,
  parallelMetricsFileSchema,
  featureMetricsFileSchema,
  schemaMetricsFileSchema,
  contributionModeFileSchema,
  retryCountsFileSchema,
  evolutionStateFileSchema,
} from './metrics';
import {
  prdSetStateSchema,
  chatRequestSchema,
  sessionSchema,
  checkpointSchema,
  conversationFileSchema,
  prdContextV2FileSchema,
} from './metadata';

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
  // Note: Schema validation tracking is handled by SchemaTracker in workflow.ts
  // This function performs low-level validation; tracking is done at the workflow level
  return configSchema.parse(data);
}

/**
 * Runtime data schema validation functions
 */
export function validatePatternsFile(data: unknown): z.infer<typeof patternsFileSchema> {
  return patternsFileSchema.parse(data);
}

export function validateObservationsFile(data: unknown): z.infer<typeof observationsFileSchema> {
  return observationsFileSchema.parse(data);
}

export function validateMetricsFile(data: unknown): z.infer<typeof metricsFileSchema> {
  return metricsFileSchema.parse(data);
}

export function validateStateFile(data: unknown): z.infer<typeof stateFileSchema> {
  return stateFileSchema.parse(data);
}

export function validateTestResultsFile(data: unknown): z.infer<typeof testResultsFileSchema> {
  return testResultsFileSchema.parse(data);
}

/**
 * Metrics schema validation functions
 */
export function validatePrdSetMetricsFile(data: unknown): z.infer<typeof prdSetMetricsFileSchema> {
  return prdSetMetricsFileSchema.parse(data);
}

export function validatePrdMetricsFile(data: unknown): z.infer<typeof prdMetricsFileSchema> {
  return prdMetricsFileSchema.parse(data);
}

export function validatePhaseMetricsFile(data: unknown): z.infer<typeof phaseMetricsFileSchema> {
  return phaseMetricsFileSchema.parse(data);
}

export function validateParallelMetricsFile(data: unknown): z.infer<typeof parallelMetricsFileSchema> {
  return parallelMetricsFileSchema.parse(data);
}

export function validateFeatureMetricsFile(data: unknown): z.infer<typeof featureMetricsFileSchema> {
  return featureMetricsFileSchema.parse(data);
}

export function validateSchemaMetricsFile(data: unknown): z.infer<typeof schemaMetricsFileSchema> {
  return schemaMetricsFileSchema.parse(data);
}

export function validateContributionModeFile(data: unknown): z.infer<typeof contributionModeFileSchema> {
  return contributionModeFileSchema.parse(data);
}

export function validateRetryCountsFile(data: unknown): z.infer<typeof retryCountsFileSchema> {
  return retryCountsFileSchema.parse(data);
}

export function validateEvolutionStateFile(data: unknown): z.infer<typeof evolutionStateFileSchema> {
  return evolutionStateFileSchema.parse(data);
}

/**
 * Metadata schema validation functions
 */
export function validatePrdSetState(data: unknown): z.infer<typeof prdSetStateSchema> {
  return prdSetStateSchema.parse(data);
}

export function validateChatRequest(data: unknown): z.infer<typeof chatRequestSchema> {
  return chatRequestSchema.parse(data);
}

export function validateSession(data: unknown): z.infer<typeof sessionSchema> {
  return sessionSchema.parse(data);
}

export function validateCheckpoint(data: unknown): z.infer<typeof checkpointSchema> {
  return checkpointSchema.parse(data);
}

export function validateConversationFile(data: unknown): z.infer<typeof conversationFileSchema> {
  return conversationFileSchema.parse(data);
}

export function validatePrdContextV2File(data: unknown): z.infer<typeof prdContextV2FileSchema> {
  return prdContextV2FileSchema.parse(data);
}
