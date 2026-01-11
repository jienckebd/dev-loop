/**
 * Convert Mode Handler
 *
 * Handles convert mode workflow (existing convert-planning-doc functionality).
 * Integrates PlanningDocParser, AIRefinementOrchestrator, ConversationManager, and ProgressTracker.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PlanningDocParser, ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { PrdSetGenerator } from '../set/generator';
import { AIRefinementOrchestrator, RefinementResult } from '../refinement/ai-refinement-orchestrator';
import { CodebaseAnalyzer, CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureTypeDetector } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../prompts/prompt-selector';
import { ConversationManager } from '../../conversation/conversation-manager';
import { PRDBuildingProgressTracker } from '../../tracking/prd-building-progress-tracker';
import { InteractivePromptSystem } from './interactive-prompt-system';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { Config } from '../../../config/schema/core';
import { logger } from '../../utils/logger';
import { PatternEntry, ObservationEntry, TestResultExecution } from '../learning/types';

/**
 * Convert Mode Options
 */
export interface ConvertModeOptions {
  outputDir?: string;
  productionDir?: string; // Production directory for subfolder structure
  setId?: string;
  autoApprove?: boolean;
  skipAnalysis?: boolean;
  maxIterations?: number;
  interactive?: boolean;
  debug?: boolean;
  validateOnly?: boolean;
  force?: boolean;
  // Learning data from JSON files (for context-aware refinement)
  patterns?: PatternEntry[];
  observations?: ObservationEntry[];
  testResults?: TestResultExecution[];
}

/**
 * Convert Mode Result
 */
export interface ConvertModeResult {
  prdSetPath: string;
  prd: ParsedPlanningDoc;
  refinement: RefinementResult;
  executable: boolean;
  summary: string;
}

/**
 * Handles convert mode workflow
 */
export class ConvertModeHandler {
  private planningParser: PlanningDocParser;
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
    this.planningParser = new PlanningDocParser(this.debug);
    this.prdSetGenerator = new PrdSetGenerator(this.debug);

    // Initialize shared analysis services with full project config (including framework and testGeneration)
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

    // Initialize refinement orchestrator (will be configured with analysis after codebase analysis)
    // This is a temporary instance - will be recreated after codebase analysis
    this.refinementOrchestrator = undefined;
  }

  /**
   * Convert planning document to PRD set
   */
  async convert(
    planningDocPath: string,
    options: ConvertModeOptions = {}
  ): Promise<ConvertModeResult> {
    logger.debug(`[ConvertModeHandler] Converting planning doc: ${planningDocPath}`);

    // 1. Parse planning document
    logger.debug('[ConvertModeHandler] Parsing planning document');
    const parsedDoc = await this.planningParser.parse(planningDocPath);

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
      logger.debug('[ConvertModeHandler] Analyzing codebase');
      codebaseAnalysis = await this.codebaseAnalyzer.analyze('convert', parsedDoc.title);
    }

    // 3. Detect feature types
    logger.debug('[ConvertModeHandler] Detecting feature types');
    const featureTypeResult = await this.featureTypeDetector.detectFeatureTypes(codebaseAnalysis);
    codebaseAnalysis.featureTypes = featureTypeResult.featureTypes;

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

    // 4. Create conversation for tracking
    let conversationId: string | undefined;
    if (this.conversationManager) {
      conversationId = await this.conversationManager.createConversation('convert', {
        initialPrompt: parsedDoc.title,
        featureTypes: featureTypeResult.featureTypes,
        framework: codebaseAnalysis.framework,
        codebaseContext: codebaseAnalysis.codebaseContext,
      });
      logger.debug(`[ConvertModeHandler] Created conversation: ${conversationId}`);
    }

    // 5. Refine PRD through iterative enhancements
    logger.debug('[ConvertModeHandler] Starting refinement iterations');
    const refinement = await this.refinementOrchestrator.refine(
      parsedDoc,
      {
        conversationId: conversationId || '',
        mode: 'convert',
        prd: parsedDoc,
        codebaseAnalysis,
        featureTypes: featureTypeResult.featureTypes,
      },
      {
        maxIterations: options.maxIterations || 5,
        autoApprove: options.autoApprove || false,
      }
    );

    // 6. Generate PRD set files
    logger.debug('[ConvertModeHandler] Generating PRD set files');
    const setId = options.setId || parsedDoc.prdId || this.generateSetIdFromPath(planningDocPath);
    const outputDir = options.outputDir || path.dirname(planningDocPath);
    const productionDir = options.productionDir || '.taskmaster/production';
    
    // If outputDir matches productionDir (default or configured), create subfolder for PRD set ID
    // Otherwise, use outputDir directly (legacy behavior)
    let prdSetDir: string;
    if (this.isProductionDir(outputDir, productionDir)) {
      // Create subfolder: {productionDir}/{setId}/
      prdSetDir = path.join(outputDir, setId);
      if (this.debug) {
        logger.debug(`[ConvertModeHandler] Using production directory structure: ${prdSetDir}`);
      }
    } else {
      // Legacy behavior: {outputDir}/{setId}-prd-set
      prdSetDir = path.join(outputDir, `${setId}-prd-set`);
      if (this.debug) {
        logger.debug(`[ConvertModeHandler] Using legacy directory structure: ${prdSetDir}`);
      }
    }
    
    await fs.ensureDir(prdSetDir);

    const generatedFiles = await this.prdSetGenerator.generate(parsedDoc, prdSetDir, setId);

    // Write generated files
    for (const file of generatedFiles) {
      const filePath = path.join(prdSetDir, file.filename);
      await fs.writeFile(filePath, file.content, 'utf-8');
      logger.debug(`[ConvertModeHandler] Generated file: ${filePath}`);
    }

    // 7. Update conversation state
    if (this.conversationManager && conversationId) {
      await this.conversationManager.updateState(
        conversationId,
        refinement.executable ? 'complete' : 'refining'
      );
    }

    // 8. Generate summary
    const summary = this.generateSummary(parsedDoc, refinement, prdSetDir, setId);

    return {
      prdSetPath: prdSetDir,
      prd: parsedDoc,
      refinement,
      executable: refinement.executable,
      summary,
    };
  }

  /**
   * Check if outputDir is productionDir (configurable default: .taskmaster/production)
   */
  private isProductionDir(outputDir: string, productionDir?: string): boolean {
    // Check if outputDir matches production dir (default or configured)
    const configuredProductionDir = productionDir || '.taskmaster/production';
    const resolvedOutputDir = path.resolve(process.cwd(), outputDir);
    const resolvedProductionDir = path.resolve(process.cwd(), configuredProductionDir);
    return resolvedOutputDir === resolvedProductionDir;
  }

  /**
   * Generate PRD set ID from file path if not provided
   */
  private generateSetIdFromPath(filePath: string): string {
    const basename = path.basename(filePath, path.extname(filePath));
    // Convert to valid ID format (alphanumeric, hyphens, underscores)
    return basename
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
  }

  /**
   * Generate summary
   */
  private generateSummary(
    prd: ParsedPlanningDoc,
    refinement: RefinementResult,
    prdSetPath: string,
    setId: string
  ): string {
    const parts: string[] = [];

    parts.push(`Converted planning document to PRD set: ${setId}`);
    parts.push(`Output directory: ${prdSetPath}`);
    parts.push('');

    parts.push('Refinement Results:');
    parts.push(refinement.summary);
    parts.push('');

    parts.push(`Status: ${refinement.executable ? '✓ PRD set is 100% executable' : '✗ PRD set needs additional refinement'}`);

    return parts.join('\n');
  }
}
