import * as fs from 'fs-extra';
import * as path from 'path';
import { Config, validateConfig } from '../config/schema';
import { defaultConfig } from '../config/defaults';
import { logger } from './logger';

/**
 * PRD Config Parser
 * 
 * Extracts and parses configuration sections from PRD markdown files.
 * PRDs can contain a "Dev-Loop Configuration" section with JavaScript
 * code blocks that define config overlays to merge with base config.
 */
export class PrdConfigParser {
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Extract configuration overlay from PRD file
   */
  async parsePrdConfig(prdPath: string): Promise<Partial<Config> | null> {
    try {
      const content = await fs.readFile(prdPath, 'utf-8');
      const configSection = this.extractConfigSection(content);
      
      if (!configSection) {
        if (this.debug) {
          logger.debug('[PrdConfigParser] No config section found in PRD');
        }
        return null;
      }

      if (this.debug) {
        logger.debug('[PrdConfigParser] Found config section in PRD');
      }

      const configOverlay = this.parseConfigObject(configSection);
      
      if (this.debug) {
        logger.debug(`[PrdConfigParser] Parsed config overlay with keys: ${Object.keys(configOverlay).join(', ')}`);
      }

      return configOverlay;
    } catch (error) {
      logger.warn(`[PrdConfigParser] Failed to parse PRD config: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Extract JavaScript code block from "Dev-Loop Configuration" section
   */
  private extractConfigSection(content: string): string | null {
    // Look for "## Dev-Loop Configuration" or similar section headers
    // Match until the next same-level (##) header, markdown separator (---), or end of file
    // Note: We want to include subsection headers (###) as they're part of the config section
    const sectionPattern = /^##\s+Dev-Loop\s+Configuration[^\n]*\n([\s\S]+?)(?=^##\s|^---\s*$|$(?![\s\S]))/m;
    const match = content.match(sectionPattern);
    
    if (!match) {
      return null;
    }

    const sectionContent = match[1];
    
    // Extract JavaScript code blocks
    const jsBlockPattern = /```(?:javascript|js)\n([\s\S]*?)\n```/g;
    const codeBlocks: string[] = [];
    let blockMatch;
    
    while ((blockMatch = jsBlockPattern.exec(sectionContent)) !== null) {
      codeBlocks.push(blockMatch[1]);
    }

    if (codeBlocks.length === 0) {
      return null;
    }

    // Combine all code blocks (in case there are multiple)
    return codeBlocks.join('\n');
  }

  /**
   * Parse JavaScript code and extract config object
   * 
   * This safely evaluates JavaScript code blocks that should only contain
   * configuration object assignments. It looks for patterns like:
   * - module.exports = { ... }
   * - export default { ... }
   * - const config = { ... }; return config;
   * - Direct object literals
   */
  private parseConfigObject(jsCode: string): Partial<Config> {
    try {
      // Remove leading/trailing whitespace
      const trimmed = jsCode.trim();

      // Try to extract config object from common patterns
      let configObj: any = null;

      // Pattern 1: module.exports = { ... }
      const moduleExportsMatch = trimmed.match(/module\.exports\s*=\s*(\{[\s\S]*\});?\s*$/);
      if (moduleExportsMatch) {
        configObj = this.safeEval(`(${moduleExportsMatch[1]})`);
      }

      // Pattern 2: export default { ... }
      const exportDefaultMatch = trimmed.match(/export\s+default\s+(\{[\s\S]*\});?\s*$/);
      if (exportDefaultMatch) {
        configObj = this.safeEval(`(${exportDefaultMatch[1]})`);
      }

      // Pattern 3: const config = { ... } or let config = { ... }
      const constConfigMatch = trimmed.match(/(?:const|let|var)\s+\w+\s*=\s*(\{[\s\S]*\});?\s*$/);
      if (constConfigMatch && !configObj) {
        configObj = this.safeEval(`(${constConfigMatch[1]})`);
      }

      // Pattern 4: Multiple property assignments (prd: { ... }, drupal: { ... })
      if (!configObj) {
        // Extract all object literal assignments
        const propertyPattern = /(\w+):\s*\{([^}]*\{[^}]*\}[^}]*)*\}/g;
        const matches = Array.from(trimmed.matchAll(propertyPattern));
        
        if (matches.length > 0) {
          configObj = {};
          for (const match of matches) {
            const key = match[1];
            try {
              const value = this.safeEval(`(${match[0]})`);
              if (value && typeof value === 'object') {
                configObj[key] = value;
              }
            } catch (e) {
              if (this.debug) {
                logger.debug(`[PrdConfigParser] Failed to parse property ${key}: ${e}`);
              }
            }
          }
        }
      }

      // Pattern 5: Try wrapping entire code in IIFE that returns object
      if (!configObj) {
        try {
          // Try to extract a single top-level object
          const objectMatch = trimmed.match(/(\{[\s\S]*\})/);
          if (objectMatch) {
            configObj = this.safeEval(`(${objectMatch[1]})`);
          }
        } catch (e) {
          // Ignore
        }
      }

      if (!configObj || typeof configObj !== 'object') {
        throw new Error('Could not extract config object from JavaScript code');
      }

      // Validate and return partial config
      // We don't validate the full config here since it's a partial overlay
      return configObj as Partial<Config>;
    } catch (error) {
      logger.warn(`[PrdConfigParser] Failed to parse config object: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Safely evaluate JavaScript expression in a controlled context
   * 
   * This uses Function constructor to evaluate code, which is safer than eval
   * but still should only be used with trusted PRD files.
   */
  private safeEval(code: string): any {
    try {
      // Use Function constructor for safer evaluation (creates isolated scope)
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function('return ' + code);
      return fn();
    } catch (error) {
      throw new Error(`Failed to evaluate config code: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Merge PRD config overlay with base config
   * 
   * Performs deep merge, where PRD config values override base config values.
   * Arrays are merged by appending PRD values to base values (unless they're
   * explicitly replaced).
   */
  mergeWithBaseConfig(baseConfig: Config, prdConfig: Partial<Config>): Config {
    // Start with base config
    const merged = JSON.parse(JSON.stringify(baseConfig)) as Config;

    // Deep merge function
    const deepMerge = (target: any, source: any): any => {
      if (source === null || source === undefined) {
        return target;
      }

      if (typeof source !== 'object' || Array.isArray(source)) {
        // For primitives and arrays, replace with source value
        return source;
      }

      const result = { ...target };

      for (const key in source) {
        if (source.hasOwnProperty(key)) {
          if (target[key] && typeof target[key] === 'object' && typeof source[key] === 'object' && !Array.isArray(target[key]) && !Array.isArray(source[key])) {
            // Recursive merge for nested objects
            result[key] = deepMerge(target[key], source[key]);
          } else {
            // Replace or set value
            result[key] = source[key];
          }
        }
      }

      return result;
    };

    // Special handling for arrays that should be merged (not replaced)
    // e.g., codebase.filePathPatterns, framework.rules
    if (prdConfig.codebase?.filePathPatterns && merged.codebase?.filePathPatterns) {
      // Merge arrays by appending (remove duplicates)
      const existing = merged.codebase.filePathPatterns;
      const newPatterns = prdConfig.codebase.filePathPatterns.filter(p => !existing.includes(p));
      merged.codebase.filePathPatterns = [...existing, ...newPatterns];
      delete prdConfig.codebase.filePathPatterns; // Remove from overlay to avoid double-merge
    }

    if (prdConfig.framework?.rules && merged.framework?.rules) {
      // Merge framework rules arrays
      const existing = merged.framework.rules;
      const newRules = prdConfig.framework.rules.filter(r => !existing.includes(r));
      merged.framework.rules = [...existing, ...newRules];
      delete prdConfig.framework.rules;
    }

    if (prdConfig.codebase?.searchDirs && merged.codebase?.searchDirs) {
      const existing = merged.codebase.searchDirs;
      const newDirs = prdConfig.codebase.searchDirs.filter(d => !existing.includes(d));
      merged.codebase.searchDirs = [...existing, ...newDirs];
      delete prdConfig.codebase.searchDirs;
    }

    // Perform deep merge for remaining config
    const finalMerged = deepMerge(merged, prdConfig) as Config;

    // Validate the merged config
    try {
      return validateConfig(finalMerged);
    } catch (error) {
      logger.warn(`[PrdConfigParser] Merged config validation failed, using base config: ${error instanceof Error ? error.message : String(error)}`);
      return baseConfig;
    }
  }
}