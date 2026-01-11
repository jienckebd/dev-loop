/**
 * PRD Builder Orchestrator
 *
 * Orchestrates all three modes (convert, enhance, create).
 * Integrates all mode handlers, auto-detection, and session management.
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { BuildMode } from '../../conversation/types';
import { ConvertModeHandler, ConvertModeResult } from './convert-mode-handler';
import { EnhanceModeHandler, EnhanceModeResult } from './enhance-mode-handler';
import { CreateModeHandler, CreateModeResult } from './create-mode-handler';
import { ConversationManager } from '../../conversation/conversation-manager';
import { PRDBuildingProgressTracker } from '../../tracking/prd-building-progress-tracker';
import { InteractivePromptSystem } from './interactive-prompt-system';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { Config } from '../../../config/schema/core';
import { logger } from '../../utils/logger';
import { PatternLoader } from '../learning/pattern-loader';
import { ObservationLoader } from '../learning/observation-loader';
import { TestResultsLoader } from '../learning/test-results-loader';
import { PatternEntry } from '../learning/types';
import { ObservationEntry } from '../learning/types';
import { TestResultExecution } from '../learning/types';

/**
 * Build Input (auto-detection input)
 */
export interface BuildInput {
  path?: string; // File path or directory path
  prompt?: string; // User prompt (for create mode)
  mode?: BuildMode; // Explicit mode override
}

/**
 * Build Options
 */
export interface BuildOptions {
  outputDir?: string;
  productionDir?: string; // Production directory for subfolder structure
  setId?: string;
  autoApprove?: boolean;
  skipAnalysis?: boolean;
  maxIterations?: number;
  interactive?: boolean;
  debug?: boolean;
  // Mode-specific options
  gapsOnly?: boolean; // Enhance mode
  enhanceTypes?: Array<'schemas' | 'tests' | 'config' | 'all'>; // Enhance mode
  preserveExisting?: boolean; // Enhance mode
  maxQuestions?: number; // Create mode
  skipQuestions?: boolean; // Create mode
  validateOnly?: boolean; // Convert mode
  force?: boolean; // Convert mode
}

/**
 * Build Result
 */
export interface BuildResult {
  mode: BuildMode;
  success: boolean;
  prdSetPath?: string;
  executable: boolean;
  summary: string;
  result?: ConvertModeResult | EnhanceModeResult | CreateModeResult;
}

/**
 * PRD Builder Orchestrator Configuration
 */
export interface PRDBuilderOrchestratorConfig {
  projectRoot: string;
  config: Config;
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  conversationManager?: ConversationManager;
  progressTracker?: PRDBuildingProgressTracker;
  interactivePrompts?: InteractivePromptSystem;
  debug?: boolean;
}

/**
 * Orchestrates PRD building across all three modes
 */
export class PRDBuilderOrchestrator {
  private config: PRDBuilderOrchestratorConfig;
  private convertHandler: ConvertModeHandler;
  private enhanceHandler: EnhanceModeHandler;
  private createHandler: CreateModeHandler;
  private conversationManager: ConversationManager;
  private progressTracker: PRDBuildingProgressTracker;
  private interactivePrompts: InteractivePromptSystem;
  private debug: boolean;
  // Learning file loaders (loaded patterns, observations, test results for context)
  private patternLoader?: PatternLoader;
  private observationLoader?: ObservationLoader;
  private testResultsLoader?: TestResultsLoader;
  private loadedPatterns: PatternEntry[] = [];
  private loadedObservations: ObservationEntry[] = [];
  private loadedTestResults: TestResultExecution[] = [];

  constructor(config: PRDBuilderOrchestratorConfig) {
    this.config = config;
    this.debug = config.debug || false;

    // Initialize conversation and progress tracking (shared across modes)
    this.conversationManager =
      config.conversationManager ||
      new ConversationManager({
        enabled: true,
        debug: this.debug,
      });

    this.progressTracker =
      config.progressTracker ||
      new PRDBuildingProgressTracker({
        enabled: true,
        debug: this.debug,
      });

    this.interactivePrompts =
      config.interactivePrompts ||
      new InteractivePromptSystem({
        useRichUI: true,
        debug: this.debug,
      });

    // Initialize learning file loaders (if enabled in config) - synchronous setup only
    // Actual loading happens in build() method
    this.initializeLearningLoaders();
    this.convertHandler = new ConvertModeHandler({
      projectRoot: config.projectRoot,
      projectConfig: config.config, // Pass project config from orchestrator
      aiProvider: config.aiProvider,
      aiProviderConfig: config.aiProviderConfig,
      conversationManager: this.conversationManager,
      progressTracker: this.progressTracker,
      interactivePrompts: this.interactivePrompts,
      debug: this.debug,
    });

    this.enhanceHandler = new EnhanceModeHandler({
      projectRoot: config.projectRoot,
      projectConfig: config.config, // Pass project config from orchestrator
      aiProvider: config.aiProvider,
      aiProviderConfig: config.aiProviderConfig,
      conversationManager: this.conversationManager,
      progressTracker: this.progressTracker,
      interactivePrompts: this.interactivePrompts,
      debug: this.debug,
    });

    this.createHandler = new CreateModeHandler({
      projectRoot: config.projectRoot,
      projectConfig: config.config, // Pass project config from orchestrator
      aiProvider: config.aiProvider,
      aiProviderConfig: config.aiProviderConfig,
      conversationManager: this.conversationManager,
      progressTracker: this.progressTracker,
      interactivePrompts: this.interactivePrompts,
      debug: this.debug,
    });
  }

  /**
   * Build PRD set (auto-detect mode or use explicit mode)
   */
  async build(input: BuildInput, options: BuildOptions = {}): Promise<BuildResult> {
    logger.debug(`[PRDBuilderOrchestrator] Building PRD set with input: ${input.path || input.prompt}`);

    // Load learning data if not already loaded (async, but don't block on it)
    if (this.loadedPatterns.length === 0 && this.loadedObservations.length === 0 && this.loadedTestResults.length === 0) {
      await this.loadLearningData();
    }

    // Auto-detect mode if not specified
    const mode = input.mode || (await this.autoDetectMode(input));

    logger.debug(`[PRDBuilderOrchestrator] Using mode: ${mode}`);

    try {
      let result: ConvertModeResult | EnhanceModeResult | CreateModeResult;
      let executable = false;
      let prdSetPath: string | undefined;
      let summary: string;

      switch (mode) {
        case 'convert':
          if (!input.path) {
            throw new Error('Convert mode requires a planning document path');
          }
          result = await this.convertHandler.convert(input.path, {
            outputDir: options.outputDir,
            productionDir: options.productionDir,
            setId: options.setId,
            autoApprove: options.autoApprove,
            skipAnalysis: options.skipAnalysis,
            maxIterations: options.maxIterations,
            interactive: options.interactive,
            debug: options.debug,
            validateOnly: options.validateOnly,
            force: options.force,
            // Pass loaded learning data for context-aware refinement
            patterns: this.loadedPatterns,
            observations: this.loadedObservations,
            testResults: this.loadedTestResults,
          });
          executable = result.executable;
          prdSetPath = result.prdSetPath;
          summary = result.summary;
          break;

        case 'enhance':
          if (!input.path) {
            throw new Error('Enhance mode requires a PRD set path');
          }
          result = await this.enhanceHandler.enhance(input.path, {
            outputDir: options.outputDir,
            gapsOnly: options.gapsOnly,
            enhanceTypes: options.enhanceTypes,
            preserveExisting: options.preserveExisting !== false,
            autoApprove: options.autoApprove,
            skipAnalysis: options.skipAnalysis,
            maxIterations: options.maxIterations,
            interactive: options.interactive,
            debug: options.debug,
            // Pass loaded learning data for context-aware refinement
            patterns: this.loadedPatterns,
            observations: this.loadedObservations,
            testResults: this.loadedTestResults,
          });
          executable = result.executable;
          prdSetPath = result.prdSetPath;
          summary = result.summary;
          break;

        case 'create':
          if (!input.prompt) {
            throw new Error('Create mode requires an initial prompt');
          }
          result = await this.createHandler.create(input.prompt, {
            outputDir: options.outputDir,
            productionDir: options.productionDir,
            setId: options.setId,
            maxQuestions: options.maxQuestions,
            skipQuestions: options.skipQuestions,
            autoApprove: options.autoApprove,
            skipAnalysis: options.skipAnalysis,
            maxIterations: options.maxIterations,
            interactive: options.interactive,
            debug: options.debug,
            // Pass loaded learning data for context-aware refinement
            patterns: this.loadedPatterns,
            observations: this.loadedObservations,
            testResults: this.loadedTestResults,
          });
          executable = result.executable;
          prdSetPath = result.prdSetPath;
          summary = result.summary;
          break;

        default:
          throw new Error(`Unknown mode: ${mode}`);
      }

      return {
        mode,
        success: true,
        prdSetPath,
        executable,
        summary,
        result,
      };
    } catch (error) {
      logger.error(`[PRDBuilderOrchestrator] Build failed: ${error}`);
      return {
        mode,
        success: false,
        executable: false,
        summary: `Build failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Auto-detect mode based on input
   */
  async autoDetectMode(input: BuildInput): Promise<BuildMode> {
    // If prompt provided, use create mode
    if (input.prompt) {
      return 'create';
    }

    // If path provided, detect based on path
    if (input.path) {
      const resolvedPath = path.resolve(process.cwd(), input.path);
      const stats = await fs.stat(resolvedPath);

      if (stats.isDirectory()) {
        // Check if it's a PRD set directory (has index.md.yml or PRD files)
        const indexPath = path.join(resolvedPath, 'index.md.yml');
        if (await fs.pathExists(indexPath)) {
          return 'enhance'; // PRD set directory
        }

        // Check for PRD files (.md files with frontmatter)
        const files = await fs.readdir(resolvedPath);
        const hasPrdFiles = files.some(file => file.endsWith('.md') || file.endsWith('.md.yml'));
        if (hasPrdFiles) {
          return 'enhance'; // PRD set directory with PRD files
        }
      } else if (stats.isFile()) {
        // Check file extension
        if (input.path.endsWith('.md') || input.path.endsWith('.md.yml')) {
          // Check if it's a PRD set index file
          if (input.path.includes('index') || input.path.includes('prd-set')) {
            return 'enhance'; // PRD set index file
          }
          // Check if it's a planning document (has phases/tasks structure)
          try {
            const content = await fs.readFile(resolvedPath, 'utf-8');
            if (
              content.includes('phases:') ||
              content.includes('tasks:') ||
              content.includes('# Phase') ||
              content.includes('## Phase')
            ) {
              return 'convert'; // Planning document
            }
            return 'enhance'; // Default to enhance for .md files
          } catch {
            return 'convert'; // Default to convert on error
          }
        }
      }
    }

    // Default to create mode if no input
    return 'create';
  }

  /**
   * Initialize learning file loaders (patterns, observations, test results)
   * Synchronous setup - actual loading happens in loadLearningData()
   */
  private initializeLearningLoaders(): void {
    const learningFilesConfig = this.config.config.prdBuilding?.learningFiles;
    
    // Check if learning from files is enabled (default: true)
    if (learningFilesConfig?.enabled === false) {
      logger.debug('[PRDBuilderOrchestrator] Learning from JSON files is disabled');
      return;
    }

    const projectRoot = this.config.projectRoot;
    const filteringConfig = learningFilesConfig?.filtering || {};

    // Initialize PatternLoader
    const patternsPath = path.resolve(projectRoot, learningFilesConfig?.patterns || '.devloop/patterns.json');
    this.patternLoader = new PatternLoader({
      filePath: patternsPath,
      filterOptions: {
        retentionDays: filteringConfig.patternsRetentionDays || 180,
        relevanceThreshold: filteringConfig.relevanceThreshold || 0.5,
        lastUsedDays: 90, // Only load patterns used in last 90 days
        framework: this.config.config.framework?.type, // Filter by configured framework
        excludeExpired: true,
        autoPrune: filteringConfig.autoPrune !== false,
      },
      autoPrune: filteringConfig.autoPrune !== false,
      validateOnLoad: true,
      debug: this.debug,
    });

    // Initialize ObservationLoader
    const observationsPath = path.resolve(projectRoot, learningFilesConfig?.observations || '.devloop/observations.json');
    this.observationLoader = new ObservationLoader({
      filePath: observationsPath,
      filterOptions: {
        retentionDays: filteringConfig.observationsRetentionDays || 180,
        relevanceThreshold: filteringConfig.relevanceThreshold || 0.5,
        framework: this.config.config.framework?.type, // Filter by configured framework
        excludeExpired: true,
        autoPrune: filteringConfig.autoPrune !== false,
      },
      autoPrune: filteringConfig.autoPrune !== false,
      validateOnLoad: true,
      debug: this.debug,
    });

    // Initialize TestResultsLoader
    const testResultsPath = path.resolve(projectRoot, learningFilesConfig?.testResults || '.devloop/test-results.json/test-results.json');
    const prdSetStatePath = path.resolve(projectRoot, learningFilesConfig?.prdSetState || '.devloop/prd-set-state.json');
    this.testResultsLoader = new TestResultsLoader({
      filePath: testResultsPath,
      prdSetStatePath,
      filterOptions: {
        retentionDays: filteringConfig.testResultsRetentionDays || 180,
        relevanceThreshold: filteringConfig.relevanceThreshold || 0.5,
        framework: this.config.config.framework?.type, // Filter by configured framework
        testFramework: this.config.config.testGeneration?.framework, // Filter by configured test framework
        prdStatus: ['done', 'failed', 'cancelled'], // Only load results for completed PRDs (exclude running/pending)
        excludeExpired: true,
        autoPrune: filteringConfig.autoPrune !== false,
      },
      autoPrune: filteringConfig.autoPrune !== false,
      validateOnLoad: true,
      debug: this.debug,
    });

    // Note: Actual loading happens in build() method (lazy loading)
  }

  /**
   * Load learning data from JSON files (called asynchronously)
   */
  private async loadLearningData(): Promise<void> {
    try {
      logger.debug('[PRDBuilderOrchestrator] Loading learning data from JSON files');

      // Load patterns
      if (this.patternLoader) {
        this.loadedPatterns = await this.patternLoader.load();
        logger.debug(`[PRDBuilderOrchestrator] Loaded ${this.loadedPatterns.length} patterns`);
      }

      // Load observations
      if (this.observationLoader) {
        this.loadedObservations = await this.observationLoader.load();
        logger.debug(`[PRDBuilderOrchestrator] Loaded ${this.loadedObservations.length} observations`);
      }

      // Load test results
      if (this.testResultsLoader) {
        this.loadedTestResults = await this.testResultsLoader.load();
        logger.debug(`[PRDBuilderOrchestrator] Loaded ${this.loadedTestResults.length} test results`);
      }

      logger.debug(`[PRDBuilderOrchestrator] Learning data loaded: ${this.loadedPatterns.length} patterns, ${this.loadedObservations.length} observations, ${this.loadedTestResults.length} test results`);
    } catch (error) {
      logger.warn(`[PRDBuilderOrchestrator] Failed to load learning data: ${error}`);
      // Continue without learning data - not critical for PRD building
    }
  }

  /**
   * Get loaded patterns (for use by refinement services)
   */
  getLoadedPatterns(): PatternEntry[] {
    return this.loadedPatterns;
  }

  /**
   * Get loaded observations (for use by refinement services)
   */
  getLoadedObservations(): ObservationEntry[] {
    return this.loadedObservations;
  }

  /**
   * Get loaded test results (for use by refinement services)
   */
  getLoadedTestResults(): TestResultExecution[] {
    return this.loadedTestResults;
  }

  /**
   * Mark a pattern as used (updates lastUsedAt timestamp)
   */
  async markPatternUsed(patternId: string): Promise<void> {
    if (this.patternLoader) {
      await this.patternLoader.markPatternUsed(patternId);
      // Reload patterns to get updated lastUsedAt
      this.loadedPatterns = await this.patternLoader.load();
    }
  }
}
