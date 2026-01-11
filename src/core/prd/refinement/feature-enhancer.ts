/**
 * Feature Enhancer
 *
 * Generates dev-loop configuration enhancements:
 * - Error guidance patterns
 * - Context file patterns
 * - Log patterns
 * - Framework-specific config
 */

import * as path from 'path';
import { ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureType } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { FrameworkPlugin } from '../../../frameworks';
import { CodebaseInsight } from './codebase-insight-extractor';
import { Answer } from '../../conversation/types';
import { logger } from '../../utils/logger';

/**
 * Feature Enhancement Result
 */
export interface FeatureEnhancementResult {
  enhancements: FeatureEnhancement[];
  summary: string;
}

/**
 * Feature Enhancement
 */
export interface FeatureEnhancement {
  type: 'error-guidance' | 'context-file' | 'log-pattern' | 'framework-config';
  description: string;
  config: Record<string, any>; // Dev-loop config overlay
  priority: 'high' | 'medium' | 'low';
  framework?: string;
  featureTypes?: FeatureType[];
}

/**
 * Feature Enhancer Configuration
 */
export interface FeatureEnhancerConfig {
  projectRoot: string;
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  codebaseAnalysis: CodebaseAnalysisResult;
  promptSelector: PromptSelector;
  debug?: boolean;
}

/**
 * Enhances PRD with dev-loop feature configuration
 */
export class FeatureEnhancer {
  private config: FeatureEnhancerConfig;
  private debug: boolean;

  constructor(config: FeatureEnhancerConfig) {
    this.config = config;
    this.debug = config.debug || false;
  }

  /**
   * Enhance PRD with feature configurations
   */
  async enhanceFeatures(
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<FeatureEnhancementResult> {
    logger.debug(`[FeatureEnhancer] Enhancing PRD ${prd.prdId} with feature configurations`);

    const enhancements: FeatureEnhancement[] = [];

    // 1. Generate error guidance patterns
    const errorGuidance = await this.generateErrorGuidance(prd, context);
    if (errorGuidance) {
      enhancements.push(errorGuidance);
    }

    // 2. Generate context file patterns
    const contextFiles = await this.generateContextFiles(prd, context);
    if (contextFiles) {
      enhancements.push(contextFiles);
    }

    // 3. Generate log patterns
    const logPatterns = await this.generateLogPatterns(prd, context);
    if (logPatterns) {
      enhancements.push(logPatterns);
    }

    // 4. Generate framework-specific config
    const frameworkConfig = await this.generateFrameworkConfig(prd, context);
    if (frameworkConfig) {
      enhancements.push(frameworkConfig);
    }

    // Generate summary
    const summary = this.generateSummary(enhancements);

    return {
      enhancements,
      summary,
    };
  }

  /**
   * Enhance features with context from user answers
   */
  async enhanceFeaturesWithContext(
    prd: ParsedPlanningDoc,
    answers: Map<string, any>,
    codebaseAnalysis: CodebaseAnalysisResult,
    insights: CodebaseInsight[] = [],
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<FeatureEnhancementResult> {
    logger.debug(`[FeatureEnhancer] Enhancing features with context from answers`);

    const enhancements: FeatureEnhancement[] = [];

    // Check what types of enhancements user wants
    let enhancementTypes: Array<'error-guidance' | 'context-file' | 'log-pattern' | 'framework-config'> = [
      'error-guidance',
      'context-file',
      'log-pattern',
      'framework-config',
    ];

    if (answers.has('feature-enhancement-types')) {
      const preference = answers.get('feature-enhancement-types');
      if (typeof preference === 'string') {
        if (preference.includes('Error guidance only')) {
          enhancementTypes = ['error-guidance'];
        } else if (preference.includes('Log patterns only')) {
          enhancementTypes = ['log-pattern'];
        } else if (preference.includes('Framework config only')) {
          enhancementTypes = ['framework-config'];
        }
        // 'All enhancement types' keeps the default array
      }
    }

    // Apply feature type preferences from insights
    const selectedInsights = Array.from(answers.entries())
      .filter(([key]) => key.startsWith('insight-'))
      .map(([key]) => key.replace('insight-', ''));

    // Generate enhancements based on preferences
    if (enhancementTypes.includes('error-guidance')) {
      const errorGuidance = await this.generateErrorGuidance(prd, context);
      if (errorGuidance) {
        enhancements.push(errorGuidance);
      }
    }

    if (enhancementTypes.includes('context-file')) {
      const contextFiles = await this.generateContextFiles(prd, context);
      if (contextFiles) {
        enhancements.push(contextFiles);
      }
    }

    if (enhancementTypes.includes('log-pattern')) {
      const logPatterns = await this.generateLogPatterns(prd, context);
      if (logPatterns) {
        enhancements.push(logPatterns);
      }
    }

    if (enhancementTypes.includes('framework-config')) {
      // Check if user wants framework config
      if (answers.has('feature-framework-config')) {
        const frameworkChoice = answers.get('feature-framework-config');
        if (typeof frameworkChoice === 'string' && frameworkChoice.includes('use')) {
          const frameworkConfig = await this.generateFrameworkConfig(prd, context);
          if (frameworkConfig) {
            enhancements.push(frameworkConfig);
          }
        }
      } else {
        // Default: generate framework config
        const frameworkConfig = await this.generateFrameworkConfig(prd, context);
        if (frameworkConfig) {
          enhancements.push(frameworkConfig);
        }
      }
    }

    // Apply insight preferences
    for (const insightId of selectedInsights) {
      const insight = insights.find(i => i.id === insightId);
      if (insight && insight.phase === 'feature') {
        // Apply insight recommendations
        if (insight.recommendation) {
          logger.debug(`[FeatureEnhancer] Applying insight: ${insight.recommendation}`);
        }
      }
    }

    // Generate summary
    const summary = this.generateSummary(enhancements);

    return {
      enhancements,
      summary,
    };
  }

  /**
   * Refine specific features
   */
  async refineSpecificFeatures(
    features: FeatureEnhancementResult,
    refineIds: string[],
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<FeatureEnhancementResult> {
    logger.debug(`[FeatureEnhancer] Refining ${refineIds.length} specific feature(s): ${refineIds.join(', ')}`);

    const refinedEnhancements: FeatureEnhancement[] = [];
    const enhancementsToRefine = features.enhancements.filter(
      e => refineIds.includes(e.type) || refineIds.some(id => e.type.includes(id))
    );

    for (const enhancement of enhancementsToRefine) {
      try {
        // Refine enhancement based on codebase analysis
        const refined = await this.refineEnhancementWithCodebase(enhancement, codebaseAnalysis);
        refinedEnhancements.push(refined);
      } catch (error) {
        logger.warn(`[FeatureEnhancer] Failed to refine enhancement ${enhancement.type}: ${error}`);
        refinedEnhancements.push(enhancement); // Keep original if refinement fails
      }
    }

    // Keep enhancements that weren't refined
    const unchangedEnhancements = features.enhancements.filter(e => !enhancementsToRefine.includes(e));
    const allEnhancements = [...unchangedEnhancements, ...refinedEnhancements];

    return {
      enhancements: allEnhancements,
      summary: `Refined ${refinedEnhancements.length} feature enhancement(s): ${refinedEnhancements.map(e => e.type).join(', ')}`,
    };
  }

  /**
   * Refine an enhancement using codebase analysis
   */
  private async refineEnhancementWithCodebase(
    enhancement: FeatureEnhancement,
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<FeatureEnhancement> {
    // For now, enhance based on codebase patterns
    // TODO: Use AI to refine enhancement config based on codebase patterns

    if (enhancement.type === 'framework-config' && codebaseAnalysis.frameworkPlugin) {
      // Enhance framework config with more specific patterns
      const enhancedConfig = {
        ...enhancement.config,
        framework: {
          ...enhancement.config.framework,
          searchDirs: codebaseAnalysis.frameworkPlugin.getSearchDirs(),
          excludeDirs: codebaseAnalysis.frameworkPlugin.getExcludeDirs(),
        },
      };

      return {
        ...enhancement,
        config: enhancedConfig,
      };
    }

    // For other types, return as-is (could be enhanced further)
    return enhancement;
  }

  /**
   * Generate error guidance patterns
   */
  private async generateErrorGuidance(
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<FeatureEnhancement | null> {
    const frameworkPlugin = this.config.codebaseAnalysis.frameworkPlugin;

    // Build error guidance config from framework and codebase analysis
    const errorGuidance: Record<string, string> = {};

    // Get framework-specific error patterns
    if (frameworkPlugin) {
      const frameworkPatterns = frameworkPlugin.getErrorPatterns();
      Object.assign(errorGuidance, frameworkPatterns);
    }

    // Analyze PRD requirements for common error scenarios
    for (const phase of prd.phases) {
      if (!phase.tasks) continue;

      for (const task of phase.tasks) {
        const taskText = `${task.title} ${task.description}`.toLowerCase();

        // Add error guidance based on task type
        if (taskText.includes('entity') || taskText.includes('model')) {
          errorGuidance['EntityNotFoundException'] = 'Check that the entity exists and is properly registered';
          errorGuidance['InvalidEntityType'] = 'Verify entity type configuration matches requirements';
        }

        if (taskText.includes('schema') || taskText.includes('config')) {
          errorGuidance['SchemaValidationError'] = 'Verify schema definition matches expected structure';
          errorGuidance['ConfigKeyNotFound'] = 'Check that config key exists in schema definitions';
        }

        if (taskText.includes('plugin')) {
          errorGuidance['PluginNotFoundException'] = 'Ensure plugin is properly registered and discoverable';
          errorGuidance['InvalidPluginDefinition'] = 'Verify plugin annotation/definition matches framework requirements';
        }

        if (taskText.includes('service') || taskText.includes('dependency')) {
          errorGuidance['ServiceNotFoundException'] = 'Check service registration in services.yml or equivalent';
          errorGuidance['CircularDependency'] = 'Review service dependencies for circular references';
        }

        if (taskText.includes('form')) {
          errorGuidance['FormValidationError'] = 'Check form field definitions and validation rules';
          errorGuidance['MissingRequiredField'] = 'Verify all required fields are present in form definition';
        }
      }
    }

    if (Object.keys(errorGuidance).length === 0) {
      return null;
    }

    return {
      type: 'error-guidance',
      description: 'Error pattern guidance for common error scenarios',
      config: {
        framework: {
          errorGuidance: errorGuidance,
        },
      },
      priority: 'high',
      framework: this.config.codebaseAnalysis.framework,
      featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
    };
  }

  /**
   * Generate context file patterns
   */
  private async generateContextFiles(
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<FeatureEnhancement | null> {
    const contextFiles: string[] = [];

    // Identify relevant files based on PRD requirements
    for (const phase of prd.phases) {
      if (!phase.tasks) continue;

      for (const task of phase.tasks) {
        if (task.files) {
          contextFiles.push(...task.files);
        }

        // Generate context file patterns based on task description
        const taskText = `${task.title} ${task.description}`.toLowerCase();
        const frameworkPlugin = this.config.codebaseAnalysis.frameworkPlugin;

        if (frameworkPlugin) {
          // Framework-specific context file patterns
          if (taskText.includes('entity') || taskText.includes('model')) {
            if (frameworkPlugin.name === 'drupal') {
              contextFiles.push(`docroot/modules/share/*/config/schema/*.schema.yml`);
              contextFiles.push(`docroot/modules/share/*/src/Entity/*.php`);
            } else if (frameworkPlugin.name === 'django') {
              contextFiles.push(`*/models.py`);
            }
          }

          if (taskText.includes('plugin')) {
            if (frameworkPlugin.name === 'drupal') {
              contextFiles.push(`docroot/modules/share/*/src/Plugin/**/*.php`);
            }
          }

          if (taskText.includes('service')) {
            if (frameworkPlugin.name === 'drupal') {
              contextFiles.push(`docroot/modules/share/*/*.services.yml`);
            }
          }

          if (taskText.includes('form')) {
            if (frameworkPlugin.name === 'drupal') {
              contextFiles.push(`docroot/modules/share/*/src/Form/*.php`);
            }
          }

          if (taskText.includes('schema') || taskText.includes('config')) {
            contextFiles.push(`config/schema/**/*.schema.yml`);
            contextFiles.push(`config/**/*.yml`);
          }
        }
      }
    }

    // Remove duplicates
    const uniqueContextFiles = Array.from(new Set(contextFiles));

    if (uniqueContextFiles.length === 0) {
      return null;
    }

    return {
      type: 'context-file',
      description: 'Context file patterns for AI code generation',
      config: {
        codebase: {
          contextFiles: uniqueContextFiles,
        },
      },
      priority: 'medium',
      framework: this.config.codebaseAnalysis.framework,
      featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
    };
  }

  /**
   * Generate log patterns
   */
  private async generateLogPatterns(
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<FeatureEnhancement | null> {
    const logPatterns: {
      error?: RegExp | string;
      warning?: RegExp | string;
      info?: RegExp | string;
    } = {};

    const frameworkPlugin = this.config.codebaseAnalysis.frameworkPlugin;

    // Framework-specific log patterns
    if (frameworkPlugin) {
      if (frameworkPlugin.name === 'drupal') {
        logPatterns.error = /Error|Exception|Fatal|CRITICAL|SEVERE/i;
        logPatterns.warning = /Warning|Deprecated|NOTICE|WARN/i;
        logPatterns.info = /Notice|Info|DEBUG|INFO/i;
      } else if (frameworkPlugin.name === 'django') {
        logPatterns.error = /ERROR|CRITICAL|Exception/i;
        logPatterns.warning = /WARNING|Deprecated/i;
        logPatterns.info = /INFO|DEBUG/i;
      } else {
        // Generic patterns
        logPatterns.error = /Error|Exception|Fatal|CRITICAL|SEVERE/i;
        logPatterns.warning = /Warning|Deprecated|NOTICE|WARN/i;
        logPatterns.info = /Notice|Info|DEBUG|INFO/i;
      }
    }

    if (Object.keys(logPatterns).length === 0) {
      return null;
    }

    return {
      type: 'log-pattern',
      description: 'Log patterns for error detection and analysis',
      config: {
        logs: {
          patterns: logPatterns,
        },
      },
      priority: 'medium',
      framework: this.config.codebaseAnalysis.framework,
      featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
    };
  }

  /**
   * Generate framework-specific config
   */
  private async generateFrameworkConfig(
    prd: ParsedPlanningDoc,
    context?: {
      conversationId?: string;
      iteration?: number;
    }
  ): Promise<FeatureEnhancement | null> {
    const frameworkPlugin = this.config.codebaseAnalysis.frameworkPlugin;

    if (!frameworkPlugin) {
      return null;
    }

    // Get framework default config
    const frameworkDefaultConfig = frameworkPlugin.getDefaultConfig();

    // Build framework-specific enhancement config
    const frameworkConfig: Record<string, any> = {
      framework: {
        type: frameworkPlugin.name,
      },
    };

    // Add framework-specific search directories
    if (frameworkDefaultConfig.searchDirs) {
      frameworkConfig.codebase = {
        searchDirs: frameworkDefaultConfig.searchDirs,
      };
    }

    // Add framework-specific exclude directories
    if (frameworkDefaultConfig.excludeDirs) {
      frameworkConfig.codebase = {
        ...frameworkConfig.codebase,
        excludeDirs: frameworkDefaultConfig.excludeDirs,
      };
    }

    // Add cache command if available
    if (frameworkDefaultConfig.cacheCommand) {
      frameworkConfig.framework = {
        ...frameworkConfig.framework,
        cacheCommand: frameworkDefaultConfig.cacheCommand,
      };
    }

    // Add test runner config
    if (prd.testing) {
      frameworkConfig.testing = {
        runner: frameworkDefaultConfig.testRunner || prd.testing.runner || 'playwright',
        command: prd.testing.command || frameworkDefaultConfig.testCommand,
        directory: prd.testing.directory || 'tests',
      };
    }

    return {
      type: 'framework-config',
      description: `Framework-specific configuration for ${frameworkPlugin.name}`,
      config: frameworkConfig,
      priority: 'high',
      framework: frameworkPlugin.name,
      featureTypes: this.config.codebaseAnalysis.featureTypes as FeatureType[],
    };
  }

  /**
   * Generate summary
   */
  private generateSummary(enhancements: FeatureEnhancement[]): string {
    const parts: string[] = [];

    parts.push(`Generated ${enhancements.length} feature enhancement(s).`);

    // Group by type
    const byType = new Map<FeatureEnhancement['type'], number>();
    for (const enhancement of enhancements) {
      byType.set(enhancement.type, (byType.get(enhancement.type) || 0) + 1);
    }

    parts.push('\nEnhancements by type:');
    for (const [type, count] of byType.entries()) {
      parts.push(`- ${count} ${type} enhancement(s)`);
    }

    // List enhancements
    parts.push('\nEnhancements:');
    for (const enhancement of enhancements) {
      parts.push(`- [${enhancement.priority}] ${enhancement.type}: ${enhancement.description}`);
    }

    return parts.join('\n');
  }
}
