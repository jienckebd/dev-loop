/**
 * Prompt Selector
 *
 * Selects appropriate AI prompts based on framework and feature types.
 * Framework and feature-type aware prompt selection.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { FrameworkPlugin } from '../../frameworks';
import { FeatureType } from '../../core/analysis/feature-type-detector';
import { BuildMode } from '../../core/conversation/types';
import { logger } from '../../core/utils/logger';

/**
 * Prompt Template Path
 */
export interface PromptTemplatePath {
  path: string;
  exists: boolean;
  content?: string;
}

/**
 * Prompt Selection Criteria
 */
export interface PromptSelectionCriteria {
  mode: BuildMode;
  framework?: string;
  featureTypes?: FeatureType[];
  phase?: string; // e.g., 'schema-enhancement', 'test-planning', 'feature-enhancement'
  iteration?: number;
}

/**
 * Selected Prompt Templates
 */
export interface SelectedPrompts {
  base: PromptTemplatePath;
  framework?: PromptTemplatePath;
  featureType?: PromptTemplatePath[];
  phase?: PromptTemplatePath;
  generic?: PromptTemplatePath[];
}

/**
 * Prompt Selector Configuration
 */
export interface PromptSelectorConfig {
  promptsRoot: string; // Root directory for prompt templates
  framework?: FrameworkPlugin;
  debug?: boolean;
}

/**
 * Selects appropriate prompts based on framework and feature types
 */
export class PromptSelector {
  private config: PromptSelectorConfig & { promptsRoot: string; debug: boolean };
  private promptsRoot: string;
  private framework?: FrameworkPlugin;
  private debug: boolean;

  constructor(config: PromptSelectorConfig) {
    this.config = {
      promptsRoot:
        config.promptsRoot || path.join(__dirname, '../../core/prompts'),
      framework: config.framework, // Optional
      debug: config.debug || false,
    };
    this.promptsRoot = path.resolve(this.config.promptsRoot);
    this.framework = config.framework;
    this.debug = this.config.debug;
  }

  /**
   * Select prompts based on criteria
   */
  async selectPrompts(criteria: PromptSelectionCriteria): Promise<SelectedPrompts> {
    logger.debug(
      `[PromptSelector] Selecting prompts for mode: ${criteria.mode}, framework: ${criteria.framework}, featureTypes: ${criteria.featureTypes?.join(', ')}`
    );

    const selected: SelectedPrompts = {
      base: await this.selectBasePrompt(criteria.mode),
    };

    // Select framework-specific prompt
    if (this.framework || criteria.framework) {
      selected.framework = await this.selectFrameworkPrompt(
        criteria.framework || this.framework?.name,
        criteria.mode,
        criteria.phase
      );
    }

    // Select feature-type-specific prompts
    if (criteria.featureTypes && criteria.featureTypes.length > 0) {
      selected.featureType = await Promise.all(
        criteria.featureTypes.map(type =>
          this.selectFeatureTypePrompt(type, criteria.mode, criteria.phase)
        )
      );
    }

    // Select phase-specific prompt
    if (criteria.phase) {
      selected.phase = await this.selectPhasePrompt(
        criteria.mode,
        criteria.phase,
        criteria.iteration
      );
    }

    // Select generic prompts as fallback
    selected.generic = await this.selectGenericPrompts(criteria.mode, criteria.phase);

    return selected;
  }

  /**
   * Select base prompt for mode
   */
  private async selectBasePrompt(mode: BuildMode): Promise<PromptTemplatePath> {
    const basePaths = [
      path.join(this.promptsRoot, 'shared', `${mode}-base.md`),
      path.join(this.promptsRoot, 'shared', 'base.md'),
      path.join(this.promptsRoot, 'generic', `${mode}.md`),
    ];

    for (const promptPath of basePaths) {
      const exists = await fs.pathExists(promptPath);
      if (exists) {
        return {
          path: promptPath,
          exists: true,
          content: await fs.readFile(promptPath, 'utf-8').catch(() => undefined),
        };
      }
    }

    // Return non-existent path (will use default prompt)
    return {
      path: basePaths[0],
      exists: false,
    };
  }

  /**
   * Select framework-specific prompt
   */
  private async selectFrameworkPrompt(
    frameworkName?: string,
    mode?: BuildMode,
    phase?: string
  ): Promise<PromptTemplatePath> {
    if (!frameworkName) {
      return { path: '', exists: false };
    }

    const frameworkPaths = [
      phase
        ? path.join(this.promptsRoot, 'frameworks', frameworkName, `${mode}-${phase}.md`)
        : undefined,
      phase
        ? path.join(this.promptsRoot, 'frameworks', frameworkName, `${phase}.md`)
        : undefined,
      mode
        ? path.join(this.promptsRoot, 'frameworks', frameworkName, `${mode}.md`)
        : undefined,
      path.join(this.promptsRoot, 'frameworks', frameworkName, 'base.md'),
    ].filter((p): p is string => p !== undefined);

    for (const promptPath of frameworkPaths) {
      const exists = await fs.pathExists(promptPath);
      if (exists) {
        return {
          path: promptPath,
          exists: true,
          content: await fs.readFile(promptPath, 'utf-8').catch(() => undefined),
        };
      }
    }

    return { path: frameworkPaths[0] || '', exists: false };
  }

  /**
   * Select feature-type-specific prompt
   */
  private async selectFeatureTypePrompt(
    featureType: FeatureType,
    mode?: BuildMode,
    phase?: string
  ): Promise<PromptTemplatePath> {
    const featureTypePaths = [
      phase && mode
        ? path.join(
            this.promptsRoot,
            'frameworks',
            this.framework?.name || 'generic',
            'feature-types',
            `${featureType}-${mode}-${phase}.md`
          )
        : undefined,
      phase
        ? path.join(
            this.promptsRoot,
            'frameworks',
            this.framework?.name || 'generic',
            'feature-types',
            `${featureType}-${phase}.md`
          )
        : undefined,
      mode
        ? path.join(
            this.promptsRoot,
            'frameworks',
            this.framework?.name || 'generic',
            'feature-types',
            `${featureType}-${mode}.md`
          )
        : undefined,
      path.join(
        this.promptsRoot,
        'frameworks',
        this.framework?.name || 'generic',
        'feature-types',
        `${featureType}.md`
      ),
    ].filter((p): p is string => p !== undefined);

    for (const promptPath of featureTypePaths) {
      const exists = await fs.pathExists(promptPath);
      if (exists) {
        return {
          path: promptPath,
          exists: true,
          content: await fs.readFile(promptPath, 'utf-8').catch(() => undefined),
        };
      }
    }

    return { path: featureTypePaths[0] || '', exists: false };
  }

  /**
   * Select phase-specific prompt
   */
  private async selectPhasePrompt(
    mode: BuildMode,
    phase: string,
    iteration?: number
  ): Promise<PromptTemplatePath> {
    // Map use cases to directories
    const useCaseDirs: Record<string, string> = {
      'schema-enhancement': 'refinement',
      'test-planning': 'refinement',
      'feature-enhancement': 'refinement',
      'question-generation': 'creation',
      'follow-up-question-generation': 'creation',
      'prd-draft-generation': 'creation',
    };

    const useCaseDir = useCaseDirs[phase] || mode;

    const phasePaths = [
      iteration !== undefined
        ? path.join(this.promptsRoot, useCaseDir, phase, `iteration-${iteration}.md`)
        : undefined,
      path.join(this.promptsRoot, useCaseDir, `${phase}.md`), // Direct use case file (e.g., refinement/question-generation.md)
      path.join(this.promptsRoot, mode, phase, 'base.md'),
      path.join(this.promptsRoot, 'shared', phase, 'base.md'),
    ].filter((p): p is string => p !== undefined);

    for (const promptPath of phasePaths) {
      const exists = await fs.pathExists(promptPath);
      if (exists) {
        return {
          path: promptPath,
          exists: true,
          content: await fs.readFile(promptPath, 'utf-8').catch(() => undefined),
        };
      }
    }

    return { path: phasePaths[0] || '', exists: false };
  }

  /**
   * Select generic prompts as fallback
   */
  private async selectGenericPrompts(
    mode?: BuildMode,
    phase?: string
  ): Promise<PromptTemplatePath[]> {
    const genericPrompts: PromptTemplatePath[] = [];
    const genericDir = path.join(this.promptsRoot, 'generic');

    if (!(await fs.pathExists(genericDir))) {
      return genericPrompts;
    }

    try {
      const files = await fs.readdir(genericDir);
      const relevantFiles = files.filter(
        file =>
          file.endsWith('.md') &&
          (!mode || file.includes(mode) || !file.includes('-')) &&
          (!phase || file.includes(phase) || !file.includes('-'))
      );

      for (const file of relevantFiles.slice(0, 10)) {
        // Limit to 10 generic prompts
        const promptPath = path.join(genericDir, file);
        const exists = await fs.pathExists(promptPath);
        if (exists) {
          genericPrompts.push({
            path: promptPath,
            exists: true,
            content: await fs.readFile(promptPath, 'utf-8').catch(() => undefined),
          });
        }
      }
    } catch (error) {
      logger.warn(`[PromptSelector] Failed to read generic prompts: ${error}`);
    }

    return genericPrompts;
  }

  /**
   * Get prompt content (reads from disk if not already loaded)
   */
  async getPromptContent(promptPath: PromptTemplatePath): Promise<string> {
    if (promptPath.content) {
      return promptPath.content;
    }

    if (!promptPath.exists) {
      return ''; // Return empty if prompt doesn't exist
    }

    try {
      return await fs.readFile(promptPath.path, 'utf-8');
    } catch (error) {
      logger.warn(`[PromptSelector] Failed to read prompt ${promptPath.path}: ${error}`);
      return '';
    }
  }

  /**
   * Combine multiple prompts into a single prompt
   */
  async combinePrompts(prompts: SelectedPrompts): Promise<string> {
    const parts: string[] = [];

    // Base prompt first
    if (prompts.base.exists) {
      const baseContent = await this.getPromptContent(prompts.base);
      if (baseContent) {
        parts.push(`# Base Prompt\n\n${baseContent}`);
      }
    }

    // Framework-specific prompt
    if (prompts.framework?.exists) {
      const frameworkContent = await this.getPromptContent(prompts.framework);
      if (frameworkContent) {
        parts.push(`# Framework-Specific Guidance\n\n${frameworkContent}`);
      }
    }

    // Feature-type-specific prompts
    if (prompts.featureType) {
      for (const featurePrompt of prompts.featureType) {
        if (featurePrompt.exists) {
          const featureContent = await this.getPromptContent(featurePrompt);
          if (featureContent) {
            parts.push(`# Feature-Type Guidance\n\n${featureContent}`);
          }
        }
      }
    }

    // Phase-specific prompt
    if (prompts.phase?.exists) {
      const phaseContent = await this.getPromptContent(prompts.phase);
      if (phaseContent) {
        parts.push(`# Phase-Specific Guidance\n\n${phaseContent}`);
      }
    }

    // Generic prompts as fallback/additional guidance
    if (prompts.generic && prompts.generic.length > 0) {
      for (const genericPrompt of prompts.generic.slice(0, 3)) {
        // Limit to 3 generic prompts
        if (genericPrompt.exists) {
          const genericContent = await this.getPromptContent(genericPrompt);
          if (genericContent) {
            parts.push(`# Additional Guidance\n\n${genericContent}`);
          }
        }
      }
    }

    return parts.join('\n\n---\n\n');
  }

  /**
   * Get prompt for a specific use case
   */
  async getPromptForUseCase(
    useCase: 'schema-enhancement' | 'test-planning' | 'feature-enhancement' | 'question-generation' | 'prd-draft-generation' | 'follow-up-question-generation',
    criteria: Omit<PromptSelectionCriteria, 'phase'>
  ): Promise<string> {
    const prompts = await this.selectPrompts({
      ...criteria,
      phase: useCase,
    });

    return await this.combinePrompts(prompts);
  }
}
