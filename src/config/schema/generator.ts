import { configSchema } from './core';
import type { ZodTypeAny } from 'zod';

/**
 * JSON Schema Generator
 *
 * Generates JSON Schema from Zod schemas using Zod v4's native toJSONSchema()
 *
 * Benefits:
 * - No external dependencies (uses Zod's built-in method)
 * - IDE autocomplete for JSON config files
 * - Documentation generation
 * - Cross-language validation
 */

/**
 * Generates JSON Schema from a Zod schema
 */
export function generateJsonSchema(schema: ZodTypeAny): Record<string, any> {
  // Note: toJSONSchema() is available in Zod v4+
  // TypeScript will error if this method doesn't exist, ensuring v4 is used
  if (typeof (schema as any).toJSONSchema === 'function') {
    return (schema as any).toJSONSchema({
      target: 'openApi3',
      $refStrategy: 'none',
    });
  }
  throw new Error('Zod v4+ is required for toJSONSchema() method. Please upgrade zod to ^4.0.0');
}

/**
 * Generates JSON Schema for the main config schema
 */
export function generateConfigJsonSchema(): Record<string, any> {
  return generateJsonSchema(configSchema);
}
