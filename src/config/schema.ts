/**
 * Re-export from new modular schema structure
 *
 * This file is kept for backward compatibility.
 * All existing imports from '../config/schema' will continue to work.
 *
 * New code should import from './config/schema' (which resolves to schema/index.ts)
 * for better tree-shaking and clarity.
 */

export * from './schema/index';
