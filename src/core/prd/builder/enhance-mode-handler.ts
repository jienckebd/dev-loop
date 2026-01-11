/**
 * Enhance Mode Handler
 *
 * Handles enhance mode workflow (enhance existing PRD set).
 * Integrates PrdSetDiscovery, GapAnalyzer, PrdSetEnhancer, refinement services, conversation, and progress.
 */

import * as path from 'path';
import { DiscoveredPrdSet, PrdSetDiscovery } from '../set/discovery';
import { GapAnalyzer, GapAnalysisResult, Gap } from '../enhancement/gap-analyzer';
import { PrdSetEnhancer, EnhancementApplicationResult } from '../enhancement/prd-set-enhancer';
import { AIRefinementOrchestrator } from '../refinement/ai-refinement-orchestrator';
import { CodebaseAnalyzer, CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureTypeDetector } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
import { ConversationManager } from '../../conversation/conversation-manager';
import { PRDBuildingProgressTracker } from '../../tracking/prd-building-progress-tracker';
import { InteractivePromptSystem } from './interactive-prompt-system';
import { PlanningDocParser } from '../parser/planning-doc-parser';
import { PrdSetGenerator } from '../set/generator';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { Config } from '../../../config/schema/core';
import { BuildMode } from '../../conversation/types';
import { logger } from '../../utils/logger';
import { PatternEntry, ObservationEntry, TestResultExecution } from '../learning/types';
import { ExecutabilityValidator, ExecutabilityValidationResult } from '../refinement/executability-validator';

/**
 * Enhance Mode Options
 */
export interface EnhanceModeOptions {
  outputDir?: string;
  gapsOnly?: boolean; // Only detect gaps, don't enhance
  enhanceTypes?: Array<'schemas' | 'tests' | 'config' | 'all'>; // Specific enhancement types
  preserveExisting?: boolean; // Don't modify existing valid configurations
  autoApprove?: boolean;
  skipAnalysis?: boolean;
  maxIterations?: number;
  interactive?: boolean;
  debug?: boolean;
  // Learning data from JSON files (for context-aware refinement)
  patterns?: PatternEntry[];
  observations?: ObservationEntry[];
  testResults?: TestResultExecution[];
}

/**
 * Enhance Mode Result
 */
export interface EnhanceModeResult {
  prdSetPath: string;
  gaps: GapAnalysisResult;
  enhancements?: EnhancementApplicationResult;
  executable: boolean;
  summary: string;
}

/**
 * Handles enhance mode workflow
 */
export class EnhanceModeHandler {
  private prdDiscovery: PrdSetDiscovery;
  private gapAnalyzer: GapAnalyzer;
  private prdSetEnhancer: PrdSetEnhancer;
  private refinementOrchestrator?: AIRefinementOrchestrator;
  private codebaseAnalyzer: CodebaseAnalyzer;
  private featureTypeDetector: FeatureTypeDetector;
  private promptSelector: PromptSelector;
  private prdSetGenerator: PrdSetGenerator;
  private conversationManager?: ConversationManager;
  private progressTracker?: PRDBuildingProgressTracker;
  private interactivePrompts?: InteractivePromptSystem;
  private aiProvider: AIProvider;
  private aiProviderConfig: AIProviderConfig;
  private debug: boolean;

  private projectConfig?: Config;

  constructor(config: {
    projectRoot: string;
    projectConfig?: Config;
    aiProvider: AIProvider;
    aiProviderConfig: AIProviderConfig;
    conversationManager?: ConversationManager;
    progressTracker?: PRDBuildingProgressTracker;
    interactivePrompts?: InteractivePromptSystem;
    debug?: boolean;
  }) {
    this.debug = config.debug || false;
    this.projectConfig = config.projectConfig;
    this.aiProvider = config.aiProvider;
    this.aiProviderConfig = config.aiProviderConfig;
    this.conversationManager = config.conversationManager;
    this.progressTracker = config.progressTracker;
    this.interactivePrompts = config.interactivePrompts;

    // Initialize services
    this.prdDiscovery = new PrdSetDiscovery(this.debug);
    this.prdSetGenerator = new PrdSetGenerator(this.debug);

    // Initialize shared analysis services with full project config
    this.codebaseAnalyzer = new CodebaseAnalyzer({
      projectRoot: config.projectRoot,
      projectConfig: this.projectConfig ? {
        framework: this.projectConfig.framework,
        codebase: this.projectConfig.codebase,
        testGeneration: this.projectConfig.testGeneration,
      } : undefined,
      debug: this.debug,
    });

    this.featureTypeDetector = new FeatureTypeDetector({
      projectRoot: config.projectRoot,
      debug: this.debug,
    });

    this.promptSelector = new PromptSelector({
      promptsRoot: path.join(__dirname, '../../prompts'),
      debug: this.debug,
    });

    // Initialize gap analyzer (will be configured with analysis after codebase analysis)
    this.gapAnalyzer = new GapAnalyzer({
      projectRoot: config.projectRoot,
      codebaseAnalysis: {
        projectRoot: config.projectRoot,
        relevantFiles: [],
        fileContexts: new Map(),
        codebaseContext: '',
      }, // Temporary
      featureTypeDetector: this.featureTypeDetector,
      debug: this.debug,
    });

    // Initialize PRD set enhancer
    this.prdSetEnhancer = new PrdSetEnhancer({
      preserveExisting: true, // Default to preserving existing
      debug: this.debug,
    });

    // Refinement orchestrator will be initialized after codebase analysis if needed
    this.refinementOrchestrator = undefined;
    this.aiProvider = config.aiProvider;
    this.aiProviderConfig = config.aiProviderConfig;
  }

  /**
   * Enhance existing PRD set
   */
  async enhance(
    prdSetPath: string,
    options: EnhanceModeOptions = {}
  ): Promise<EnhanceModeResult> {
    logger.debug(`[EnhanceModeHandler] Enhancing PRD set: ${prdSetPath}`);

    const prdSetPathResolved = path.resolve(process.cwd(), prdSetPath);

    // 1. Discover existing PRD set
    logger.debug('[EnhanceModeHandler] Discovering existing PRD set');
    const discoveredSet = await this.prdDiscovery.discoverPrdSet(prdSetPathResolved);

    // 2. Analyze codebase (if not skipped)
    let codebaseAnalysis: CodebaseAnalysisResult;
    if (options.skipAnalysis) {
      codebaseAnalysis = {
        projectRoot: process.cwd(),
        relevantFiles: [],
        fileContexts: new Map(),
        codebaseContext: 'Analysis skipped',
        framework: undefined,
        featureTypes: [],
      };
    } else {
      logger.debug('[EnhanceModeHandler] Analyzing codebase');
      codebaseAnalysis = await this.codebaseAnalyzer.analyze('enhance', discoveredSet.setId);
    }

    // 3. Detect feature types
    logger.debug('[EnhanceModeHandler] Detecting feature types');
    const featureTypeResult = await this.featureTypeDetector.detectFeatureTypes(codebaseAnalysis);
    codebaseAnalysis.featureTypes = featureTypeResult.featureTypes;

    // Update gap analyzer with codebase analysis
    this.gapAnalyzer = new GapAnalyzer({
      projectRoot: codebaseAnalysis.projectRoot,
      codebaseAnalysis,
      featureTypeDetector: this.featureTypeDetector,
      debug: this.debug,
    });

    // 4. Detect gaps in PRD set
    logger.debug('[EnhanceModeHandler] Detecting gaps in PRD set');
    const gaps = await this.gapAnalyzer.analyzeGaps(discoveredSet);

    // If gaps-only mode, return early
    if (options.gapsOnly) {
      return {
        prdSetPath: prdSetPathResolved,
        gaps,
        executable: false,
        summary: `Gap analysis complete. Found ${gaps.totalGaps} gap(s): ${gaps.criticalGaps} critical, ${gaps.highPriorityGaps - gaps.criticalGaps} high priority.`,
      };
    }

    // 5. Create conversation for tracking
    let conversationId: string | undefined;
    if (this.conversationManager) {
      conversationId = await this.conversationManager.createConversation('enhance', {
        initialPrompt: `Enhance PRD set: ${discoveredSet.setId}`,
        featureTypes: featureTypeResult.featureTypes,
        framework: codebaseAnalysis.framework,
        codebaseContext: codebaseAnalysis.codebaseContext,
      });
      logger.debug(`[EnhanceModeHandler] Created conversation: ${conversationId}`);
    }

    // 6. Filter gaps by enhanceTypes if specified
    let gapsToEnhance = gaps.gaps;
    if (options.enhanceTypes && !options.enhanceTypes.includes('all')) {
      const enhanceTypeMap: Record<'schemas' | 'tests' | 'config', string> = {
        schemas: 'missing-schema',
        tests: 'missing-test',
        config: 'missing-config',
      };
      // Filter out 'all' and narrow type to valid keys
      const validTypes = options.enhanceTypes.filter((type): type is 'schemas' | 'tests' | 'config' => 
        type !== 'all' && type in enhanceTypeMap
      );
      const allowedTypes = new Set(
        validTypes.map(type => enhanceTypeMap[type])
      );
      gapsToEnhance = gaps.gaps.filter(gap => allowedTypes.has(gap.type));
    }

    // 7. Generate enhancements for gaps
    logger.debug('[EnhanceModeHandler] Generating enhancements for gaps');

    // Generate enhancements using refinement orchestrator
    if (gapsToEnhance.length > 0) {
      // Initialize refinement orchestrator with codebase analysis, project config, and learning data
      this.refinementOrchestrator = new AIRefinementOrchestrator({
        projectRoot: codebaseAnalysis.projectRoot,
        aiProvider: this.aiProvider,
        aiProviderConfig: this.aiProviderConfig,
        codebaseAnalysis,
        promptSelector: this.promptSelector,
        projectConfig: this.projectConfig,
        conversationManager: this.conversationManager,
        progressTracker: this.progressTracker,
        interactivePrompts: this.interactivePrompts,
        // Pass loaded learning data for context-aware refinement
        patterns: options.patterns || [],
        observations: options.observations || [],
        testResults: options.testResults || [],
        debug: this.debug,
      });

      // Load PRD document for refinement
      const planningParser = new PlanningDocParser(this.debug);
      let parsedDoc;
      try {
        parsedDoc = await planningParser.parsePrdSet(discoveredSet.directory);
      } catch (error) {
        logger.warn(`[EnhanceModeHandler] Failed to parse PRD set: ${error}`);
        parsedDoc = {
          prdId: discoveredSet.setId,
          version: '1.0.0',
          status: 'ready',
          title: discoveredSet.setId,
          phases: [],
          rawContent: '',
        };
      }

      // Refine PRD to generate enhancements
      if (parsedDoc && this.refinementOrchestrator) {
        const refinement = await this.refinementOrchestrator.refine(
          parsedDoc,
          {
            conversationId: conversationId || '',
            mode: 'enhance',
            prd: parsedDoc,
            codebaseAnalysis,
            featureTypes: featureTypeResult.featureTypes,
          },
          {
            maxIterations: options.maxIterations || 3,
            autoApprove: options.autoApprove || false,
          }
        );

        // Apply enhancements using PrdSetEnhancer
        const enhancementResult = await this.prdSetEnhancer.applyEnhancements(
          discoveredSet,
          gapsToEnhance,
          {
            schemas: refinement.schemas,
            tests: refinement.tests,
            features: refinement.features,
          }
        );

        // 8. Validate and auto-fix until executable
        const maxFixIterations = 5;
        let fixIteration = 0;
        let isExecutable = false;
        const fixesApplied: string[] = [];

        while (!isExecutable && fixIteration < maxFixIterations) {
          // Reload PRD set after enhancements
          const updatedPrdSet = await this.prdDiscovery.discoverPrdSet(prdSetPathResolved);
          
          // Validate executability
          const validator = new ExecutabilityValidator({ debug: this.debug });
          const validationResult = await validator.validateExecutability(updatedPrdSet);
          
          if (validationResult.executable && validationResult.score === 100) {
            isExecutable = true;
            break;
          }
          
          // Apply auto-fixes
          let fixApplied = false;
          
          // Fix ID pattern if mismatch detected
          if (this.needsIdPatternFix(validationResult)) {
            const fixed = await this.prdSetGenerator.fixIdPattern(prdSetPathResolved, discoveredSet.setId);
            if (fixed) {
              fixesApplied.push('ID pattern corrected to match task IDs');
              fixApplied = true;
              logger.debug(`[EnhanceModeHandler] Fixed ID pattern in PRD set`);
            }
          }
          
          // Fix testing config if needed
          if (this.needsTestingConfigFix(validationResult)) {
            const fixed = await this.prdSetGenerator.fixTestingConfig(prdSetPathResolved, this.projectConfig);
            if (fixed) {
              fixesApplied.push('Testing configuration updated from project config');
              fixApplied = true;
              logger.debug(`[EnhanceModeHandler] Fixed testing configuration in PRD set`);
            }
          }
          
          // If no fixes applied, break to avoid infinite loop
          if (!fixApplied) {
            logger.debug(`[EnhanceModeHandler] No auto-fixes available, stopping validation loop`);
            break;
          }
          
          fixIteration++;
        }

        // Update executable status
        const finalExecutable = isExecutable || (refinement.executable && gaps.criticalGaps === 0);

        // 9. Update conversation state
        if (this.conversationManager && conversationId) {
          await this.conversationManager.updateState(
            conversationId,
            finalExecutable ? 'complete' : 'refining'
          );
        }

        return {
          prdSetPath: prdSetPathResolved,
          gaps,
          enhancements: enhancementResult.success ? enhancementResult : undefined,
          executable: finalExecutable,
          summary: this.generateSummary(gaps, enhancementResult, options, fixesApplied),
        };
      }
    }

    // If no gaps to enhance, validate and auto-fix existing PRD set
    const maxFixIterations = 5;
    let fixIteration = 0;
    let isExecutable = false;
    const fixesApplied: string[] = [];

    while (!isExecutable && fixIteration < maxFixIterations) {
      // Validate executability
      const validator = new ExecutabilityValidator({ debug: this.debug });
      const validationResult = await validator.validateExecutability(discoveredSet);
      
      if (validationResult.executable && validationResult.score === 100) {
        isExecutable = true;
        break;
      }
      
      // Apply auto-fixes
      let fixApplied = false;
      
      // Fix ID pattern if mismatch detected
      if (this.needsIdPatternFix(validationResult)) {
        const fixed = await this.prdSetGenerator.fixIdPattern(prdSetPathResolved, discoveredSet.setId);
        if (fixed) {
          fixesApplied.push('ID pattern corrected to match task IDs');
          fixApplied = true;
          logger.debug(`[EnhanceModeHandler] Fixed ID pattern in PRD set`);
        }
      }
      
      // Fix testing config if needed
      if (this.needsTestingConfigFix(validationResult)) {
        const fixed = await this.prdSetGenerator.fixTestingConfig(prdSetPathResolved, this.projectConfig);
        if (fixed) {
          fixesApplied.push('Testing configuration updated from project config');
          fixApplied = true;
          logger.debug(`[EnhanceModeHandler] Fixed testing configuration in PRD set`);
        }
      }
      
      // If no fixes applied, break to avoid infinite loop
      if (!fixApplied) {
        logger.debug(`[EnhanceModeHandler] No auto-fixes available, stopping validation loop`);
        break;
      }
      
      fixIteration++;
    }

    // 8. Generate summary
    const summary = this.generateSummary(gaps, undefined, options, fixesApplied);

    // 9. Update conversation state
    if (this.conversationManager && conversationId) {
      await this.conversationManager.updateState(
        conversationId,
        'complete'
      );
    }

    return {
      prdSetPath: prdSetPathResolved,
      gaps,
      enhancements: undefined,
      executable: isExecutable || gaps.criticalGaps === 0,
      summary,
    };
  }

  /**
   * Check if validation result indicates ID pattern fix is needed
   */
  private needsIdPatternFix(validationResult: ExecutabilityValidationResult): boolean {
    // Check if errors mention ID pattern mismatch
    return validationResult.errors.some(e => 
      e.type === 'invalid-structure' && 
      (e.message.includes('ID pattern') || e.message.includes('task ID') || e.message.includes('idPattern'))
    );
  }

  /**
   * Check if validation result indicates testing config fix is needed
   */
  private needsTestingConfigFix(validationResult: ExecutabilityValidationResult): boolean {
    // Check if errors mention testing configuration
    return validationResult.errors.some(e => 
      e.type === 'invalid-config' && 
      (e.message.includes('testing') || e.message.includes('framework') || e.message.includes('runner'))
    ) || validationResult.warnings.some(w =>
      w.type === 'missing-optional' && 
      (w.message.includes('testing') || w.message.includes('framework') || w.message.includes('runner'))
    );
  }


  /**
   * Generate summary
   */
  private generateSummary(
    gaps: GapAnalysisResult,
    enhancementResult?: EnhancementApplicationResult,
    options?: EnhanceModeOptions,
    fixesApplied?: string[]
  ): string {
    const parts: string[] = [];

    parts.push(`PRD Set Enhancement Summary`);
    parts.push(`Total Gaps: ${gaps.totalGaps}`);
    parts.push(`  - ${gaps.criticalGaps} critical gap(s)`);
    parts.push(`  - ${gaps.highPriorityGaps - gaps.criticalGaps} high priority gap(s)`);
    parts.push('');

    if (enhancementResult && enhancementResult.success) {
      parts.push('Enhancements Applied:');
      parts.push(enhancementResult.summary);
      parts.push('');
    }

    if (fixesApplied && fixesApplied.length > 0) {
      parts.push('Auto-Fixes Applied:');
      fixesApplied.forEach((fix, index) => {
        parts.push(`  ${index + 1}. ${fix}`);
      });
      parts.push('');
    }

    if (options?.gapsOnly) {
      parts.push('Mode: Gaps detection only (no enhancements applied)');
    }

    return parts.join('\n');
  }
}
