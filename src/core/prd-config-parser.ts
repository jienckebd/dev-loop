import * as fs from 'fs-extra';
import * as path from 'path';
import { parse as yamlParse } from 'yaml';
import { Config, validateConfig } from '../config/schema';
import { defaultConfig } from '../config/defaults';
import { logger } from './logger';

/**
 * PRD Config Parser
 *
 * Extracts and parses configuration sections from PRD markdown files.
 * Supports three formats:
 * 1. YAML frontmatter (recommended)
 * 2. HTML comment metadata (legacy)
 * 3. JavaScript code blocks in "Dev-Loop Configuration" section
 */
export interface PrdMetadata {
  prd?: {
    id: string;
    version: string;
    status: 'planning' | 'ready' | 'active' | 'blocked' | 'complete' | 'split';
    parentPrd?: string;
    prdSequence?: number;
    note?: string;
  };
  execution?: {
    strategy?: 'sequential' | 'parallel' | 'phased';
    parallelism?: {
      testGeneration?: number;
      testExecution?: number;
      requirementGroups?: boolean;
    };
    maxIterations?: number;
    timeoutMinutes?: number;
    waitForPrds?: boolean;
  };
  requirements?: {
    idPattern?: string;
    phases?: Array<{
      id: number;
      name: string;
      range?: string;
      pattern?: string;
      parallel?: boolean;
      dependsOn?: number[];
    }>;
    dependencies?: Record<string, string[]>;
  };
  testing?: {
    directory: string;
    framework?: 'playwright' | 'cypress' | 'jest';
    parallel?: boolean;
    workers?: number;
    bundledTests?: boolean;
    cleanupArtifacts?: boolean;
  };
  dependencies?: {
    externalModules?: string[];
    prds?: string[];
  };
  product?: {
    id: string;
    version: string;
    status: 'planning' | 'ready' | 'active' | 'blocked' | 'complete' | 'deprecated';
    schemaOrg?: {
      type: string;
      additionalTypes?: string[];
      properties?: Record<string, string>;
    };
    metadata?: {
      author?: string;
      created?: string;
      modified?: string;
      license?: string;
      tags?: string[];
      category?: string;
    };
  };
  openapi?: {
    specUrl?: string;
    specPath?: string;
    components?: {
      schemas?: Record<string, any>;
    };
    schemasToImport?: string[];
    fieldTypeMapping?: Record<string, string>;
  };
  entityGeneration?: {
    entityType?: {
      id: string;
      label: string;
      type: 'config' | 'content';
      base?: string;
      schemaOrg?: {
        type: string;
        subtype?: string;
      };
    };
    bundles?: Array<{
      schemaName: string;
      bundleId: string;
      label: string;
      schemaOrg?: {
        type: string;
        properties?: Record<string, string>;
      };
    }>;
    fieldMappings?: Record<string, any>;
  };
  schemaOrg?: {
    namespace?: string;
    primaryType?: string;
    strategy?: 'manual' | 'ai_assisted' | 'auto';
    aiProvider?: string;
    typeMappings?: Record<string, any>;
    propertyMappings?: Record<string, string>;
    customVocabulary?: {
      prefix: string;
      namespace: string;
      terms?: Array<{
        id: string;
        label: string;
        subClassOf?: string;
      }>;
    };
  };
  validation?: {
    criteriaFormat?: 'gherkin' | 'assertions' | 'custom';
    globalRules?: Array<{
      rule: string;
      description: string;
      test: string;
    }>;
    requirementTests?: Record<string, any>;
    fieldValidation?: Record<string, any[]>;
    integrationTests?: Array<{
      name: string;
      requirements: string[];
      testSuite: string;
    }>;
  };
  sync?: {
    feeds?: Array<{
      feedTypeId: string;
      label: string;
      importUrl: string;
      schedule?: string;
      fieldMappings?: Record<string, string>;
    }>;
    webhooks?: Array<{
      id: string;
      path: string;
      events: Array<'create' | 'update' | 'delete'>;
      targetEntity: string;
      authentication?: {
        type: string;
        header?: string;
      };
    }>;
    conflictResolution?: {
      strategy?: 'last_write_wins' | 'server_wins' | 'client_wins' | 'manual';
      notifyOnConflict?: boolean;
    };
  };
  relationships?: {
    dependsOn?: Array<{
      prd: string;
      reason: string;
      waitForCompletion?: boolean;
    }>;
    dependedOnBy?: Array<{
      prd: string;
      features?: string[];
    }>;
    relatedTo?: Array<{
      prd: string;
      relationship: string;
    }>;
    entityRelationships?: Record<string, Array<{
      targetType: string;
      relationship: string;
      cardinality: 'one_to_one' | 'one_to_many' | 'many_to_one' | 'many_to_many';
    }>>;
  };
  config?: Partial<Config>;
}

export class PrdConfigParser {
  private debug: boolean;

  constructor(debug: boolean = false) {
    this.debug = debug;
  }

  /**
   * Extract configuration overlay and metadata from PRD file
   * Tries YAML frontmatter first, then HTML comments, then JS blocks
   */
  async parsePrdConfig(prdPath: string): Promise<Partial<Config> | null> {
    try {
      const content = await fs.readFile(prdPath, 'utf-8');

      // Try YAML frontmatter first (recommended format)
      const frontmatter = this.parseFrontmatter(content);
      if (frontmatter && frontmatter.config) {
        if (this.debug) {
          logger.debug('[PrdConfigParser] Found YAML frontmatter config');
        }
        return frontmatter.config;
      }

      // Try HTML comment metadata (legacy format)
      const htmlMetadata = this.parseHtmlCommentMetadata(content);
      if (htmlMetadata && htmlMetadata.config) {
        if (this.debug) {
          logger.debug('[PrdConfigParser] Found HTML comment metadata');
        }
        return htmlMetadata.config;
      }

      // Try JS config blocks (current format)
      const configSection = this.extractConfigSection(content);
      if (configSection) {
        if (this.debug) {
          logger.debug('[PrdConfigParser] Found JS config block');
        }
        return this.parseConfigObject(configSection);
      }

      if (this.debug) {
        logger.debug('[PrdConfigParser] No config section found in PRD');
      }
      return null;
    } catch (error) {
      logger.warn(`[PrdConfigParser] Failed to parse PRD config: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Parse PRD metadata (YAML frontmatter or HTML comments)
   */
  async parsePrdMetadata(prdPath: string): Promise<PrdMetadata | null> {
    try {
      const content = await fs.readFile(prdPath, 'utf-8');

      // Try YAML frontmatter first
      const frontmatter = this.parseFrontmatter(content);
      if (frontmatter) {
        return frontmatter;
      }

      // Try HTML comments as fallback
      return this.parseHtmlCommentMetadata(content);
    } catch (error) {
      logger.warn(`[PrdConfigParser] Failed to parse PRD metadata: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Parse YAML frontmatter from PRD
   * Frontmatter format: ---\n...yaml...\n---
   */
  private parseFrontmatter(content: string): PrdMetadata | null {
    const frontmatterPattern = /^---\s*\n([\s\S]*?)\n---\s*\n/m;
    const match = content.match(frontmatterPattern);

    if (!match) {
      return null;
    }

    try {
      const parsed = yamlParse(match[1]);

      // Extract config overlay if present
      let configOverlay: Partial<Config> | undefined;
      if (parsed.config) {
        configOverlay = parsed.config;
        delete parsed.config; // Remove from metadata
      }

      // Convert metadata to expected format
      const metadata: PrdMetadata = {
        ...parsed,
      };

      if (configOverlay) {
        metadata.config = configOverlay;
      }

      return metadata;
    } catch (error) {
      if (this.debug) {
        logger.debug(`[PrdConfigParser] Failed to parse YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    }
  }

  /**
   * Parse HTML comment metadata (legacy format)
   * Format: <!-- DEV-LOOP METADATA -->\n<!--\nkey: value\n-->
   */
  private parseHtmlCommentMetadata(content: string): PrdMetadata | null {
    const commentPattern = /<!--\s*DEV-LOOP\s+METADATA\s*-->[\s\S]*?<!--\s*([\s\S]*?)\s*-->/;
    const match = content.match(commentPattern);

    if (!match) {
      return null;
    }

    try {
      const metadataText = match[1];
      const lines = metadataText.split('\n');
      const metadata: any = {};

      for (const line of lines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim();
          let value: any = line.substring(colonIndex + 1).trim();

          // Handle arrays (e.g., depends_on: [item1, item2])
          if (value.startsWith('[') && value.endsWith(']')) {
            value = value.slice(1, -1).split(',').map((v: string) => v.trim().replace(/^["']|["']$/g, ''));
          } else if (value === 'true' || value === 'false') {
            value = value === 'true';
          } else if (!isNaN(Number(value))) {
            value = Number(value);
          }

          // Map legacy keys to new structure
          if (key === 'prd_id') {
            metadata.prd = { ...metadata.prd, id: value } as any;
          } else if (key === 'version') {
            metadata.prd = { ...metadata.prd, version: value } as any;
          } else if (key === 'status') {
            metadata.prd = { ...metadata.prd, status: value } as any;
          } else if (key === 'test_directory') {
            metadata.testing = { ...metadata.testing, directory: value } as any;
          } else if (key === 'depends_on') {
            metadata.dependencies = { ...metadata.dependencies, prds: value } as any;
          } else {
            metadata[key] = value;
          }
        }
      }

      return Object.keys(metadata).length > 0 ? metadata : null;
    } catch (error) {
      if (this.debug) {
        logger.debug(`[PrdConfigParser] Failed to parse HTML comment metadata: ${error instanceof Error ? error.message : String(error)}`);
      }
      return null;
    }
  }

  /**
   * Extract JavaScript code block from "Dev-Loop Configuration" section
   * Fixed regex to correctly capture content until next same-level header
   */
  private extractConfigSection(content: string): string | null {
    // Look for "## Dev-Loop Configuration" or similar section headers
    // Match until the next same-level (##) header, markdown separator (---), or end of file
    // Fixed: Use non-greedy match and ensure we capture until next ## header or end of file
    const sectionPattern = /^##\s+Dev-Loop\s+Configuration[^\n]*\n([\s\S]+?)(?=^##\s|^---\s*$|$(?![\s\S]))/m;
    const match = content.match(sectionPattern);

    if (!match || !match[1]) {
      return null;
    }

    const sectionContent = match[1].trim();

    // Extract JavaScript code blocks - handle both ```javascript and ```js
    // Also handle multiline code blocks properly
    const jsBlockPattern = /```(?:javascript|js)\s*\n([\s\S]*?)```/g;
    const codeBlocks: string[] = [];
    let blockMatch;

    while ((blockMatch = jsBlockPattern.exec(sectionContent)) !== null) {
      if (blockMatch[1]) {
        codeBlocks.push(blockMatch[1].trim());
      }
    }

    if (codeBlocks.length === 0) {
      // Also try without language tag (plain ```)
      const plainBlockPattern = /```\s*\n([\s\S]*?)```/g;
      while ((blockMatch = plainBlockPattern.exec(sectionContent)) !== null) {
        if (blockMatch[1]) {
          codeBlocks.push(blockMatch[1].trim());
        }
      }
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
