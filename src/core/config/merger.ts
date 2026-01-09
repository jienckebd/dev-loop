/**
 * Hierarchical Configuration Merger
 *
 * Merges configuration overlays in the following order:
 * Project Config -> Framework Config -> PRD Set Config -> PRD Config -> Phase Config
 *
 * Later levels override earlier levels. Deep merge for nested objects.
 * Special handling for arrays that should be concatenated vs replaced.
 */

import { Config, ConfigOverlay, validateConfig } from '../../config/schema';
import { logger } from '../utils/logger';

/**
 * Arrays that should be concatenated (not replaced) when merging
 */
const CONCATENATE_ARRAYS = new Set([
  'framework.rules',
  'codebase.searchDirs',
  'codebase.excludeDirs',
  'codebase.ignoreGlobs',
  'hooks.preTest',
  'hooks.postApply',
]);

/**
 * Deep merge two objects, with special handling for arrays
 */
function deepMerge(target: any, source: any, path: string = ''): any {
  if (source === null || source === undefined) {
    return target;
  }

  // For primitives, return source
  if (typeof source !== 'object') {
    return source;
  }

  // For arrays, check if we should concatenate or replace
  if (Array.isArray(source)) {
    if (CONCATENATE_ARRAYS.has(path) && Array.isArray(target)) {
      // Concatenate arrays, removing duplicates
      const combined = [...target];
      for (const item of source) {
        if (!combined.includes(item)) {
          combined.push(item);
        }
      }
      return combined;
    }
    // Default: replace array
    return [...source];
  }

  // For objects, recursively merge
  const result = target && typeof target === 'object' ? { ...target } : {};

  for (const key of Object.keys(source)) {
    const newPath = path ? `${path}.${key}` : key;
    result[key] = deepMerge(result[key], source[key], newPath);
  }

  return result;
}

/**
 * Merge configuration hierarchy
 *
 * @param base - Base project config (required, strict schema)
 * @param framework - Framework config overlay (optional)
 * @param prdSet - PRD set config overlay (optional)
 * @param prd - PRD config overlay (optional)
 * @param phase - Phase config overlay (optional)
 * @returns Merged effective configuration
 */
export function mergeConfigHierarchy(
  base: Config,
  framework?: Partial<Config>,
  prdSet?: ConfigOverlay,
  prd?: ConfigOverlay,
  phase?: ConfigOverlay
): Config {
  // Start with a deep copy of base config
  let effectiveConfig = JSON.parse(JSON.stringify(base));

  // Merge in order: framework -> prdSet -> prd -> phase
  if (framework) {
    effectiveConfig = deepMerge(effectiveConfig, framework);
    logger.debug('[ConfigMerger] Applied framework config overlay');
  }

  if (prdSet) {
    effectiveConfig = deepMerge(effectiveConfig, prdSet);
    logger.debug('[ConfigMerger] Applied PRD set config overlay');
  }

  if (prd) {
    effectiveConfig = deepMerge(effectiveConfig, prd);
    logger.debug('[ConfigMerger] Applied PRD config overlay');
  }

  if (phase) {
    effectiveConfig = deepMerge(effectiveConfig, phase);
    logger.debug('[ConfigMerger] Applied phase config overlay');
  }

  // Validate the final merged config
  try {
    return validateConfig(effectiveConfig);
  } catch (error) {
    logger.warn(`[ConfigMerger] Merged config validation failed, returning unvalidated: ${error instanceof Error ? error.message : String(error)}`);
    return effectiveConfig as Config;
  }
}

/**
 * Create effective config for a specific phase
 *
 * @param base - Base project config
 * @param prdSetConfig - PRD set config overlay (optional)
 * @param prdConfig - PRD config overlay (optional)
 * @param phaseConfig - Phase config overlay (optional)
 * @returns Merged effective configuration for this phase
 */
export function createPhaseEffectiveConfig(
  base: Config,
  prdSetConfig?: ConfigOverlay,
  prdConfig?: ConfigOverlay,
  phaseConfig?: ConfigOverlay
): Config {
  // Framework config is already part of base config
  return mergeConfigHierarchy(base, undefined, prdSetConfig, prdConfig, phaseConfig);
}

/**
 * Extract framework config from base config
 */
export function extractFrameworkConfig(config: Config): Partial<Config> | undefined {
  if (!config.framework) {
    return undefined;
  }
  return { framework: config.framework };
}

/**
 * Merge two config overlays (for combining PRD set and PRD config before phase)
 */
export function mergeOverlays(base: ConfigOverlay, overlay: ConfigOverlay): ConfigOverlay {
  return deepMerge(base, overlay) as ConfigOverlay;
}

/**
 * Context for holding current effective config during execution
 */
export interface ConfigContext {
  baseConfig: Config;
  prdSetConfig?: ConfigOverlay;
  prdConfig?: ConfigOverlay;
  phaseConfig?: ConfigOverlay;
  effectiveConfig: Config;
}

/**
 * Create a new config context
 */
export function createConfigContext(baseConfig: Config): ConfigContext {
  return {
    baseConfig,
    effectiveConfig: baseConfig,
  };
}

/**
 * Update config context with PRD set config
 */
export function applyPrdSetConfig(context: ConfigContext, prdSetConfig?: ConfigOverlay): ConfigContext {
  context.prdSetConfig = prdSetConfig;
  context.effectiveConfig = mergeConfigHierarchy(
    context.baseConfig,
    undefined,
    context.prdSetConfig,
    context.prdConfig,
    context.phaseConfig
  );
  return context;
}

/**
 * Update config context with PRD config
 */
export function applyPrdConfig(context: ConfigContext, prdConfig?: ConfigOverlay): ConfigContext {
  context.prdConfig = prdConfig;
  context.effectiveConfig = mergeConfigHierarchy(
    context.baseConfig,
    undefined,
    context.prdSetConfig,
    context.prdConfig,
    context.phaseConfig
  );
  return context;
}

/**
 * Update config context with phase config
 */
export function applyPhaseConfig(context: ConfigContext, phaseConfig?: ConfigOverlay): ConfigContext {
  context.phaseConfig = phaseConfig;
  context.effectiveConfig = mergeConfigHierarchy(
    context.baseConfig,
    undefined,
    context.prdSetConfig,
    context.prdConfig,
    context.phaseConfig
  );
  return context;
}

/**
 * Clear phase config (when exiting a phase)
 */
export function clearPhaseConfig(context: ConfigContext): ConfigContext {
  context.phaseConfig = undefined;
  context.effectiveConfig = mergeConfigHierarchy(
    context.baseConfig,
    undefined,
    context.prdSetConfig,
    context.prdConfig,
    undefined
  );
  return context;
}

/**
 * Clear PRD config (when exiting a PRD)
 */
export function clearPrdConfig(context: ConfigContext): ConfigContext {
  context.prdConfig = undefined;
  context.phaseConfig = undefined;
  context.effectiveConfig = mergeConfigHierarchy(
    context.baseConfig,
    undefined,
    context.prdSetConfig,
    undefined,
    undefined
  );
  return context;
}

/**
 * Clear all overlays (reset to base config)
 */
export function clearAllOverlays(context: ConfigContext): ConfigContext {
  context.prdSetConfig = undefined;
  context.prdConfig = undefined;
  context.phaseConfig = undefined;
  context.effectiveConfig = context.baseConfig;
  return context;
}

