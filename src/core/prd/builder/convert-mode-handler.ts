/**
 * Convert Mode Handler
 *
 * Handles convert mode workflow (existing convert-planning-doc functionality).
 * Integrates PlanningDocParser, AIRefinementOrchestrator, ConversationManager, and ProgressTracker.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { PlanningDocParser, ParsedPlanningDoc, ResolvedClarification, ResearchFinding, ConstitutionRules } from '../parser/planning-doc-parser';
import { PrdSetGenerator } from '../set/generator';
import { AIRefinementOrchestrator, RefinementResult } from '../refinement/ai-refinement-orchestrator';
import { CodebaseAnalyzer, CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { FeatureTypeDetector } from '../../analysis/feature-type-detector';
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
import { ConversationManager } from '../../conversation/conversation-manager';
import { PRDBuildingProgressTracker } from '../../tracking/prd-building-progress-tracker';
import { InteractivePromptSystem } from './interactive-prompt-system';
import { ConstitutionParser } from './constitution-parser';
import { filterAndAutoApply } from './speckit-utils';
import { AmbiguityAnalyzer } from './ambiguity-analyzer';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { Config } from '../../../config/schema/core';
import { logger } from '../../utils/logger';
import { PatternEntry, ObservationEntry, TestResultExecution } from '../learning/types';
import { ValidationAutoFixer } from './validation-auto-fixer';
import { Question, ClarificationCategory } from '../../conversation/types';

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
  // Spec-kit integration options
  constitution?: string;       // Path to constitution file (default: .cursorrules)
  skipClarification?: boolean; // Skip clarification phase
  skipResearch?: boolean;      // Skip research phase
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
  private constitutionParser: ConstitutionParser;
  private ambiguityAnalyzer: AmbiguityAnalyzer;
  private aiProvider: AIProvider;
  private aiProviderConfig: AIProviderConfig;
  private debug: boolean;
  private projectRoot: string;
  private patterns: PatternEntry[];
  private observations: ObservationEntry[];

  private projectConfig?: Config;

  constructor(config: {
    projectRoot: string;
    projectConfig?: Config;
    aiProvider: AIProvider;
    aiProviderConfig: AIProviderConfig;
    conversationManager?: ConversationManager;
    progressTracker?: PRDBuildingProgressTracker;
    interactivePrompts?: InteractivePromptSystem;
    patterns?: PatternEntry[];
    observations?: ObservationEntry[];
    debug?: boolean;
  }) {
    this.debug = config.debug || false;
    this.projectRoot = config.projectRoot;
    this.projectConfig = config.projectConfig;
    this.aiProvider = config.aiProvider;
    this.aiProviderConfig = config.aiProviderConfig;
    this.conversationManager = config.conversationManager;
    this.progressTracker = config.progressTracker;
    this.interactivePrompts = config.interactivePrompts;
    this.patterns = config.patterns || [];
    this.observations = config.observations || [];

    // Initialize services
    this.planningParser = new PlanningDocParser(this.debug);
    this.prdSetGenerator = new PrdSetGenerator(this.debug);

    // Initialize constitution parser for spec-kit integration
    this.constitutionParser = new ConstitutionParser({
      projectRoot: config.projectRoot,
      debug: this.debug,
    });

    // Initialize ambiguity analyzer for AI-driven question generation
    this.ambiguityAnalyzer = new AmbiguityAnalyzer({
      aiProvider: config.aiProvider,
      aiProviderConfig: config.aiProviderConfig,
      patterns: this.patterns,
      observations: this.observations,
      debug: this.debug,
    });

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

    // Import build metrics for timing instrumentation
    const { getBuildMetrics } = await import('../../metrics/build');
    const buildMetrics = getBuildMetrics();

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
      const analysisStart = Date.now();
      codebaseAnalysis = await this.codebaseAnalyzer.analyze('convert', parsedDoc.title);
      buildMetrics.recordTiming('codebaseAnalysisMs', Date.now() - analysisStart);
    }

    // 3. Detect feature types
    logger.debug('[ConvertModeHandler] Detecting feature types');
    const featureTypeResult = await this.featureTypeDetector.detectFeatureTypes(codebaseAnalysis);
    codebaseAnalysis.featureTypes = featureTypeResult.featureTypes;

    // ========== SPEC-KIT INTEGRATION PHASES ==========

    // 3a. Load and parse constitution
    logger.debug('[ConvertModeHandler] Loading constitution');
    const constitution = await this.runConstitutionPhase(codebaseAnalysis, options);

    // 3b. Run clarification phase
    const clarifications = await this.runClarificationPhase(parsedDoc, codebaseAnalysis, options);

    // 3c. Run research phase
    const research = await this.runResearchPhase(parsedDoc, codebaseAnalysis, options);

    // 3d. Detect tech stack
    const techStack = await this.codebaseAnalyzer.detectTechStack();

    // 3e. Inject specKit into parsedDoc
    parsedDoc.specKit = {
      constitutionPath: options.constitution || '.cursorrules',
      constitution,
      clarifications,
      research,
      techStack,
    };

    logger.debug(`[ConvertModeHandler] SpecKit: ${clarifications.length} clarifications, ${research.length} research findings`);

    // ========== END SPEC-KIT PHASES ==========

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

    // 5. Refine PRD through iterative enhancements (skip if maxIterations is 0)
    let refinement: any;
    if (options.maxIterations === 0) {
      logger.debug('[ConvertModeHandler] Skipping refinement (maxIterations=0)');
      // Create a minimal refinement result without AI calls
      refinement = {
        prd: parsedDoc,
        schemas: { summary: 'Skipped', schemas: [] },
        tests: { summary: 'Skipped', testPlans: [] },
        features: { summary: 'Skipped', enhancements: [] },
        validation: { executable: false, errors: [], warnings: [] },
        executable: false,
        iterations: 0,
        summary: 'Refinement skipped (maxIterations=0)',
      };
    } else {
      logger.debug('[ConvertModeHandler] Starting refinement iterations');
      refinement = await this.refinementOrchestrator.refine(
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
    }

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

    // File generation with timing
    const fileGenStart = Date.now();
    const generatedFiles = await this.prdSetGenerator.generate(parsedDoc, prdSetDir, setId);

    // Write generated files
    for (const file of generatedFiles) {
      const filePath = path.join(prdSetDir, file.filename);
      await fs.writeFile(filePath, file.content, 'utf-8');
      logger.debug(`[ConvertModeHandler] Generated file: ${filePath}`);
    }
    buildMetrics.recordTiming('fileGenerationMs', Date.now() - fileGenStart);

    // 7. Validate and auto-fix until executable (using shared utility)
    const autoFixer = new ValidationAutoFixer({ debug: this.debug });
    const fixResult = await autoFixer.validateAndAutoFix({
      prdSetDir,
      setId,
      projectConfig: this.projectConfig,
      maxIterations: 5,
      debug: this.debug,
    });

    const isExecutable = fixResult.isExecutable;
    const fixesApplied = fixResult.fixesApplied;

    // Update refinement.executable based on final validation
    refinement.executable = isExecutable;

    // 8. Update conversation state
    if (this.conversationManager && conversationId) {
      await this.conversationManager.updateState(
        conversationId,
        refinement.executable ? 'complete' : 'refining'
      );
    }

    // 9. Write spec-kit intermediate artifacts for audit trail
    if (parsedDoc.specKit) {
      await this.writeIntermediateArtifacts(prdSetDir, parsedDoc.specKit);
    }

    // 10. Generate summary
    const summary = this.generateSummary(parsedDoc, refinement, prdSetDir, setId, fixesApplied);

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
    setId: string,
    fixesApplied?: string[]
  ): string {
    const parts: string[] = [];

    parts.push(`Converted planning document to PRD set: ${setId}`);
    parts.push(`Output directory: ${prdSetPath}`);
    parts.push('');

    parts.push('Refinement Results:');
    parts.push(refinement.summary);
    parts.push('');

    if (fixesApplied && fixesApplied.length > 0) {
      parts.push('Auto-Fixes Applied:');
      fixesApplied.forEach((fix, index) => {
        parts.push(`  ${index + 1}. ${fix}`);
      });
      parts.push('');
    }

    parts.push(`Status: ${refinement.executable ? '✓ PRD set is 100% executable' : '✗ PRD set needs additional refinement'}`);
    
    if (!refinement.executable) {
      parts.push('');
      parts.push('To make executable:');
      parts.push('  1. Review validation errors above');
      parts.push('  2. Run: dev-loop prd-set validate ' + prdSetPath);
      parts.push('  3. Fix remaining issues manually or re-run with refinement');
    }

    return parts.join('\n');
  }

  // ========== SPEC-KIT INTEGRATION METHODS ==========

  /**
   * Load constitution rules from .cursorrules and merge with framework rules
   */
  private async runConstitutionPhase(
    codebaseAnalysis: CodebaseAnalysisResult,
    options: ConvertModeOptions
  ): Promise<ConstitutionRules> {
    try {
      const constitution = await this.constitutionParser.parse(options.constitution);

      // Merge with framework rules if framework detected
      const frameworkPlugin = codebaseAnalysis.frameworkPlugin;
      return this.constitutionParser.mergeWithFramework(constitution, frameworkPlugin);
    } catch (error) {
      logger.debug(`[ConvertModeHandler] Error loading constitution: ${error}`);
      return { constraints: [], patterns: [], avoid: [], codeLocations: [] };
    }
  }

  /**
   * Run clarification phase to generate and resolve spec-kit style questions
   * 
   * Uses spec-kit methodology:
   * 1. Auto-apply high-confidence answers without prompting
   * 2. Only prompt for genuinely ambiguous decisions
   * 3. Generate questions from constitution gaps, not hardcoded lists
   */
  private async runClarificationPhase(
    parsedDoc: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult,
    options: ConvertModeOptions
  ): Promise<ResolvedClarification[]> {
    if (options.skipClarification) {
      logger.debug('[ConvertModeHandler] Skipping clarification phase');
      return [];
    }

    try {
      // Generate clarifying questions using AI-driven ambiguity analysis
      const questions = await this.generateClarifyingQuestions(parsedDoc, codebaseAnalysis);

      if (questions.length === 0) {
        return [];
      }

      const clarifications: ResolvedClarification[] = [];

      // Use shared spec-kit utility to filter and auto-apply high-confidence answers
      const specKitConfig = this.projectConfig?.prdBuilding?.specKit;
      const { autoApplied, needsPrompt, answers } = filterAndAutoApply(
        questions,
        specKitConfig,
        '[ConvertModeHandler]'
      );

      // Convert auto-applied questions to clarifications
      for (const q of autoApplied) {
        clarifications.push({
          question: q.text,
          answer: answers.get(q.id) || 'Auto-inferred from constitution/codebase',
          category: q.category,
          autoApplied: true,
        });
      }

      if (options.autoApprove) {
        // Also auto-apply low-confidence questions in auto-approve mode
        for (const q of needsPrompt) {
          clarifications.push({
            question: q.text,
            answer: q.inferredAnswer || 'Inferred from codebase',
            category: q.category,
            autoApplied: true,
          });
        }
        return clarifications;
      }

      // If interactive and we have prompt system, ask only the low-confidence questions
      if (this.interactivePrompts && options.interactive && needsPrompt.length > 0) {
        logger.info(`[ConvertModeHandler] Prompting for ${needsPrompt.length} question(s)`);
        for (const question of needsPrompt) {
          const answer = await this.interactivePrompts.askQuestion(question);
          clarifications.push({
            question: question.text,
            answer: String(answer),
            category: question.category,
            autoApplied: false,
          });
        }
      } else {
        // Fallback: auto-apply remaining questions
        for (const q of needsPrompt) {
          clarifications.push({
            question: q.text,
            answer: q.inferredAnswer || 'Auto-inferred',
            category: q.category,
            autoApplied: true,
          });
        }
      }

      return clarifications;
    } catch (error) {
      logger.debug(`[ConvertModeHandler] Error in clarification phase: ${error}`);
      return [];
    }
  }

  /**
   * Generate clarifying questions using AI-driven ambiguity analysis
   *
   * Uses spec-kit methodology with AI:
   * 1. Infer parallel execution from dependency analysis (not hardcoded question)
   * 2. Use AI to analyze PRD for genuine ambiguities with full context
   * 3. Only generate questions for decisions that have multiple valid approaches
   */
  private async generateClarifyingQuestions(
    parsedDoc: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<Question[]> {
    // Get spec-kit config
    const specKitConfig = this.projectConfig?.prdBuilding?.specKit;
    const inferParallelFromDependencies = specKitConfig?.inferParallelFromDependencies ?? true;

    // 1. Infer parallel execution from dependencies instead of asking
    if (inferParallelFromDependencies) {
      this.inferParallelExecution(parsedDoc);
      // No question generated - parallel is set automatically based on dependencies
    }

    // 2. Use AI to analyze PRD for genuine ambiguities
    const constitution = parsedDoc.specKit?.constitution;
    const aiQuestions = await this.ambiguityAnalyzer.analyzeAmbiguities(
      parsedDoc,
      codebaseAnalysis,
      constitution
    );

    if (aiQuestions.length > 0) {
      logger.info(`[ConvertModeHandler] AI detected ${aiQuestions.length} ambiguity(ies) requiring clarification`);
    } else {
      logger.info(`[ConvertModeHandler] PRD is explicit - no clarifications needed`);
    }

    return aiQuestions;
  }

  /**
   * Infer parallel execution for phases based on dependency analysis
   * Sets phase.parallel = true for phases without dependencies on previous phases
   */
  private inferParallelExecution(parsedDoc: ParsedPlanningDoc): void {
    // Phase 1 is never parallel (it's the starting point)
    // Phases 2+ can be parallel if they don't depend on previous phase completion
    
    for (let i = 1; i < parsedDoc.phases.length; i++) {
      const phase = parsedDoc.phases[i];
      const prevPhase = parsedDoc.phases[i - 1];
      
      // Check if this phase depends on outputs from previous phase
      const hasDependency = this.phaseHasDependencyOn(phase, prevPhase);
      
      // Set parallel = true if no dependency detected
      if (!hasDependency) {
        phase.parallel = true;
        logger.debug(`[ConvertModeHandler] Phase "${phase.name}" set to parallel (no dependency on previous phase)`);
      } else {
        phase.parallel = false;
        logger.debug(`[ConvertModeHandler] Phase "${phase.name}" set to sequential (depends on previous phase)`);
      }
    }
  }

  /**
   * Check if a phase has dependencies on a previous phase
   */
  private phaseHasDependencyOn(phase: any, prevPhase: any): boolean {
    // Simple heuristic: check if phase mentions files or outputs from previous phase
    const phaseText = JSON.stringify(phase).toLowerCase();
    const prevPhaseName = (prevPhase.name || '').toLowerCase();
    
    // Check for explicit dependency markers
    if (phaseText.includes('after phase') || phaseText.includes('depends on')) {
      return true;
    }
    
    // Check if phase references previous phase by name
    if (prevPhaseName && phaseText.includes(prevPhaseName)) {
      return true;
    }
    
    // Check for file output dependencies
    const prevOutputFiles = this.extractTargetFiles(prevPhase);
    const currInputFiles = this.extractReferencedFiles(phase);
    
    // If current phase references files created in previous phase, there's a dependency
    for (const inputFile of currInputFiles) {
      if (prevOutputFiles.some(outFile => inputFile.includes(outFile) || outFile.includes(inputFile))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Extract target files from a phase
   */
  private extractTargetFiles(phase: any): string[] {
    const files: string[] = [];
    for (const task of phase.tasks || []) {
      if (task.targetFiles) {
        files.push(...task.targetFiles);
      }
      if (task.files) {
        files.push(...task.files);
      }
    }
    return files.map(f => path.basename(f));
  }

  /**
   * Extract referenced files from a phase (files mentioned in descriptions)
   */
  private extractReferencedFiles(phase: any): string[] {
    const text = JSON.stringify(phase);
    const filePattern = /[\w-]+\.(php|ts|js|yml|yaml|json|md)/g;
    const matches = text.match(filePattern) || [];
    return [...new Set(matches)];
  }

  /**
   * Run research phase to gather tech stack findings for tasks
   */
  private async runResearchPhase(
    parsedDoc: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult,
    options: ConvertModeOptions
  ): Promise<ResearchFinding[]> {
    if (options.skipResearch) {
      logger.debug('[ConvertModeHandler] Skipping research phase');
      return [];
    }

    try {
      const allFindings: ResearchFinding[] = [];

      // Generate research for each phase/task
      for (const phase of parsedDoc.phases) {
        for (const task of phase.tasks || []) {
          const findings = await this.codebaseAnalyzer.generateResearchForTask(task);
          allFindings.push(...findings);
        }
      }

      // Deduplicate by topic
      const uniqueFindings = new Map<string, ResearchFinding>();
      for (const f of allFindings) {
        if (!uniqueFindings.has(f.topic)) {
          uniqueFindings.set(f.topic, f);
        }
      }

      const results = Array.from(uniqueFindings.values());
      logger.debug(`[ConvertModeHandler] Generated ${results.length} unique research findings`);
      return results;
    } catch (error) {
      logger.debug(`[ConvertModeHandler] Error in research phase: ${error}`);
      return [];
    }
  }

  /**
   * Write intermediate artifacts for audit trail
   */
  async writeIntermediateArtifacts(
    prdSetPath: string,
    specKit: ParsedPlanningDoc['specKit']
  ): Promise<void> {
    if (!specKit) return;

    const artifactsDir = path.join(prdSetPath, '.speckit');
    await fs.ensureDir(artifactsDir);

    // Write clarifications
    if (specKit.clarifications?.length) {
      await fs.writeJson(
        path.join(artifactsDir, 'clarifications.json'),
        specKit.clarifications,
        { spaces: 2 }
      );
    }

    // Write research
    if (specKit.research?.length) {
      await fs.writeJson(
        path.join(artifactsDir, 'research.json'),
        specKit.research,
        { spaces: 2 }
      );
    }

    // Write constitution (parsed)
    if (specKit.constitution) {
      await fs.writeJson(
        path.join(artifactsDir, 'constitution.json'),
        specKit.constitution,
        { spaces: 2 }
      );
    }

    logger.debug(`[ConvertModeHandler] Wrote spec-kit artifacts to ${artifactsDir}`);
  }
}
