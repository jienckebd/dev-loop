import { z } from 'zod';
import type { ZodObject, ZodTypeAny } from 'zod';

/**
 * Configuration overlay schemas
 *
 * These schemas support hierarchical configuration merging:
 * Project Config -> Framework Config -> PRD Set Config -> PRD Config -> Phase Config
 * Later levels override earlier levels. Overlays use passthrough() for extensibility.
 */

/**
 * Creates the configuration overlay schema from the base config schema
 * This eliminates ~120 lines of duplication by using .partial() to make all fields optional
 */
export function createConfigOverlaySchema(configSchema: ZodObject<any>): ZodObject<any> {
  return configSchema.partial().passthrough();
}

// The actual configOverlaySchema will be created in core.ts after configSchema is defined
// This is exported here for type purposes
export type ConfigOverlay = z.infer<ReturnType<typeof createConfigOverlaySchema>>;

/**
 * PRD Set configuration schema (alias to ConfigOverlay)
 * Used for PRD set level configuration
 */
export type PrdSetConfig = ConfigOverlay;

/**
 * Phase configuration schema (alias to ConfigOverlay)
 * Used for phase level configuration in PRD frontmatter
 */
export type PhaseConfig = ConfigOverlay;

