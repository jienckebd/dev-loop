/**
 * Re-export config merger functionality from the core config module
 * 
 * This file provides backwards compatibility for code that imports
 * from './config-merger' in the parser directory.
 */

export { mergeConfigHierarchy } from '../../../config/merger';
