/**
 * AI Refinement Orchestrator
 *
 * Orchestrates iterative refinement of PRD sets using AI.
 * Coordinates SchemaEnhancer, TestPlanner, FeatureEnhancer, and ExecutabilityValidator.
 */

import { ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureType } from '../../analysis/feature-type-detector';
import { SchemaEnhancer, SchemaEnhancementResult } from './schema-enhancer';
import { TestPlanner, TestPlanningResult } from './test-planner';
import { FeatureEnhancer, FeatureEnhancementResult } from './feature-enhancer';
import { ExecutabilityValidator, ExecutabilityValidationResult } from './executability-validator';
import { RefinementQuestionGenerator, RefinementQuestion } from './refinement-question-generator';
import { CodebaseInsightExtractor, CodebaseInsight } from './codebase-insight-extractor';
import { ConversationManager } from '../../conversation/conversation-manager';
import { PRDBuildingProgressTracker } from '../../tracking/prd-building-progress-tracker';
import { InteractivePromptSystem } from '../builder/interactive-prompt-system';
import { filterAndAutoApply } from '../builder/speckit-utils';
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { BuildMode } from '../../conversation/types';
import { logger } from '../../utils/logger';
import { Config } from '../../../config/schema/core';
import { PatternEntry, ObservationEntry, TestResultExecution } from '../learning/types';

/**
 * Refinement Context
 */
export interface RefinementContext {
  conversationId: string;
  iteration: number;
  mode: BuildMode;
  prd: ParsedPlanningDoc;
  codebaseAnalysis: CodebaseAnalysisResult;
  featureTypes?: FeatureType[];
}

/**
 * Refinement Result
 */
export interface RefinementResult {
  prd: ParsedPlanningDoc;
  schemas: SchemaEnhancementResult;
  tests: TestPlanningResult;
  features: FeatureEnhancementResult;
  validation: ExecutabilityValidationResult;
  executable: boolean;
  iterations: number;
  summary: string;
}

/**
 * Refinement Iteration Result
 */
export interface RefinementIterationResult {
  iteration: number;
  phase: 'schema-enhancement' | 'test-planning' | 'feature-enhancement' | 'validation';
  success: boolean;
  enhancements?: {
    schemas?: SchemaEnhancementResult;
    tests?: TestPlanningResult;
    features?: FeatureEnhancementResult;
  };
  validation?: ExecutabilityValidationResult;
  userResponse?: 'approve' | 'reject' | 'edit';
}

/**
 * AI Refinement Orchestrator Configuration
 */
export interface AIRefinementOrchestratorConfig {
  projectRoot: string;
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  codebaseAnalysis: CodebaseAnalysisResult;
  promptSelector: PromptSelector;
  projectConfig?: Config; // Project configuration from devloop.config.js
  conversationManager?: ConversationManager;
  progressTracker?: PRDBuildingProgressTracker;
  interactivePrompts?: InteractivePromptSystem;
  // Learning data from JSON files (for context-aware refinement)
  patterns?: PatternEntry[]; // Loaded patterns from patterns.json (filtered)
  observations?: ObservationEntry[]; // Loaded observations from observations.json (filtered)
  testResults?: TestResultExecution[]; // Loaded test results from test-results.json (filtered)
  maxIterations?: number;
  autoApprove?: boolean;
  askPrePhaseQuestions?: boolean;
  askMidPhaseQuestions?: boolean;
  askPostPhaseQuestions?: boolean;
  showCodebaseInsights?: boolean;
  debug?: boolean;
}

/**
 * Orchestrates iterative refinement of PRD sets
 */
export class AIRefinementOrchestrator {
  private config: Required<Omit<AIRefinementOrchestratorConfig, 'conversationManager' | 'progressTracker' | 'interactivePrompts'>> &
    Pick<AIRefinementOrchestratorConfig, 'conversationManager' | 'progressTracker' | 'interactivePrompts'>;
  private schemaEnhancer: SchemaEnhancer;
  private testPlanner: TestPlanner;
  private featureEnhancer: FeatureEnhancer;
  private executabilityValidator: ExecutabilityValidator;
  private questionGenerator: RefinementQuestionGenerator;
  private insightExtractor: CodebaseInsightExtractor;
  private debug: boolean;

  constructor(config: AIRefinementOrchestratorConfig) {
    this.config = {
      projectRoot: config.projectRoot,
      aiProvider: config.aiProvider,
      aiProviderConfig: config.aiProviderConfig, // Required
      codebaseAnalysis: config.codebaseAnalysis,
      promptSelector: config.promptSelector,
      projectConfig: config.projectConfig!, // Required but may be undefined at runtime - handled by optional chaining
      conversationManager: config.conversationManager,
      progressTracker: config.progressTracker,
      interactivePrompts: config.interactivePrompts,
      patterns: config.patterns || [],
      observations: config.observations || [],
      testResults: config.testResults || [],
      maxIterations: config.maxIterations || 5,
      autoApprove: config.autoApprove || false,
      askPrePhaseQuestions: config.askPrePhaseQuestions !== false, // Default to true
      askMidPhaseQuestions: config.askMidPhaseQuestions !== false, // Default to true
      askPostPhaseQuestions: config.askPostPhaseQuestions !== false, // Default to true
      showCodebaseInsights: config.showCodebaseInsights !== false, // Default to true
      debug: config.debug || false,
    } as typeof this.config;
    this.debug = this.config.debug;

    // Initialize refinement services
    this.schemaEnhancer = new SchemaEnhancer({
      projectRoot: this.config.projectRoot,
      aiProvider: this.config.aiProvider,
      aiProviderConfig: this.config.aiProviderConfig,
      codebaseAnalysis: this.config.codebaseAnalysis,
      promptSelector: this.config.promptSelector,
      debug: this.debug,
    });

    this.testPlanner = new TestPlanner({
      projectRoot: this.config.projectRoot,
      aiProvider: this.config.aiProvider,
      aiProviderConfig: this.config.aiProviderConfig,
      codebaseAnalysis: this.config.codebaseAnalysis,
      promptSelector: this.config.promptSelector,
      debug: this.debug,
    });

    this.featureEnhancer = new FeatureEnhancer({
      projectRoot: this.config.projectRoot,
      aiProvider: this.config.aiProvider,
      aiProviderConfig: this.config.aiProviderConfig,
      codebaseAnalysis: this.config.codebaseAnalysis,
      promptSelector: this.config.promptSelector,
      debug: this.debug,
    });

    this.executabilityValidator = new ExecutabilityValidator({
      strict: false,
      debug: this.debug,
    });

    // Initialize question generator and insight extractor with learning data
    this.questionGenerator = new RefinementQuestionGenerator({
      aiProvider: this.config.aiProvider,
      aiProviderConfig: this.config.aiProviderConfig,
      promptSelector: this.config.promptSelector,
      projectConfig: this.config.projectConfig,
      // Pass loaded learning data for context-aware questions
      patterns: this.config.patterns || [],
      observations: this.config.observations || [],
      debug: this.debug,
    });

    this.insightExtractor = new CodebaseInsightExtractor({
      projectRoot: this.config.projectRoot,
      // Pass loaded test results for context-aware insights
      testResults: this.config.testResults || [],
      debug: this.debug,
    });
  }

  /**
   * Refine PRD through iterative enhancements
   */
  async refine(
    prd: ParsedPlanningDoc,
    context: Omit<RefinementContext, 'iteration'>,
    options?: {
      maxIterations?: number;
      autoApprove?: boolean;
    }
  ): Promise<RefinementResult> {
    const maxIterations = options?.maxIterations || this.config.maxIterations;
    const autoApprove = options?.autoApprove ?? this.config.autoApprove;

    logger.debug(
      `[AIRefinementOrchestrator] Starting refinement for PRD ${prd.prdId} (max iterations: ${maxIterations}, auto-approve: ${autoApprove})`
    );

    let currentPrd = prd;
    let schemas: SchemaEnhancementResult | undefined;
    let tests: TestPlanningResult | undefined;
    let features: FeatureEnhancementResult | undefined;
    let validation: ExecutabilityValidationResult | undefined;
    let iteration = 0;
    let executable = false;

    // Track progress
    if (this.config.progressTracker) {
      this.config.progressTracker.trackPRDBuildingProgress(context.conversationId, 'refinement', {
        conversationId: context.conversationId,
        phase: 'refinement',
        questionsAsked: 0,
        questionsTotal: 0,
        answersReceived: 0,
        draftsGenerated: 1,
        refinementsApplied: 0,
        completionPercentage: 0,
      });
    }

    // Streamlined path for auto-approve mode
    if (autoApprove) {
      logger.debug(`[AIRefinementOrchestrator] Using streamlined auto-approve path`);
      
      // Import build metrics for timing instrumentation
      const { getBuildMetrics } = await import('../../metrics/build');
      const buildMetrics = getBuildMetrics();
      
      // Skip all pre/mid/post phase questions and generate enhancements directly
      // Run each enhancer once (no iteration loops)
      // Run validation only at the very end
      
      // Schema Enhancement with timing
      const schemaStart = Date.now();
      schemas = await this.schemaEnhancer.enhanceSchemas(currentPrd, {
        conversationId: context.conversationId,
        iteration: 0,
      });
      buildMetrics.recordTiming('schemaEnhancementMs', Date.now() - schemaStart);
      
      // Test Planning with timing
      const testStart = Date.now();
      tests = await this.testPlanner.generateTestPlans(currentPrd, {
        conversationId: context.conversationId,
        iteration: 0,
      });
      buildMetrics.recordTiming('testPlanningMs', Date.now() - testStart);
      
      // Feature Enhancement with timing
      const featureStart = Date.now();
      features = await this.featureEnhancer.enhanceFeatures(currentPrd, {
        conversationId: context.conversationId,
        iteration: 0,
      });
      buildMetrics.recordTiming('featureEnhancementMs', Date.now() - featureStart);
      
      // Single validation at end instead of after each phase with timing
      const validationStart = Date.now();
      validation = await this.executabilityValidator.validateExecutability(currentPrd, {
        schemas,
        tests,
        features,
      });
      buildMetrics.recordTiming('validationMs', Date.now() - validationStart);
      
      executable = validation.executable && validation.score === 100;
      iteration = 1; // Single iteration for streamlined path
      
      // Generate summary
      const summary = this.generateSummary(schemas, tests, features, validation, executable, iteration);

      // Save checkpoint
      if (this.config.progressTracker) {
        await this.config.progressTracker.saveCheckpoint(
          context.conversationId,
          context.mode,
          executable ? 'validation' : 'refinement',
          iteration,
          currentPrd,
          `Streamlined refinement complete (auto-approve mode)`
        );
      }

      return {
        prd: currentPrd,
        schemas: schemas || { schemas: [], summary: '', confidence: 0 },
        tests: tests || { testPlans: [], summary: '', coverage: { totalTasks: 0, tasksWithTests: 0, coveragePercentage: 0 } },
        features: features || { enhancements: [], summary: '' },
        validation,
        executable,
        iterations: iteration,
        summary,
      };
    }

    // Interactive path (original implementation)
    // Phase 1: Schema Enhancement (Interactive)
    logger.debug(`[AIRefinementOrchestrator] Phase: Schema Enhancement`);
    const schemaPhaseResult = await this.refinePhaseInteractive(
      'schema',
      currentPrd,
      context,
      iteration,
      autoApprove,
      schemas
    );
    if (schemaPhaseResult.success && schemaPhaseResult.enhancements?.schemas) {
      schemas = schemaPhaseResult.enhancements.schemas;
      iteration = schemaPhaseResult.finalIteration || iteration + 1;
    }

    // Phase 2: Test Planning (Interactive)
    logger.debug(`[AIRefinementOrchestrator] Phase: Test Planning`);
    const testPhaseResult = await this.refinePhaseInteractive(
      'test',
      currentPrd,
      context,
      iteration,
      autoApprove,
      tests
    );
    if (testPhaseResult.success && testPhaseResult.enhancements?.tests) {
      tests = testPhaseResult.enhancements.tests;
      iteration = testPhaseResult.finalIteration || iteration + 1;
    }

    // Phase 3: Feature Enhancement (Interactive)
    logger.debug(`[AIRefinementOrchestrator] Phase: Feature Enhancement`);
    const featurePhaseResult = await this.refinePhaseInteractive(
      'feature',
      currentPrd,
      context,
      iteration,
      autoApprove,
      features
    );
    if (featurePhaseResult.success && featurePhaseResult.enhancements?.features) {
      features = featurePhaseResult.enhancements.features;
      iteration = featurePhaseResult.finalIteration || iteration + 1;
    }

    // Final Validation
    logger.debug(`[AIRefinementOrchestrator] Final validation`);
    validation = await this.executabilityValidator.validateExecutability(currentPrd, {
      schemas,
      tests,
      features,
    });

    // Require 100% executability score for success
    executable = validation.executable && validation.score === 100;

    // If not executable and haven't exceeded max iterations, continue refining
    if (!executable && iteration < maxIterations) {
      // Additional refinement iterations can be added here
      logger.debug(`[AIRefinementOrchestrator] PRD not 100% executable (score: ${validation.score}), but max iterations reached`);
    }

    // Generate summary
    const summary = this.generateSummary(schemas, tests, features, validation, executable, iteration);

    // Save checkpoint
    if (this.config.progressTracker) {
      await this.config.progressTracker.saveCheckpoint(
        context.conversationId,
        context.mode,
        executable ? 'validation' : 'refinement',
        iteration,
        currentPrd,
        `Refinement iteration ${iteration} complete`
      );
    }

    return {
      prd: currentPrd,
      schemas: schemas || { schemas: [], summary: '', confidence: 0 },
      tests: tests || { testPlans: [], summary: '', coverage: { totalTasks: 0, tasksWithTests: 0, coveragePercentage: 0 } },
      features: features || { enhancements: [], summary: '' },
      validation,
      executable,
      iterations: iteration,
      summary,
    };
  }

  /**
   * Refine a phase interactively (with pre-phase, mid-phase, and post-phase questions)
   */
  private async refinePhaseInteractive(
    phase: 'schema' | 'test' | 'feature',
    prd: ParsedPlanningDoc,
    context: Omit<RefinementContext, 'iteration'>,
    iteration: number,
    autoApprove: boolean,
    existingEnhancements?: SchemaEnhancementResult | TestPlanningResult | FeatureEnhancementResult
  ): Promise<RefinementIterationResult & { finalIteration?: number }> {
    logger.debug(`[AIRefinementOrchestrator] Starting interactive ${phase} phase refinement`);

    let phaseIteration = iteration;
    let enhancements: SchemaEnhancementResult | TestPlanningResult | FeatureEnhancementResult | undefined = existingEnhancements;
    let userResponse: 'approve' | 'reject' | 'edit' = 'approve';

    // Step 1: Extract codebase insights for this phase
    let insights: CodebaseInsight[] = [];
    if (this.config.showCodebaseInsights) {
      insights = await this.insightExtractor.extractInsightsForPhase(phase, this.config.codebaseAnalysis);
    }

    // Step 2: Pre-phase: Validate current state and show insights and ask questions
    // Validate current state to get validation gaps for dynamic question generation
    let prePhaseValidation: ExecutabilityValidationResult | undefined;
    if (existingEnhancements) {
      prePhaseValidation = await this.executabilityValidator.validateExecutability(prd, {
        schemas: phase === 'schema' ? existingEnhancements as SchemaEnhancementResult : undefined,
        tests: phase === 'test' ? existingEnhancements as TestPlanningResult : undefined,
        features: phase === 'feature' ? existingEnhancements as FeatureEnhancementResult : undefined,
      });
    }

    let prePhaseAnswers = new Map<string, any>();
    if (this.config.askPrePhaseQuestions && !autoApprove && this.config.interactivePrompts) {
      // Show codebase insights
      if (insights.length > 0) {
        const { selectedInsights, preferences } = await this.config.interactivePrompts.showCodebaseInsights(
          insights,
          `Codebase Analysis - ${phase.toUpperCase()} Phase`
        );

        // Store selected insights preferences
        for (const [insightId, pref] of preferences.entries()) {
          prePhaseAnswers.set(`insight-${insightId}`, pref);
        }
      }

      // Generate and ask pre-phase questions (pass validation gaps for dynamic generation)
      const prePhaseQuestions = await this.questionGenerator.generatePrePhaseQuestions(
        phase,
        prd,
        this.config.codebaseAnalysis,
        insights,
        existingEnhancements,
        prePhaseValidation // Pass validation gaps for dynamic question generation
      );

      if (prePhaseQuestions.length > 0) {
        // Use spec-kit utility to filter and auto-apply high-confidence answers
        const specKitConfig = this.config.projectConfig?.prdBuilding?.specKit;
        const { autoApplied, needsPrompt, answers: autoAnswers } = filterAndAutoApply(
          prePhaseQuestions,
          specKitConfig,
          `[Refinement:${phase}]`
        );

        // Merge auto-applied answers into prePhaseAnswers
        for (const [id, answer] of autoAnswers) {
          prePhaseAnswers.set(id, answer);
        }

        // Only prompt for low-confidence questions
        if (needsPrompt.length > 0) {
          const userAnswers = await this.config.interactivePrompts.askRefinementQuestions(
            needsPrompt,
            phase
          );
          prePhaseAnswers = new Map([...prePhaseAnswers, ...userAnswers]);
        }
      }
    }

    // Step 3: Generate enhancements with context from answers
    let result: RefinementIterationResult;
    if (phase === 'schema') {
      result = await this.enhanceSchemasWithContext(
        prd,
        context,
        phaseIteration,
        autoApprove,
        prePhaseAnswers,
        insights
      );
    } else if (phase === 'test') {
      result = await this.planTestsWithContext(
        prd,
        context,
        phaseIteration,
        autoApprove,
        prePhaseAnswers,
        insights
      );
    } else {
      result = await this.enhanceFeaturesWithContext(
        prd,
        context,
        phaseIteration,
        autoApprove,
        prePhaseAnswers,
        insights
      );
    }

    if (!result.success || !result.enhancements) {
      return { ...result, finalIteration: phaseIteration };
    }

    // Extract enhancements based on phase
    if (phase === 'schema' && result.enhancements.schemas) {
      enhancements = result.enhancements.schemas as any;
    } else if (phase === 'test' && result.enhancements.tests) {
      enhancements = result.enhancements.tests as any;
    } else if (phase === 'feature' && result.enhancements.features) {
      enhancements = result.enhancements.features as any;
    }
    phaseIteration++;

    // Step 4: Mid-phase: Check for follow-up questions if needed
    if (this.config.askMidPhaseQuestions && !autoApprove && this.config.interactivePrompts && enhancements) {
      const midPhaseQuestions = await this.questionGenerator.generateMidPhaseQuestions(
        phase,
        enhancements,
        this.config.codebaseAnalysis,
        insights
      );

      if (midPhaseQuestions.length > 0) {
        // Use spec-kit utility to filter and auto-apply high-confidence answers
        const specKitConfig = this.config.projectConfig?.prdBuilding?.specKit;
        const { needsPrompt, answers: autoAnswers } = filterAndAutoApply(
          midPhaseQuestions,
          specKitConfig,
          `[Refinement:${phase}:mid]`
        );

        let midPhaseAnswers = new Map<string, any>(autoAnswers);

        // Only prompt for low-confidence questions
        if (needsPrompt.length > 0) {
          const userAnswers = await this.config.interactivePrompts.askRefinementQuestions(
            needsPrompt,
            phase
          );
          midPhaseAnswers = new Map([...midPhaseAnswers, ...userAnswers]);
        }

        // Use mid-phase answers to refine enhancements
        if (phase === 'schema' && midPhaseAnswers.has('mid-schema-low-confidence')) {
          const refine = midPhaseAnswers.get('mid-schema-low-confidence');
          if (refine && refine.includes('refine')) {
            // Refine low-confidence schemas
            const refinedResult = await this.refineSpecificSchemas(
              enhancements as SchemaEnhancementResult,
              (enhancements as SchemaEnhancementResult).schemas.filter((s: any) => (s.confidence || 0) < 0.7).map((s: any) => s.id),
              this.config.codebaseAnalysis
            );
            enhancements = refinedResult || enhancements;
          }
        }
        // Similar for test and feature phases
      }
    }

    // Step 5: Post-phase: Validate and ask what to refine
    let postPhaseValidation: ExecutabilityValidationResult | undefined;
    if (enhancements) {
      postPhaseValidation = await this.executabilityValidator.validateExecutability(prd, {
        schemas: phase === 'schema' ? enhancements as SchemaEnhancementResult : undefined,
        tests: phase === 'test' ? enhancements as TestPlanningResult : undefined,
        features: phase === 'feature' ? enhancements as FeatureEnhancementResult : undefined,
      });
    }

    let refineItems: string[] = [];
    if (this.config.askPostPhaseQuestions && !autoApprove && this.config.interactivePrompts && enhancements && postPhaseValidation) {
      // Generate post-phase questions
      const postPhaseQuestions = await this.questionGenerator.generatePostPhaseQuestions(
        phase,
        enhancements,
        postPhaseValidation,
        this.config.codebaseAnalysis
      );

      if (postPhaseQuestions.length > 0) {
        // Use spec-kit utility to filter and auto-apply high-confidence answers
        const specKitConfig = this.config.projectConfig?.prdBuilding?.specKit;
        const { needsPrompt, answers: autoAnswers } = filterAndAutoApply(
          postPhaseQuestions,
          specKitConfig,
          `[Refinement:${phase}:post]`
        );

        let postPhaseAnswers = new Map<string, any>(autoAnswers);

        // Only prompt for low-confidence questions
        if (needsPrompt.length > 0) {
          const userAnswers = await this.config.interactivePrompts.askRefinementQuestions(
            needsPrompt,
            phase
          );
          postPhaseAnswers = new Map([...postPhaseAnswers, ...userAnswers]);
        }

        // Extract refine items from answers
        if (postPhaseAnswers.has(`post-${phase}-errors`)) {
          const selected = postPhaseAnswers.get(`post-${phase}-errors`);
          if (Array.isArray(selected)) {
            refineItems = selected;
          } else if (typeof selected === 'string') {
            refineItems = [selected];
          }
        }

        if (postPhaseAnswers.has(`post-${phase}-incomplete`)) {
          const selected = postPhaseAnswers.get(`post-${phase}-incomplete`);
          if (Array.isArray(selected)) {
            refineItems.push(...selected);
          } else if (typeof selected === 'string') {
            refineItems.push(selected);
          }
        }
      }

      // Ask what to refine
      if (!refineItems.length) {
        const refinementFeedback = await this.config.interactivePrompts.askWhatToRefine(
          enhancements,
          postPhaseValidation,
          phase
        );
        refineItems = refinementFeedback.refineItems;
      }

      // Iteratively refine selected items
      if (refineItems.length > 0 && phaseIteration < (this.config.maxIterations || 5)) {
        let refinedEnhancements: SchemaEnhancementResult | TestPlanningResult | FeatureEnhancementResult | undefined;
        
        if (phase === 'schema') {
          refinedEnhancements = await this.refineSpecificSchemas(
            enhancements as SchemaEnhancementResult,
            refineItems,
            this.config.codebaseAnalysis
          );
        } else if (phase === 'test') {
          refinedEnhancements = await this.refineSpecificTestPlans(
            enhancements as TestPlanningResult,
            refineItems,
            this.config.codebaseAnalysis
          );
        } else if (phase === 'feature') {
          refinedEnhancements = await this.refineSpecificFeatures(
            enhancements as FeatureEnhancementResult,
            refineItems,
            this.config.codebaseAnalysis
          );
        }

        if (refinedEnhancements) {
          enhancements = refinedEnhancements;
          phaseIteration++;
        }
      }
    }

    // Step 6: Present final results and get approval
    if (!autoApprove && this.config.interactivePrompts) {
      userResponse = await this.config.interactivePrompts.presentRefinement(phaseIteration, [
        {
          type: `${phase}-enhancement`,
          description: this.getPhaseSummary(phase, enhancements),
          changes: enhancements,
        },
      ]);
    }

    return {
      iteration: phaseIteration,
      phase: `${phase}-enhancement` as any,
      success: userResponse === 'approve' && enhancements !== undefined,
      enhancements: {
        [phase]: enhancements,
      } as any,
      validation: postPhaseValidation,
      userResponse,
      finalIteration: phaseIteration,
    };
  }

  /**
   * Get summary for a phase's enhancements
   */
  private getPhaseSummary(
    phase: 'schema' | 'test' | 'feature',
    enhancements: SchemaEnhancementResult | TestPlanningResult | FeatureEnhancementResult | undefined
  ): string {
    if (!enhancements) {
      return `No ${phase} enhancements generated`;
    }

    if (phase === 'schema' && 'schemas' in enhancements) {
      const schemaResult = enhancements as SchemaEnhancementResult;
      const confidence = typeof schemaResult.confidence === 'number' ? schemaResult.confidence : 0;
      return `Generated ${schemaResult.schemas.length} schema(s) (confidence: ${Math.round(confidence * 100)}%)`;
    }

    if (phase === 'test' && 'testPlans' in enhancements) {
      const testResult = enhancements as TestPlanningResult;
      const coverage = testResult.coverage?.coveragePercentage || 0;
      return `Generated ${testResult.testPlans.length} test plan(s) (coverage: ${coverage}%)`;
    }

    if (phase === 'feature' && 'enhancements' in enhancements) {
      const featureResult = enhancements as FeatureEnhancementResult;
      return `Generated ${featureResult.enhancements.length} feature enhancement(s)`;
    }

    return 'Enhancements generated';
  }

  /**
   * Enhance schemas with context from answers
   */
  private async enhanceSchemasWithContext(
    prd: ParsedPlanningDoc,
    context: Omit<RefinementContext, 'iteration'>,
    iteration: number,
    autoApprove: boolean,
    answers: Map<string, any>,
    insights: CodebaseInsight[]
  ): Promise<RefinementIterationResult> {
    try {
      // Use schema enhancer with context
      const schemas = await this.schemaEnhancer.enhanceSchemasWithContext(
        prd,
        answers,
        this.config.codebaseAnalysis,
        insights,
        {
          conversationId: context.conversationId,
          iteration,
        }
      );

      // Present to user for approval (if interactive)
      let userResponse: 'approve' | 'reject' | 'edit' = 'approve';
      if (!autoApprove && this.config.interactivePrompts) {
        userResponse = await this.config.interactivePrompts.presentRefinement(iteration + 1, [
          {
            type: 'schema-enhancement',
            description: schemas.summary,
            changes: schemas,
          },
        ]);
      }

      return {
        iteration: iteration + 1,
        phase: 'schema-enhancement',
        success: userResponse === 'approve',
        enhancements: { schemas },
        userResponse,
      };
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Schema enhancement with context failed: ${error}`);
      // Fallback to regular enhancement
      return await this.enhanceSchemas(prd, context, iteration, autoApprove);
    }
  }

  /**
   * Plan tests with context from answers
   */
  private async planTestsWithContext(
    prd: ParsedPlanningDoc,
    context: Omit<RefinementContext, 'iteration'>,
    iteration: number,
    autoApprove: boolean,
    answers: Map<string, any>,
    insights: CodebaseInsight[]
  ): Promise<RefinementIterationResult> {
    try {
      // Use test planner with context
      const tests = await this.testPlanner.generateTestPlansWithContext(
        prd,
        answers,
        this.config.codebaseAnalysis,
        insights,
        {
          conversationId: context.conversationId,
          iteration,
        }
      );

      // Present to user for approval (if interactive)
      let userResponse: 'approve' | 'reject' | 'edit' = 'approve';
      if (!autoApprove && this.config.interactivePrompts) {
        userResponse = await this.config.interactivePrompts.presentRefinement(iteration + 1, [
          {
            type: 'test-planning',
            description: tests.summary,
            changes: tests,
          },
        ]);
      }

      return {
        iteration: iteration + 1,
        phase: 'test-planning',
        success: userResponse === 'approve',
        enhancements: { tests },
        userResponse,
      };
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Test planning with context failed: ${error}`);
      // Fallback to regular test planning
      return await this.planTests(prd, context, iteration, autoApprove);
    }
  }

  /**
   * Enhance features with context from answers
   */
  private async enhanceFeaturesWithContext(
    prd: ParsedPlanningDoc,
    context: Omit<RefinementContext, 'iteration'>,
    iteration: number,
    autoApprove: boolean,
    answers: Map<string, any>,
    insights: CodebaseInsight[]
  ): Promise<RefinementIterationResult> {
    try {
      // Use feature enhancer with context
      const features = await this.featureEnhancer.enhanceFeaturesWithContext(
        prd,
        answers,
        this.config.codebaseAnalysis,
        insights,
        {
          conversationId: context.conversationId,
          iteration,
        }
      );

      // Present to user for approval (if interactive)
      let userResponse: 'approve' | 'reject' | 'edit' = 'approve';
      if (!autoApprove && this.config.interactivePrompts) {
        userResponse = await this.config.interactivePrompts.presentRefinement(iteration + 1, [
          {
            type: 'feature-enhancement',
            description: features.summary,
            changes: features,
          },
        ]);
      }

      return {
        iteration: iteration + 1,
        phase: 'feature-enhancement',
        success: userResponse === 'approve',
        enhancements: { features },
        userResponse,
      };
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Feature enhancement with context failed: ${error}`);
      // Fallback to regular feature enhancement
      return await this.enhanceFeatures(prd, context, iteration, autoApprove);
    }
  }

  /**
   * Refine specific schemas
   */
  private async refineSpecificSchemas(
    schemas: SchemaEnhancementResult,
    refineIds: string[],
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<SchemaEnhancementResult | undefined> {
    logger.debug(`[AIRefinementOrchestrator] Refining schemas: ${refineIds.join(', ')}`);
    try {
      return await this.schemaEnhancer.refineSpecificSchemas(schemas, refineIds, codebaseAnalysis);
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Failed to refine schemas: ${error}`);
      return schemas; // Return original on error
    }
  }

  /**
   * Refine specific test plans
   */
  private async refineSpecificTestPlans(
    tests: TestPlanningResult,
    refineIds: string[],
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<TestPlanningResult | undefined> {
    logger.debug(`[AIRefinementOrchestrator] Refining test plans: ${refineIds.join(', ')}`);
    try {
      return await this.testPlanner.refineSpecificTestPlans(tests, refineIds, codebaseAnalysis);
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Failed to refine test plans: ${error}`);
      return tests; // Return original on error
    }
  }

  /**
   * Refine specific features
   */
  private async refineSpecificFeatures(
    features: FeatureEnhancementResult,
    refineIds: string[],
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<FeatureEnhancementResult | undefined> {
    logger.debug(`[AIRefinementOrchestrator] Refining features: ${refineIds.join(', ')}`);
    try {
      return await this.featureEnhancer.refineSpecificFeatures(features, refineIds, codebaseAnalysis);
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Failed to refine features: ${error}`);
      return features; // Return original on error
    }
  }

  /**
   * Enhance schemas
   */
  private async enhanceSchemas(
    prd: ParsedPlanningDoc,
    context: Omit<RefinementContext, 'iteration'>,
    iteration: number,
    autoApprove: boolean
  ): Promise<RefinementIterationResult> {
    try {
      const schemas = await this.schemaEnhancer.enhanceSchemas(prd, {
        conversationId: context.conversationId,
        iteration,
      });

      // Present to user for approval (if interactive)
      let userResponse: 'approve' | 'reject' | 'edit' = 'approve';
      if (!autoApprove && this.config.interactivePrompts) {
        userResponse = await this.config.interactivePrompts.presentRefinement(iteration + 1, [
          {
            type: 'schema-enhancement',
            description: schemas.summary,
            changes: schemas,
          },
        ]);
      }

      return {
        iteration: iteration + 1,
        phase: 'schema-enhancement',
        success: userResponse === 'approve',
        enhancements: { schemas },
        userResponse,
      };
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Schema enhancement failed: ${error}`);
      return {
        iteration: iteration + 1,
        phase: 'schema-enhancement',
        success: false,
      };
    }
  }

  /**
   * Plan tests
   */
  private async planTests(
    prd: ParsedPlanningDoc,
    context: Omit<RefinementContext, 'iteration'>,
    iteration: number,
    autoApprove: boolean
  ): Promise<RefinementIterationResult> {
    try {
      const tests = await this.testPlanner.generateTestPlans(prd, {
        conversationId: context.conversationId,
        iteration,
      });

      // Present to user for approval (if interactive)
      let userResponse: 'approve' | 'reject' | 'edit' = 'approve';
      if (!autoApprove && this.config.interactivePrompts) {
        userResponse = await this.config.interactivePrompts.presentRefinement(iteration + 1, [
          {
            type: 'test-planning',
            description: tests.summary,
            changes: tests,
          },
        ]);
      }

      return {
        iteration: iteration + 1,
        phase: 'test-planning',
        success: userResponse === 'approve',
        enhancements: { tests },
        userResponse,
      };
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Test planning failed: ${error}`);
      return {
        iteration: iteration + 1,
        phase: 'test-planning',
        success: false,
      };
    }
  }

  /**
   * Enhance features
   */
  private async enhanceFeatures(
    prd: ParsedPlanningDoc,
    context: Omit<RefinementContext, 'iteration'>,
    iteration: number,
    autoApprove: boolean
  ): Promise<RefinementIterationResult> {
    try {
      const features = await this.featureEnhancer.enhanceFeatures(prd, {
        conversationId: context.conversationId,
        iteration,
      });

      // Present to user for approval (if interactive)
      let userResponse: 'approve' | 'reject' | 'edit' = 'approve';
      if (!autoApprove && this.config.interactivePrompts) {
        userResponse = await this.config.interactivePrompts.presentRefinement(iteration + 1, [
          {
            type: 'feature-enhancement',
            description: features.summary,
            changes: features,
          },
        ]);
      }

      return {
        iteration: iteration + 1,
        phase: 'feature-enhancement',
        success: userResponse === 'approve',
        enhancements: { features },
        userResponse,
      };
    } catch (error) {
      logger.error(`[AIRefinementOrchestrator] Feature enhancement failed: ${error}`);
      return {
        iteration: iteration + 1,
        phase: 'feature-enhancement',
        success: false,
      };
    }
  }

  /**
   * Generate summary
   */
  private generateSummary(
    schemas?: SchemaEnhancementResult,
    tests?: TestPlanningResult,
    features?: FeatureEnhancementResult,
    validation?: ExecutabilityValidationResult,
    executable?: boolean,
    iterations?: number
  ): string {
    const parts: string[] = [];

    parts.push(`Refinement Summary (${iterations || 0} iteration(s)):`);
    parts.push('');

    if (schemas) {
      parts.push(`Schema Enhancements: ${schemas.schemas.length} schema(s) generated (confidence: ${Math.round(schemas.confidence * 100)}%)`);
    }

    if (tests) {
      parts.push(`Test Planning: ${tests.testPlans.length} test plan(s) generated (coverage: ${tests.coverage.coveragePercentage}%)`);
    }

    if (features) {
      parts.push(`Feature Enhancements: ${features.enhancements.length} enhancement(s) generated`);
    }

    if (validation) {
      parts.push(`Validation: ${validation.executable ? 'EXECUTABLE' : 'NOT EXECUTABLE'} (score: ${validation.score}/100)`);
      if (validation.errors.length > 0) {
        parts.push(`  Errors: ${validation.errors.length}`);
      }
      if (validation.warnings.length > 0) {
        parts.push(`  Warnings: ${validation.warnings.length}`);
      }
    }

    parts.push('');
    parts.push(`Status: ${executable ? '✓ PRD set is 100% executable' : '✗ PRD set needs additional refinement'}`);

    return parts.join('\n');
  }
}
