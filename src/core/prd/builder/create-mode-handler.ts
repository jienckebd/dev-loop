/**
 * Create Mode Handler
 *
 * Handles create mode workflow (interactive PRD creation from prompt).
 * Integrates Q&A flow, conversation, progress, and refinement.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { QuestionGenerator, QuestionGenerationResult } from '../creation/question-generator';
import { AnswerProcessor, AnswerProcessingResult } from '../creation/answer-processor';
import { PrdDraftGenerator, PrdDraftGenerationResult } from '../creation/prd-draft-generator';
import { AIRefinementOrchestrator } from '../refinement/ai-refinement-orchestrator';
import { CodebaseAnalyzer, CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureTypeDetector } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../prompts/prompt-selector';
import { ConversationManager } from '../../conversation/conversation-manager';
import { PRDBuildingProgressTracker } from '../../tracking/prd-building-progress-tracker';
import { InteractivePromptSystem } from './interactive-prompt-system';
import { PrdSetGenerator } from '../set/generator';
import { ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { Question, Answer } from '../../conversation/types';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { Config } from '../../../config/schema/core';
import { logger } from '../../utils/logger';
import { PatternEntry, ObservationEntry, TestResultExecution } from '../learning/types';

/**
 * Create Mode Options
 */
export interface CreateModeOptions {
  outputDir?: string;
  productionDir?: string; // Production directory for subfolder structure
  setId?: string;
  maxQuestions?: number;
  skipQuestions?: boolean; // Skip questions and generate PRD directly
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
 * Create Mode Result
 */
export interface CreateModeResult {
  prdSetPath: string;
  prd: ParsedPlanningDoc;
  questionsAsked: number;
  answersReceived: number;
  refinement?: any; // RefinementResult from AIRefinementOrchestrator
  executable: boolean;
  summary: string;
}

/**
 * Handles create mode workflow
 */
export class CreateModeHandler {
  private questionGenerator: QuestionGenerator;
  private answerProcessor: AnswerProcessor;
  private prdDraftGenerator: PrdDraftGenerator;
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
    this.interactivePrompts = config.interactivePrompts || new InteractivePromptSystem({});

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

    // Initialize creation services
    // Initialize services with temporary codebase analysis (will be updated after analysis)
    const tempCodebaseAnalysis: CodebaseAnalysisResult = {
      projectRoot: config.projectRoot,
      relevantFiles: [],
      fileContexts: new Map(),
      codebaseContext: '',
      framework: undefined,
      featureTypes: [],
    };

    this.questionGenerator = new QuestionGenerator({
      aiProvider: config.aiProvider,
      aiProviderConfig: config.aiProviderConfig,
      codebaseAnalysis: tempCodebaseAnalysis, // Temporary, will be updated after codebase analysis
      promptSelector: this.promptSelector,
      conversationManager: config.conversationManager,
      maxQuestions: 10,
      debug: this.debug,
    });

    this.answerProcessor = new AnswerProcessor({
      conversationManager: config.conversationManager!,
      debug: this.debug,
    });

    this.prdDraftGenerator = new PrdDraftGenerator({
      aiProvider: config.aiProvider,
      aiProviderConfig: config.aiProviderConfig,
      codebaseAnalysis: tempCodebaseAnalysis, // Temporary, will be updated after codebase analysis
      promptSelector: this.promptSelector,
      conversationManager: config.conversationManager,
      debug: this.debug,
    });

    this.prdSetGenerator = new PrdSetGenerator(this.debug);

    // Refinement orchestrator will be initialized after codebase analysis
    this.refinementOrchestrator = undefined;
  }

  /**
   * Create PRD set from user prompt through interactive questions
   */
  async create(
    initialPrompt: string,
    options: CreateModeOptions = {}
  ): Promise<CreateModeResult> {
    logger.debug(`[CreateModeHandler] Creating PRD set from prompt: ${initialPrompt.substring(0, 50)}...`);

    const maxQuestions = options.maxQuestions || 10;
    const skipQuestions = options.skipQuestions || false;
    const autoApprove = options.autoApprove || false;
    const interactive = options.interactive !== false; // Default to true

    // 1. Analyze codebase (if not skipped)
    logger.debug('[CreateModeHandler] Analyzing codebase');
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
      codebaseAnalysis = await this.codebaseAnalyzer.analyze('create', initialPrompt);
    }

    // 2. Detect feature types from prompt
    logger.debug('[CreateModeHandler] Detecting feature types from prompt');
    const featureTypes = await this.featureTypeDetector.detectFromPrompt(initialPrompt);
    codebaseAnalysis.featureTypes = featureTypes as string[]; // FeatureType[] is assignable to string[]

    // Update services with codebase analysis
    this.questionGenerator = new QuestionGenerator({
      aiProvider: this.aiProvider,
      aiProviderConfig: this.aiProviderConfig,
      codebaseAnalysis,
      promptSelector: this.promptSelector,
      conversationManager: this.conversationManager,
      maxQuestions,
      debug: this.debug,
    });

    this.prdDraftGenerator = new PrdDraftGenerator({
      aiProvider: this.aiProvider,
      aiProviderConfig: this.aiProviderConfig,
      codebaseAnalysis,
      promptSelector: this.promptSelector,
      conversationManager: this.conversationManager,
      debug: this.debug,
    });

    // 3. Create conversation for tracking
    let conversationId: string | undefined;
    if (this.conversationManager) {
      conversationId = await this.conversationManager.createConversation('create', {
        initialPrompt,
        featureTypes,
        framework: codebaseAnalysis.framework,
        codebaseContext: codebaseAnalysis.codebaseContext,
      });
      logger.debug(`[CreateModeHandler] Created conversation: ${conversationId}`);
    }

    let questionsAsked = 0;
    let answersReceived = 0;
    let currentQuestions: Question[] = [];
    let prdDraft: ParsedPlanningDoc | null = null;

    // 4. Generate and ask questions (if not skipped)
    if (!skipQuestions && interactive) {
      logger.debug('[CreateModeHandler] Generating and asking questions');

      // Generate initial questions
      const initialQuestionsResult = await this.questionGenerator.generateInitialQuestions(
        initialPrompt,
        {
          conversationId: conversationId || '',
          mode: 'create',
          initialPrompt,
          codebaseAnalysis,
          featureTypes,
        }
      );

      currentQuestions = initialQuestionsResult.questions;
      questionsAsked += currentQuestions.length;

      // Track progress
      if (this.progressTracker && conversationId) {
        this.progressTracker.trackPRDBuildingProgress(conversationId, 'question-answering', {
          conversationId,
          phase: 'question-answering',
          questionsAsked,
          questionsTotal: maxQuestions,
          answersReceived: 0,
          draftsGenerated: 0,
          refinementsApplied: 0,
          completionPercentage: 0,
        });
      }

      // Ask questions and collect answers
      let iteration = 0;
      const maxIterations = Math.ceil(maxQuestions / (currentQuestions.length || 1));

      while (iteration < maxIterations && currentQuestions.length > 0) {
        for (const question of currentQuestions) {
          if (answersReceived >= maxQuestions) {
            break;
          }

          // Ask question using interactive prompt system
          try {
            const answer = await this.interactivePrompts!.askQuestion(question);

            // Process answer
            if (this.conversationManager && conversationId) {
              const processingResult = await this.answerProcessor.processAnswer(
                conversationId,
                question,
                answer
              );

              if (processingResult.success) {
                answersReceived++;

                // Check for follow-up questions
                if (processingResult.followUpQuestions && processingResult.followUpQuestions.length > 0) {
                  currentQuestions.push(...processingResult.followUpQuestions);
                  questionsAsked += processingResult.followUpQuestions.length;
                }
              }
            }

            // Update progress
            if (this.progressTracker && conversationId) {
              this.progressTracker.trackPRDBuildingProgress(conversationId, 'question-answering', {
                conversationId,
                phase: 'question-answering',
                questionsAsked,
                questionsTotal: maxQuestions,
                answersReceived,
                draftsGenerated: 0,
                refinementsApplied: 0,
                completionPercentage: Math.round((answersReceived / maxQuestions) * 100),
              });
            }
          } catch (error) {
            logger.warn(`[CreateModeHandler] Failed to ask question ${question.id}: ${error}`);
            // Skip question on error
          }
        }

        // Generate follow-up questions if needed
        if (answersReceived < maxQuestions && this.conversationManager && conversationId) {
          const followUpResult = await this.questionGenerator.generateFollowUpQuestions({
            conversationId,
            mode: 'create',
            initialPrompt,
            codebaseAnalysis,
            featureTypes,
            existingQuestions: currentQuestions,
            existingAnswers: this.conversationManager
              ? await this.answerProcessor.extractAnswers(conversationId)
              : new Map(),
            iteration: iteration + 1,
          });

          if (followUpResult.questions.length > 0) {
            currentQuestions = followUpResult.questions;
            questionsAsked += currentQuestions.length;
          } else {
            // No more questions, break
            break;
          }
        }

        iteration++;
      }
    }

    // 5. Generate initial PRD draft from answers
    logger.debug('[CreateModeHandler] Generating initial PRD draft from answers');
    if (!this.conversationManager || !conversationId) {
      throw new Error('Conversation manager required for create mode');
    }

    const draftResult = await this.prdDraftGenerator.generatePrdDraft(
      conversationId,
      initialPrompt
    );

    prdDraft = draftResult.prd;

    // Track progress
    if (this.progressTracker && conversationId) {
      this.progressTracker.trackPRDBuildingProgress(conversationId, 'draft-generation', {
        conversationId,
        phase: 'draft-generation',
        questionsAsked,
        questionsTotal: maxQuestions,
        answersReceived,
        draftsGenerated: 1,
        refinementsApplied: 0,
        completionPercentage: 50,
      });
    }

    // 6. Apply refinement iterations (similar to convert mode)
    logger.debug('[CreateModeHandler] Applying refinement iterations');
    let refinement;
    let executable = false;

    // Initialize refinement orchestrator with project config and learning data
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

    if (prdDraft) {
      refinement = await this.refinementOrchestrator.refine(
        prdDraft,
        {
          conversationId,
          mode: 'create',
          prd: prdDraft,
          codebaseAnalysis,
          featureTypes,
        },
        {
          maxIterations: options.maxIterations || 3,
          autoApprove,
        }
      );

      executable = refinement.executable;
      prdDraft = refinement.prd; // Use refined PRD
    }

    // 7. Generate PRD set files
    logger.debug('[CreateModeHandler] Generating PRD set files');
    const setId = options.setId || prdDraft.prdId || this.generateSetIdFromPrompt(initialPrompt);
    const productionDir = options.productionDir || '.taskmaster/production';
    const outputDir = options.outputDir || path.join(process.cwd(), productionDir);
    
    // If outputDir matches productionDir pattern, create subfolder for PRD set ID
    // Otherwise, use legacy structure
    let prdSetDir: string;
    if (this.isProductionDir(outputDir, productionDir)) {
      // Create subfolder: {productionDir}/{setId}/
      prdSetDir = path.join(outputDir, setId);
      if (this.debug) {
        logger.debug(`[CreateModeHandler] Using production directory structure: ${prdSetDir}`);
      }
    } else {
      // Legacy behavior: {outputDir}/{setId}-prd-set
      prdSetDir = path.join(outputDir, `${setId}-prd-set`);
      if (this.debug) {
        logger.debug(`[CreateModeHandler] Using legacy directory structure: ${prdSetDir}`);
      }
    }
    
    await fs.ensureDir(prdSetDir);

    if (prdDraft) {
      const generatedFiles = await this.prdSetGenerator.generate(prdDraft, prdSetDir, setId);

      // Write generated files
      for (const file of generatedFiles) {
        const filePath = path.join(prdSetDir, file.filename);
        await fs.writeFile(filePath, file.content, 'utf-8');
        logger.debug(`[CreateModeHandler] Generated file: ${filePath}`);
      }
    }

    // 8. Update conversation state
    if (this.conversationManager && conversationId) {
      await this.conversationManager.updateState(conversationId, executable ? 'complete' : 'refining');
    }

    // 9. Save checkpoint
    if (this.progressTracker && conversationId && prdDraft) {
      await this.progressTracker.saveCheckpoint(
        conversationId,
        'create',
        executable ? 'validation' : 'refinement',
        refinement?.iterations || 0,
        prdDraft,
        `Create mode iteration complete`
      );
    }

    // 10. Generate summary
    const summary = this.generateSummary(
      prdDraft || {
        prdId: setId,
        version: '1.0.0',
        status: 'ready',
        title: initialPrompt.substring(0, 50),
        phases: [],
        rawContent: '',
      },
      questionsAsked,
      answersReceived,
      refinement,
      executable
    );

    return {
      prdSetPath: prdSetDir,
      prd: prdDraft || {
        prdId: setId,
        version: '1.0.0',
        status: 'ready',
        title: initialPrompt.substring(0, 50),
        phases: [],
        rawContent: '',
      },
      questionsAsked,
      answersReceived,
      refinement,
      executable,
      summary,
    };
  }

  /**
   * Generate summary
   */
  private generateSummary(
    prd: ParsedPlanningDoc,
    questionsAsked: number,
    answersReceived: number,
    refinement: any,
    executable: boolean
  ): string {
    const parts: string[] = [];

    parts.push(`PRD Set Creation Summary`);
    parts.push(`PRD ID: ${prd.prdId}`);
    parts.push(`Title: ${prd.title}`);
    parts.push('');
    parts.push(`Questions Asked: ${questionsAsked}`);
    parts.push(`Answers Received: ${answersReceived}`);
    parts.push(`Phases: ${prd.phases.length}`);
    const totalTasks = prd.phases.reduce((sum, phase) => sum + (phase.tasks?.length || 0), 0);
    parts.push(`Tasks: ${totalTasks}`);
    parts.push('');

    if (refinement) {
      parts.push('Refinement Results:');
      parts.push(refinement.summary);
      parts.push('');
    }

    parts.push(`Status: ${executable ? '✓ PRD set is 100% executable' : '✗ PRD set needs additional refinement'}`);

    return parts.join('\n');
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
   * Generate PRD set ID from prompt if not provided
   */
  private generateSetIdFromPrompt(prompt: string): string {
    // Extract meaningful words from prompt (first 3-5 words, max 50 chars)
    const words = prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 5)
      .join('-');
    
    // Convert to valid ID format
    return words
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);
  }
}
