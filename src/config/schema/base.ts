import { z } from 'zod';

/**
 * Base schema fragments and common types
 * These are shared across multiple schema files
 */

/**
 * Log source schema - defines where logs come from
 */
export const logSourceSchema = z.object({
  type: z.enum(['file', 'command']),
  path: z.string().optional(),
  command: z.string().optional(),
});

