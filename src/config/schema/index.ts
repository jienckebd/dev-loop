import { z } from 'zod';

/**
 * Main entry point for schema exports
 *
 * This file re-exports all schemas for backward compatibility.
 * All existing imports from '../config/schema' will continue to work.
 */

// Re-export all schemas
export * from './base';
export * from './core';
export * from './framework';
export * from './prd';
export * from './overlays';
export * from './phase';
export * from './validation';
export * from './runtime';
export * from './metrics';
export * from './metadata';
export * from './generator';

// Main exports (maintains backward compatibility with old schema.ts)
export { configSchema, Config, configOverlaySchema } from './core';
export { frameworkConfigSchema, FrameworkConfig } from './framework';
export { createConfigOverlaySchema } from './overlays';
export type { ConfigOverlay } from './overlays';
export { phaseDefinitionSchema, PhaseDefinition } from './phase';
export { validateConfig, validateConfigOverlay } from './validation';

// Re-export prdSetConfigSchema and phaseConfigSchema as aliases
// These are the same as configOverlaySchema but exported for clarity
import { configOverlaySchema } from './core';
export const prdSetConfigSchema = configOverlaySchema;
export const phaseConfigSchema = configOverlaySchema;
export type PrdSetConfig = z.infer<typeof prdSetConfigSchema>;
export type PhaseConfig = z.infer<typeof phaseConfigSchema>;

