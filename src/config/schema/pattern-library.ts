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
 * Error pattern learned from validation/test failures
 * (from PatternLearningSystem - v1 schema)
 */
export const errorPatternSchema = z.object({
  id: z.string().describe('Unique error pattern identifier'),
  pattern: z.string().describe('Error signature or pattern (regex)'),
  guidance: z.string().describe('Guidance on how to avoid or fix this error'),
  occurrences: z.number().describe('Number of times this error pattern was seen'),
  lastSeen: z.string().describe('ISO date when pattern was last seen'),
  files: z.array(z.string()).optional().describe('Files where this pattern was seen'),
  projectTypes: z.array(z.string()).optional().describe('Project types where pattern was seen (e.g., "drupal", "react")'),
  injectionCount: z.number().optional().describe('Times this pattern was injected into prompts'),
  preventionCount: z.number().optional().describe('Times this pattern helped prevent an error'),
  lastInjected: z.string().optional().describe('ISO date when pattern was last injected'),
});

/**
 * PRD pattern entry from learning files
 * (from PatternLoader - v2 schema)
 */
export const prdPatternSchema = z.object({
  id: z.string().describe('Unique PRD pattern identifier'),
  createdAt: z.string().describe('ISO date when pattern was created'),
  lastUsedAt: z.string().describe('ISO date when pattern was last used'),
  relevanceScore: z.number().describe('Relevance score 0-1'),
  expiresAt: z.string().nullable().optional().describe('ISO date when pattern expires (null if doesn\'t expire)'),
  prdId: z.string().optional().describe('PRD ID where pattern was learned'),
  framework: z.string().optional().describe('Framework type (e.g., "drupal", "react")'),
  category: z.string().describe('Pattern category (e.g., "schema", "test", "feature", "error-pattern")'),
  pattern: z.string().describe('The actual pattern/text'),
  examples: z.array(z.string()).optional().describe('Example uses of this pattern'),
  metadata: z.record(z.string(), z.any()).optional().describe('Additional metadata'),
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

  // Error patterns learned from validation/test failures (from PatternLearningSystem)
  errorPatterns: z.array(errorPatternSchema).optional(),

  // PRD patterns from learning files (from PatternLoader)
  prdPatterns: z.array(prdPatternSchema).optional(),

  // Learning metadata
  metadata: patternLibraryMetadataSchema.optional(),
});

/**
 * Types inferred from schemas
 */
export type CodePattern = z.infer<typeof codePatternSchema>;
export type TestPattern = z.infer<typeof testPatternSchema>;
export type SchemaPattern = z.infer<typeof schemaPatternSchema>;
export type ErrorPattern = z.infer<typeof errorPatternSchema>;
export type PrdPattern = z.infer<typeof prdPatternSchema>;
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
    errorPatterns: [],
    prdPatterns: [],
    metadata: {
      lastAnalyzed: new Date().toISOString(),
      totalPatterns: 0,
    },
  };
}
