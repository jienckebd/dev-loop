import { z } from 'zod';
import { createConfigOverlaySchema } from './overlays';
import { configSchema } from './core';

/**
 * Phase definition schema with optional config overlay
 */

// Create configOverlaySchema for phase config
const configOverlaySchema = createConfigOverlaySchema(configSchema);

export const phaseConfigSchema = configOverlaySchema;
export type PhaseConfig = z.infer<typeof phaseConfigSchema>;

export const phaseDefinitionSchema = z.object({
  id: z.number(),
  name: z.string(),
  range: z.string().optional(),
  pattern: z.string().optional(),
  parallel: z.boolean().optional(),
  dependsOn: z.array(z.number()).optional(),
  status: z.string().optional(),
  deferredReason: z.string().optional(),
  note: z.string().optional(),
  file: z.string().optional(),
  checkpoint: z.boolean().optional(),
  validation: z.object({
    after: z.array(z.string()).optional(),
    tests: z.array(z.string()).optional(),
    assertions: z.array(z.string()).optional(),
  }).optional(),
  // Phase config overlay (NEW)
  config: phaseConfigSchema.optional(),
});

export type PhaseDefinition = z.infer<typeof phaseDefinitionSchema>;

