/**
 * Pattern Library Schema
 *
 * Schema for persistent storage of discovered patterns.
 * Used by both init and build-prd-set commands to share knowledge.
 */

import { z } from 'zod';

/**
 * Code pattern discovered in codebase
 */
export const codePatternSchema = z.object({
  id: z.string().describe('Unique pattern identifier'),
  type: z.enum(['schema', 'plugin', 'service', 'test', 'config', 'entity', 'form', 'other']).describe('Pattern type'),
  signature: z.string().describe('Pattern signature or description'),
  files: z.array(z.string()).describe('Files where pattern was found'),
  occurrences: z.number().describe('Number of occurrences'),
  discoveredAt: z.string().describe('ISO date when pattern was discovered'),
  lastUsedAt: z.string().optional().describe('ISO date when pattern was last used'),
  frameworkHints: z.array(z.string()).optional().describe('Framework hints for this pattern'),
  suggestedAbstraction: z.string().optional().describe('Suggested abstraction if pattern should be DRY'),
});

/**
 * Test pattern discovered in codebase
 */
export const testPatternSchema = z.object({
  id: z.string().describe('Unique test pattern identifier'),
  framework: z.string().describe('Test framework (e.g., playwright, cypress, jest)'),
  structure: z.string().describe('Test structure pattern'),
  exampleFiles: z.array(z.string()).describe('Example test files'),
  successRate: z.number().optional().describe('Success rate of tests using this pattern (0-1)'),
});

/**
 * Schema pattern (framework-specific)
 */
export const schemaPatternSchema = z.object({
  id: z.string().describe('Unique schema pattern identifier'),
  type: z.string().describe('Schema type (e.g., bd.entity_type, node.type)'),
  pattern: z.string().describe('Pattern description'),
  exampleFiles: z.array(z.string()).describe('Example files using this pattern'),
  framework: z.string().describe('Framework this pattern belongs to'),
  commonFields: z.array(z.string()).optional().describe('Common fields in this schema type'),
});

/**
 * Pattern library metadata
 */
export const patternLibraryMetadataSchema = z.object({
  lastAnalyzed: z.string().describe('ISO date of last analysis'),
  totalPatterns: z.number().describe('Total number of patterns'),
  frameworkDistribution: z.record(z.string(), z.number()).optional().describe('Count of patterns by framework'),
  version: z.string().optional().describe('Pattern library version'),
});

/**
 * Complete pattern library schema
 */
export const patternLibrarySchema = z.object({
  // Code patterns discovered in codebase
  codePatterns: z.array(codePatternSchema).optional(),

  // Test patterns
  testPatterns: z.array(testPatternSchema).optional(),

  // Schema patterns (framework-specific)
  schemaPatterns: z.array(schemaPatternSchema).optional(),

  // Learning metadata
  metadata: patternLibraryMetadataSchema.optional(),
});

/**
 * Types inferred from schemas
 */
export type CodePattern = z.infer<typeof codePatternSchema>;
export type TestPattern = z.infer<typeof testPatternSchema>;
export type SchemaPattern = z.infer<typeof schemaPatternSchema>;
export type PatternLibraryMetadata = z.infer<typeof patternLibraryMetadataSchema>;
export type PatternLibrary = z.infer<typeof patternLibrarySchema>;

/**
 * Validate pattern library data
 */
export function validatePatternLibrary(data: unknown): PatternLibrary {
  return patternLibrarySchema.parse(data);
}

/**
 * Create empty pattern library
 */
export function createEmptyPatternLibrary(): PatternLibrary {
  return {
    codePatterns: [],
    testPatterns: [],
    schemaPatterns: [],
    metadata: {
      lastAnalyzed: new Date().toISOString(),
      totalPatterns: 0,
    },
  };
}
