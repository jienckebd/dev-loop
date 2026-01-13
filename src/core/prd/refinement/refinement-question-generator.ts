/**
 * Refinement Question Generator
 *
 * Generates context-aware questions before, during, and after refinement phases.
 * Questions are based on codebase analysis results and help guide refinement.
 */

import { ParsedPlanningDoc } from '../parser/planning-doc-parser';
import { CodebaseAnalysisResult } from '../../analysis/codebase-analyzer';
import { ExecutabilityValidationResult } from './executability-validator';
import { CodebaseInsight } from './codebase-insight-extractor';
import { Question, QuestionType, Answer, ClarificationCategory } from '../../conversation/types';
import { logger } from '../../utils/logger';
import { TextGenerationAdapter, TextGenerationOptions } from './text-generation-adapter';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
import { FrameworkPlugin } from '../../../frameworks';
import { Config } from '../../../config/schema/core';
import { PatternEntry, ObservationEntry } from '../learning/types';

/**
 * Refinement question type (different from QuestionType which is the UI control type)
 */
export type RefinementQuestionType = 'clarifying' | 'codebase-focused' | 'prioritization';

/**
 * Refinement phase
 */
export type RefinementPhase = 'schema' | 'test' | 'feature';

/**
 * Refinement Question - extends base Question with refinement-specific fields.
 * Inherits spec-kit fields: confidence, inferredAnswer, inferenceSource, category
 */
export interface RefinementQuestion extends Question {
  /** Refinement-specific question type (different from Question.type which is QuestionType) */
  refinementType: RefinementQuestionType;
  /** Which refinement phase this question applies to */
  phase: RefinementPhase;
  /** Additional guidance for the user */
  hint?: string;
}

/**
 * Question Generation Context
 */
export interface QuestionGenerationContext {
  phase: 'schema' | 'test' | 'feature';
  prd: ParsedPlanningDoc;
  codebaseAnalysis: CodebaseAnalysisResult;
  insights?: CodebaseInsight[];
  existingEnhancements?: any;
  partialResults?: any;
  validation?: ExecutabilityValidationResult;
}

/**
 * Refinement Question Generator Configuration
 */
export interface RefinementQuestionGeneratorConfig {
  aiProvider: AIProvider;
  aiProviderConfig: AIProviderConfig;
  promptSelector: PromptSelector;
  projectConfig?: Config; // Project configuration from devloop.config.js
  // Learning data from JSON files (for context-aware questions)
  patterns?: PatternEntry[]; // Loaded patterns from patterns.json (filtered)
  observations?: ObservationEntry[]; // Loaded observations from observations.json (filtered)
  debug?: boolean;
}

/**
 * Generates context-aware questions for refinement phases
 */
export class RefinementQuestionGenerator {
  private config: RefinementQuestionGeneratorConfig;
  private textGenerator: TextGenerationAdapter;
  private debug: boolean;
  private patterns: PatternEntry[] = [];
  private observations: ObservationEntry[] = [];

  constructor(config: RefinementQuestionGeneratorConfig) {
    this.config = config;
    this.debug = config.debug || false;
    this.patterns = config.patterns || [];
    this.observations = config.observations || [];
    this.textGenerator = new TextGenerationAdapter(
      config.aiProvider,
      config.aiProviderConfig,
      this.debug
    );

    if (this.debug && (this.patterns.length > 0 || this.observations.length > 0)) {
      logger.debug(`[RefinementQuestionGenerator] Initialized with ${this.patterns.length} patterns and ${this.observations.length} observations`);
    }
  }

  /**
   * Generate questions before a refinement phase
   */
  async generatePrePhaseQuestions(
    phase: 'schema' | 'test' | 'feature',
    prd: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult,
    insights: CodebaseInsight[] = [],
    existingEnhancements?: any,
    validationGaps?: ExecutabilityValidationResult
  ): Promise<RefinementQuestion[]> {
    logger.debug(`[RefinementQuestionGenerator] Generating pre-phase questions for ${phase}`);

    const questions: RefinementQuestion[] = [];

    // 1. Framework-specific questions (from framework plugin methods)
    // CRITICAL: Always prioritize configured framework.type over detected plugin
    // Even if CompositePlugin is detected, use configured framework for questions
    const configuredFrameworkType = this.config.projectConfig?.framework?.type;
    if (codebaseAnalysis.frameworkPlugin) {
      // If CompositePlugin detected but framework.type is configured, use configured type
      if (codebaseAnalysis.frameworkPlugin.name === 'composite' && configuredFrameworkType && configuredFrameworkType !== 'composite') {
        logger.warn(
          `[RefinementQuestionGenerator] CompositePlugin detected but framework.type='${configuredFrameworkType}' is configured. ` +
          `Using configured framework type '${configuredFrameworkType}' for questions instead of composite.`
        );
        // For composite, we still generate questions but they'll prioritize configured framework
      }
      
      const frameworkQuestions = this.generateFrameworkQuestions(
        phase,
        codebaseAnalysis.frameworkPlugin,
        codebaseAnalysis,
      );
      questions.push(...frameworkQuestions);
    } else if (configuredFrameworkType && configuredFrameworkType !== 'composite') {
      // Framework not detected but configured - still ask about configured framework
      logger.debug(`[RefinementQuestionGenerator] No framework plugin detected but framework.type='${configuredFrameworkType}' is configured. Generating questions for configured framework.`);
      questions.push({
        id: `configured-framework-${phase}`,
        refinementType: 'codebase-focused',
        type: 'multiple-choice',
        phase,
        text: `The project is configured to use ${configuredFrameworkType} framework. Should I generate ${configuredFrameworkType}-specific ${phase} configurations?`,
        options: [
          `Yes, use ${configuredFrameworkType} framework patterns (recommended)`,
          'Use generic patterns',
          'Show framework options',
        ],
        required: phase === 'test' || phase === 'schema', // Required for test and schema phases
        context: `Configured framework: ${configuredFrameworkType} (from devloop.config.js framework.type)`,
        hint: `${configuredFrameworkType} framework is explicitly configured in project config`,
      });
    }

    // 2. Codebase-focused questions (using semantic insights and project config)
    const codebaseQuestions = this.generateCodebaseFocusedQuestions(
      phase,
      codebaseAnalysis,
      insights,
      this.config.projectConfig
    );
    questions.push(...codebaseQuestions);

    // 3. Questions based on learned patterns and observations (if available)
    const learningQuestions = this.generateLearningBasedQuestions(
      phase,
      prd,
      codebaseAnalysis
    );
    questions.push(...learningQuestions);

    // 3. Test generation config questions (from testGeneration section)
    if (phase === 'test' && this.config.projectConfig?.testGeneration) {
      const testConfigQuestions = this.generateTestConfigQuestions(
        this.config.projectConfig.testGeneration,
        codebaseAnalysis,
      );
      questions.push(...testConfigQuestions);
    }

    // Generate clarifying questions based on PRD content
    const clarifyingQuestions = this.generateClarifyingQuestions(phase, prd, codebaseAnalysis);
    questions.push(...clarifyingQuestions);

    // Generate prioritization questions
    const prioritizationQuestions = this.generatePrioritizationQuestions(phase, prd, codebaseAnalysis);
    questions.push(...prioritizationQuestions);

    // Use AI to generate additional context-aware questions if needed
    if (questions.length < 3 && !this.config.debug) {
      const aiQuestions = await this.generateAIQuestions(
        phase,
        prd,
        codebaseAnalysis,
        insights,
        questions
      );
      questions.push(...aiQuestions);
    }

    // Limit to 5-7 questions per phase to avoid overwhelming the user
    return questions.slice(0, 7);
  }

  /**
   * Generate questions during a refinement phase (mid-phase)
   */
  async generateMidPhaseQuestions(
    phase: 'schema' | 'test' | 'feature',
    partialResults: any,
    codebaseAnalysis: CodebaseAnalysisResult,
    insights: CodebaseInsight[] = []
  ): Promise<RefinementQuestion[]> {
    logger.debug(`[RefinementQuestionGenerator] Generating mid-phase questions for ${phase}`);

    const questions: RefinementQuestion[] = [];

    // Check if partial results have low confidence or need clarification
    if (phase === 'schema' && partialResults.schemas) {
      const lowConfidenceSchemas = partialResults.schemas.filter(
        (s: any) => s.confidence < 0.7
      );
      if (lowConfidenceSchemas.length > 0) {
        questions.push({
          id: `mid-${phase}-low-confidence`,
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase,
          text: `Found ${lowConfidenceSchemas.length} schema(s) with low confidence. Should I refine them using codebase patterns?`,
          options: ['Yes, refine using patterns', 'No, generate from scratch', 'Show me the patterns first'],
          required: false,
          context: `Low confidence schemas: ${lowConfidenceSchemas.map((s: any) => s.id).join(', ')}`,
        });
      }
    }

    if (phase === 'test' && partialResults.testPlans) {
      const lowCoverageTasks = partialResults.testPlans.filter(
        (tp: any) => tp.testCases.length < 2
      );
      if (lowCoverageTasks.length > 0) {
        questions.push({
          id: `mid-${phase}-low-coverage`,
          refinementType: 'clarifying',
          type: 'multiple-choice',
          phase,
          text: `Found ${lowCoverageTasks.length} task(s) with minimal test coverage. Should I add more test cases?`,
          options: ['Yes, add more cases', 'No, keep minimal', 'Show me existing test patterns'],
          required: false,
          context: `Low coverage tasks: ${lowCoverageTasks.map((tp: any) => tp.taskId).join(', ')}`,
        });
      }
    }

    return questions;
  }

  /**
   * Generate questions after a refinement phase (post-phase)
   */
  async generatePostPhaseQuestions(
    phase: 'schema' | 'test' | 'feature',
    results: any,
    validation: ExecutabilityValidationResult,
    codebaseAnalysis: CodebaseAnalysisResult
  ): Promise<RefinementQuestion[]> {
    logger.debug(`[RefinementQuestionGenerator] Generating post-phase questions for ${phase}`);

    const questions: RefinementQuestion[] = [];

    // Ask what to refine based on validation results
    if (validation.errors.length > 0) {
      const phaseErrors = validation.errors.filter(
        e => (phase === 'schema' && e.type === 'missing-schema') ||
             (phase === 'test' && e.type === 'missing-test') ||
             (phase === 'feature' && e.type === 'missing-config')
      );

      if (phaseErrors.length > 0) {
        questions.push({
          id: `post-${phase}-errors`,
          refinementType: 'prioritization',
          type: 'multi-select',
          phase,
          text: `Found ${phaseErrors.length} issue(s) in ${phase} enhancement. Which should be refined?`,
          options: phaseErrors.map(e => `${e.severity}: ${e.message}`),
          required: false,
          context: `Validation errors: ${phaseErrors.map(e => e.message).join('; ')}`,
          hint: 'Select items to refine, or choose to continue with current results',
        });
      }
    }

    // Ask about low-confidence or incomplete results
    if (phase === 'schema' && results.schemas) {
      const incompleteSchemas = results.schemas.filter(
        (s: any) => !s.content || s.content.trim().length < 100
      );
      if (incompleteSchemas.length > 0) {
        questions.push({
          id: `post-${phase}-incomplete`,
          refinementType: 'prioritization',
          type: 'multi-select',
          phase,
          text: `Found ${incompleteSchemas.length} incomplete schema(s). Should I refine them?`,
          options: incompleteSchemas.map((s: any) => s.id),
          required: false,
          context: `Incomplete schemas: ${incompleteSchemas.map((s: any) => s.id).join(', ')}`,
        });
      }
    }

    if (phase === 'test' && results.testPlans) {
      const incompletePlans = results.testPlans.filter(
        (tp: any) => !tp.testCases || tp.testCases.length === 0
      );
      if (incompletePlans.length > 0) {
        questions.push({
          id: `post-${phase}-incomplete`,
          refinementType: 'prioritization',
          type: 'multi-select',
          phase,
          text: `Found ${incompletePlans.length} test plan(s) without test cases. Should I generate test cases for them?`,
          options: incompletePlans.map((tp: any) => `${tp.taskId}: ${tp.description}`),
          required: false,
          context: `Incomplete plans: ${incompletePlans.map((tp: any) => tp.taskId).join(', ')}`,
        });
      }
    }

    return questions;
  }

  /**
   * Generate framework-specific questions using framework plugin methods
   */
  private generateFrameworkQuestions(
    phase: 'schema' | 'test' | 'feature',
    frameworkPlugin: FrameworkPlugin,
    codebaseAnalysis: CodebaseAnalysisResult
  ): RefinementQuestion[] {
    const questions: RefinementQuestion[] = [];

    // CRITICAL: Prioritize configured framework type over detected plugin name
    // If CompositePlugin is detected but framework.type is configured, use configured type
    const configuredFrameworkType = this.config.projectConfig?.framework?.type;
    const detectedFrameworkName = frameworkPlugin.name;
    const frameworkName = (configuredFrameworkType && configuredFrameworkType !== 'composite') 
      ? configuredFrameworkType 
      : (detectedFrameworkName !== 'composite' ? detectedFrameworkName : 'generic');

    // If CompositePlugin but framework is configured, log warning
    if (detectedFrameworkName === 'composite' && configuredFrameworkType && configuredFrameworkType !== 'composite') {
      logger.warn(
        `[RefinementQuestionGenerator] CompositePlugin detected but framework.type='${configuredFrameworkType}' is configured. ` +
        `Using configured framework type for questions instead of composite.`
      );
    }

    // Extract code quality tools, tech debt indicators, recommendation patterns
    // CRITICAL: For CompositePlugin, if configured framework type is set, try to get tools from that specific plugin
    let codeQualityTools: any[] = [];
    let techDebtIndicators: any[] = [];
    let recommendationPatterns: any[] = [];
    
    // If CompositePlugin detected but framework type is configured, try to get tools from the configured framework's plugin
    if (detectedFrameworkName === 'composite' && configuredFrameworkType && configuredFrameworkType !== 'composite') {
      // Check if CompositePlugin has the configured framework as a child
      if ('hasFramework' in frameworkPlugin && typeof frameworkPlugin.hasFramework === 'function') {
        if (frameworkPlugin.hasFramework(configuredFrameworkType)) {
          logger.debug(`[RefinementQuestionGenerator] CompositePlugin includes configured framework '${configuredFrameworkType}', extracting tools from that plugin`);
          // Get child plugin for configured framework
          if ('getChildPlugins' in frameworkPlugin && typeof frameworkPlugin.getChildPlugins === 'function') {
            const childPlugins = frameworkPlugin.getChildPlugins();
            const configuredPlugin = childPlugins.find((p: any) => p.name === configuredFrameworkType);
            if (configuredPlugin) {
              codeQualityTools = configuredPlugin.getCodeQualityTools?.() || [];
              techDebtIndicators = configuredPlugin.getTechDebtIndicators?.() || [];
              recommendationPatterns = configuredPlugin.getRecommendationPatterns?.() || [];
            }
          }
        }
      }
    }
    
    // If no tools found from configured framework, fall back to merged tools from CompositePlugin or single plugin
    if (codeQualityTools.length === 0 && techDebtIndicators.length === 0) {
      codeQualityTools = frameworkPlugin.getCodeQualityTools?.() || [];
      techDebtIndicators = frameworkPlugin.getTechDebtIndicators?.() || [];
      recommendationPatterns = frameworkPlugin.getRecommendationPatterns?.() || [];
    }

    if (phase === 'schema') {
      // Ask about code quality tools for schema validation
      // Use configured framework name if available, otherwise use detected
      if (codeQualityTools.length > 0) {
        const schemaTools = codeQualityTools.filter(t => t.purpose === 'static-analysis' || t.purpose === 'tech-debt');
        if (schemaTools.length > 0) {
          questions.push({
            id: 'schema-quality-tools',
            refinementType: 'codebase-focused',
            type: 'multiple-choice',
            phase: 'schema',
            text: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `${configuredFrameworkType} framework provides ${schemaTools.length} code quality tool(s) (${schemaTools.map(t => t.name).join(', ')}). Should I use these to validate generated schemas?`
              : `Framework ${frameworkName} provides ${schemaTools.length} code quality tool(s) (${schemaTools.map(t => t.name).join(', ')}). Should I use these to validate generated schemas?`,
            options: ['Yes, validate with tools', 'No, skip validation', 'Show tool details'],
            required: false,
            context: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `Configured framework: ${configuredFrameworkType}, Available tools: ${schemaTools.map(t => `${t.name} (${t.purpose})`).join(', ')}`
              : `Framework: ${frameworkName}, Available tools: ${schemaTools.map(t => `${t.name} (${t.purpose})`).join(', ')}`,
            // SPEC-KIT FIELDS - auto-apply: framework provides tools, always use them
            confidence: 0.95,
            inferredAnswer: 'Yes, validate with tools',
            inferenceSource: 'Framework provides code quality tools - always use them',
            category: 'implementation',
          });
        }
      }

      // Ask about tech debt indicators
      if (techDebtIndicators.length > 0) {
        const schemaDebt = techDebtIndicators.filter(t => t.category === 'deprecated-api' || t.category === 'obsolete-pattern');
        if (schemaDebt.length > 0) {
          questions.push({
            id: 'schema-tech-debt',
            refinementType: 'codebase-focused',
            type: 'confirm',
            phase: 'schema',
            text: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `${configuredFrameworkType} framework has ${schemaDebt.length} tech debt indicator(s) for deprecated patterns. Should I avoid these patterns in generated schemas?`
              : `Framework ${frameworkName} has ${schemaDebt.length} tech debt indicator(s) for deprecated patterns. Should I avoid these patterns in generated schemas?`,
            options: ['Yes, avoid deprecated patterns', 'No, allow all patterns', 'Show deprecated patterns'],
            required: false,
            context: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `Configured framework: ${configuredFrameworkType}, Deprecated patterns: ${schemaDebt.map(t => t.description).join('; ')}`
              : `Framework: ${frameworkName}, Deprecated patterns: ${schemaDebt.map(t => t.description).join('; ')}`,
            // SPEC-KIT FIELDS - auto-apply: always avoid deprecated APIs
            confidence: 0.99,
            inferredAnswer: 'Yes, avoid deprecated patterns',
            inferenceSource: 'Best practice: always avoid deprecated APIs and obsolete patterns',
            category: 'implementation',
          });
        }
      }
    }

    if (phase === 'test') {
      // Ask about test framework patterns from framework plugin
      // For Playwright/Drupal projects, prioritize configured test framework
      // Note: testGeneration may be under metrics, autonomous, or top-level depending on config structure
      const testGenConfig = (this.config.projectConfig as any)?.testGeneration || (this.config.projectConfig as any)?.metrics?.testGeneration || (this.config.projectConfig as any)?.autonomous?.testGeneration;
      const configuredTestFramework = testGenConfig?.framework;
      
      const testTools = codeQualityTools.filter(t => t.purpose === 'tech-debt' && t.name.toLowerCase().includes('test'));
      if (testTools.length > 0 || frameworkPlugin.getTestTemplate || (configuredFrameworkType && configuredFrameworkType !== 'composite')) {
        questions.push({
          id: 'test-framework-template',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'test',
          text: configuredFrameworkType && configuredFrameworkType !== 'composite' && configuredTestFramework
            ? `${configuredFrameworkType} project uses ${configuredTestFramework} for testing. Should I generate ${configuredTestFramework} E2E test plans following ${configuredFrameworkType} patterns?`
            : configuredFrameworkType && configuredFrameworkType !== 'composite'
            ? `${configuredFrameworkType} framework provides test templates and patterns. Should I use ${configuredFrameworkType}-specific test patterns?`
            : `Framework ${frameworkName} provides test templates and patterns. Should I use framework-specific test patterns?`,
          options: configuredFrameworkType && configuredFrameworkType !== 'composite' && configuredTestFramework
            ? [
                `Yes, generate ${configuredTestFramework} E2E tests for ${configuredFrameworkType} (recommended)`,
                'Use generic test patterns',
                'Show test framework options',
              ]
            : ['Yes, use framework patterns', 'No, use generic patterns', 'Show framework test template'],
          required: configuredFrameworkType && configuredFrameworkType !== 'composite' ? true : false,
          context: configuredFrameworkType && configuredFrameworkType !== 'composite'
            ? `Configured framework: ${configuredFrameworkType}${configuredTestFramework ? `, Test framework: ${configuredTestFramework}` : ''}`
            : `Framework: ${frameworkName}`,
          hint: configuredFrameworkType && configuredFrameworkType !== 'composite' && configuredTestFramework
            ? `${configuredFrameworkType} + ${configuredTestFramework} is configured in project config - recommended for this project`
            : undefined,
          // SPEC-KIT FIELDS - auto-apply if framework is configured
          confidence: configuredFrameworkType && configuredFrameworkType !== 'composite' ? 0.9 : 0.7,
          inferredAnswer: configuredFrameworkType && configuredFrameworkType !== 'composite' && configuredTestFramework
            ? `Yes, generate ${configuredTestFramework} E2E tests for ${configuredFrameworkType} (recommended)`
            : 'Yes, use framework patterns',
          inferenceSource: configuredFrameworkType && configuredFrameworkType !== 'composite'
            ? `Framework ${configuredFrameworkType} is explicitly configured - use its patterns`
            : 'Framework detected - using framework-specific patterns',
          category: 'implementation',
        });
      }
    }

    if (phase === 'feature') {
      // Ask about recommendation patterns for new features
      if (recommendationPatterns.length > 0) {
        const featureRecommendations = recommendationPatterns.filter(r => r.recommendationType === 'config-schema' || r.recommendationType === 'new-plugin');
        if (featureRecommendations.length > 0) {
          questions.push({
            id: 'feature-recommendations',
            refinementType: 'codebase-focused',
            type: 'multiple-choice',
            phase: 'feature',
            text: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `${configuredFrameworkType} framework suggests ${featureRecommendations.length} pattern(s) for new features. Should I follow these recommendations?`
              : `Framework ${frameworkName} suggests ${featureRecommendations.length} pattern(s) for new features. Should I follow these recommendations?`,
            options: ['Yes, use recommendations', 'No, create from scratch', 'Show recommendations'],
            required: false,
            context: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `Configured framework: ${configuredFrameworkType}, Recommendations: ${featureRecommendations.map(r => r.description).join('; ')}`
              : `Framework: ${frameworkName}, Recommendations: ${featureRecommendations.map(r => r.description).join('; ')}`,
            // SPEC-KIT FIELDS - auto-apply: follow framework recommendations
            confidence: 0.85,
            inferredAnswer: 'Yes, use recommendations',
            inferenceSource: 'Framework provides recommendations - best practice to follow them',
            category: 'implementation',
          });
        }
      }
    }

    return questions;
  }

  /**
   * Generate test generation config questions
   */
  private generateTestConfigQuestions(
    testGenerationConfig: NonNullable<Config['testGeneration']>,
    codebaseAnalysis: CodebaseAnalysisResult
  ): RefinementQuestion[] {
    const questions: RefinementQuestion[] = [];

    // Note: testGeneration config structure varies - handle both top-level and autonomous.testGeneration types
    const testGenConfig = testGenerationConfig as any;
    
    // Reference actual test framework from config (prioritize configured framework)
    let testFramework = testGenConfig.framework;
    
    // If framework not explicitly set, infer from testDir or other config
    if (!testFramework) {
      const testDir = testGenConfig.testDir || '';
      if (testDir.includes('playwright')) {
        testFramework = 'playwright';
      } else if (testDir.includes('cypress')) {
        testFramework = 'cypress';
      } else if (testDir.includes('jest') || testDir.includes('vitest')) {
        testFramework = 'jest';
      } else {
        // Fallback: check imports for framework hints
        const imports = testGenConfig.imports || [];
        if (imports.some((imp: string) => imp.includes('@playwright/test'))) {
          testFramework = 'playwright';
        } else if (imports.some((imp: string) => imp.includes('cypress'))) {
          testFramework = 'cypress';
        } else {
          testFramework = 'playwright'; // Default to playwright for this project
        }
      }
    }

    const testDir = testGenConfig.testDir || 'tests/playwright/auto';
    const helperMethods = testGenConfig.helperMethodSignatures || {};
    const isolationRules = testGenConfig.isolationRules || [];

    // CRITICAL: Framework and directory question - prioritize configured Playwright framework
    if (testFramework && testDir) {
      const defaultOption = Object.keys(helperMethods).length > 0
        ? `Use ${Object.keys(helperMethods)[0]} helper method from wizard-helper.ts`
        : `Generate ${testFramework} E2E tests following project patterns`;
      questions.push({
        id: 'test-framework-pattern',
        refinementType: 'codebase-focused',
        type: 'multiple-choice',
        phase: 'test',
        text: `The project uses ${testFramework} tests in ${testDir}. Should I generate ${testFramework} E2E test plans following the project's test patterns?`,
        options: Object.keys(helperMethods).length > 0
          ? Object.keys(helperMethods).slice(0, 5).map(m => `Use ${m} helper method from wizard-helper.ts`).concat([
              'Use existing test patterns from tests/playwright/auto/',
              'Generate new test structure',
            ])
          : [
              `Generate ${testFramework} E2E tests following project patterns`,
              'Use existing test structure from tests/playwright/auto/',
              'Generate new test structure',
            ],
        required: true,
        context: `Test framework: ${testFramework}, Test directory: ${testDir}, Framework: ${codebaseAnalysis.framework || 'Drupal'}`,
        hint: Object.keys(helperMethods).length > 0
          ? `Available helper methods from wizard-helper.ts: ${Object.keys(helperMethods).slice(0, 3).join(', ')}${Object.keys(helperMethods).length > 3 ? '...' : ''}`
          : `Tests should be placed in ${testDir} using ${testFramework} framework`,
        // SPEC-KIT FIELDS - auto-apply: use configured test framework
        confidence: 0.9,
        inferredAnswer: defaultOption,
        inferenceSource: `Test framework ${testFramework} is configured - use project patterns`,
        category: 'implementation',
      });
    }

    // Test isolation rules question (critical for Drupal/Playwright tests)
    if (isolationRules.length > 0) {
      questions.push({
        id: 'test-isolation',
        refinementType: 'codebase-focused',
        type: 'multiple-choice',
        phase: 'test',
        text: `CRITICAL: The project has ${isolationRules.length} test isolation rule(s) to prevent test pollution. Should I enforce these rules in generated test plans?`,
        options: [
          'Yes, enforce all isolation rules (recommended)',
          'Show me the isolation rules first',
          'No, skip isolation checks (not recommended)',
        ],
        required: true,
        context: `Test isolation is CRITICAL for ${testFramework} tests - prevents test pollution and site breakage`,
        hint: `First rule: ${isolationRules[0]?.substring(0, 100)}${isolationRules[0]?.length > 100 ? '...' : ''}`,
        // SPEC-KIT FIELDS - auto-apply: always enforce isolation rules
        confidence: 0.95,
        inferredAnswer: 'Yes, enforce all isolation rules (recommended)',
        inferenceSource: 'Test isolation rules are configured - always enforce them',
        category: 'testing',
      });
    }

    return questions;
  }

  /**
   * Generate codebase-focused questions
   */
  private generateCodebaseFocusedQuestions(
    phase: 'schema' | 'test' | 'feature',
    codebaseAnalysis: CodebaseAnalysisResult,
    insights: CodebaseInsight[],
    projectConfig?: Config
  ): RefinementQuestion[] {
    const questions: RefinementQuestion[] = [];

    if (phase === 'schema') {
      // Schema-specific codebase questions
      const schemaFiles = insights.filter(i => i.type === 'schema' || i.type === 'file').length;
      if (schemaFiles > 0) {
        questions.push({
          id: 'schema-pattern-follow',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'schema',
          text: `I found ${schemaFiles} existing schema file(s) in the codebase. Should I follow these patterns when generating new schemas?`,
          options: ['Yes, use existing patterns', 'No, create new patterns', 'Show me the existing schemas first'],
          required: false,
          context: `Found ${schemaFiles} schema-related files`,
          // SPEC-KIT FIELDS - auto-apply: follow existing patterns
          confidence: 0.9,
          inferredAnswer: 'Yes, use existing patterns',
          inferenceSource: 'Existing schema patterns found - follow codebase conventions',
          category: 'implementation',
        });
      }

      if (codebaseAnalysis.schemaPatterns && codebaseAnalysis.schemaPatterns.length > 0) {
        questions.push({
          id: 'schema-pattern-type',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'schema',
          text: `I detected schema pattern: ${codebaseAnalysis.schemaPatterns[0].type}. Should I use this pattern?`,
          options: ['Yes, use this pattern', 'No, use different pattern', 'Ask for each schema'],
          required: false,
          context: `Pattern: ${codebaseAnalysis.schemaPatterns[0].pattern}`,
          hint: codebaseAnalysis.schemaPatterns[0].examples?.[0],
          // SPEC-KIT FIELDS - auto-apply: use detected patterns
          confidence: 0.85,
          inferredAnswer: 'Yes, use this pattern',
          inferenceSource: 'Schema pattern detected in codebase - follow existing conventions',
          category: 'implementation',
        });
      }

      // Reference framework-specific schema patterns from config
      if (projectConfig?.framework?.prdGeneration?.scenarios?.schema) {
        const schemaScenarios = projectConfig.framework.prdGeneration.scenarios.schema;
        if (schemaScenarios.patterns && schemaScenarios.patterns.length > 0) {
          questions.push({
            id: 'schema-framework-patterns',
            refinementType: 'codebase-focused',
            type: 'multiple-choice',
            phase: 'schema',
            text: `Framework provides ${schemaScenarios.patterns.length} schema pattern(s): ${schemaScenarios.patterns.slice(0, 2).join(', ')}${schemaScenarios.patterns.length > 2 ? '...' : ''}. Should I use these patterns?`,
            options: ['Yes, use framework patterns', 'No, use codebase patterns', 'Show all patterns'],
            required: false,
            context: `Framework patterns: ${schemaScenarios.patterns.join(', ')}`,
            // SPEC-KIT FIELDS - auto-apply: use framework patterns
            confidence: 0.9,
            inferredAnswer: 'Yes, use framework patterns',
            inferenceSource: 'Framework provides schema patterns - use them',
            category: 'implementation',
          });
        }
      }
    }

    if (phase === 'test') {
      // Test-specific codebase questions with project config
      const testFiles = codebaseAnalysis.relevantFiles.filter(
        f => f.includes('test') || f.includes('spec')
      ).length;

      if (testFiles > 0) {
        questions.push({
          id: 'test-pattern-follow',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'test',
          text: `I found ${testFiles} existing test file(s). Should I follow the same test structure and patterns?`,
          options: ['Yes, use existing patterns', 'No, create new structure', 'Show me test examples'],
          required: false,
          context: `Found ${testFiles} test files`,
          // SPEC-KIT FIELDS - auto-apply: follow existing test patterns
          confidence: 0.9,
          inferredAnswer: 'Yes, use existing patterns',
          inferenceSource: 'Existing test patterns found - follow codebase conventions',
          category: 'testing',
        });
      }

      // Prioritize configured test framework over detected patterns
      // Note: testGeneration may be under metrics, autonomous, or top-level depending on config structure
      const testGenConfig = (projectConfig as any)?.testGeneration || (projectConfig as any)?.metrics?.testGeneration || (projectConfig as any)?.autonomous?.testGeneration;
      const configuredTestFramework = testGenConfig?.framework;
      const configuredTestDir = testGenConfig?.testDir;
      
      if (codebaseAnalysis.testPatterns && codebaseAnalysis.testPatterns.length > 0) {
        const detectedTestFramework = codebaseAnalysis.testPatterns[0].framework;
        // Use configured framework if available, otherwise use detected
        const testFramework = configuredTestFramework || detectedTestFramework;
        const defaultAnswer = configuredTestFramework
          ? `Yes, generate ${configuredTestFramework} E2E tests (recommended)`
          : 'Yes, use ' + detectedTestFramework;
        
        questions.push({
          id: 'test-framework',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'test',
          text: configuredTestFramework
            ? `The project is configured to use ${configuredTestFramework} tests in ${configuredTestDir || 'tests/'}. Should I generate ${configuredTestFramework} E2E test plans?`
            : `I detected tests using ${detectedTestFramework}. Should I use this framework for test plans?`,
          options: configuredTestFramework
            ? [
                `Yes, generate ${configuredTestFramework} E2E tests (recommended)`,
                'Use different framework',
                'Show test framework options',
              ]
            : ['Yes, use ' + detectedTestFramework, 'No, use different framework', 'Ask for each test plan'],
          required: false,
          context: configuredTestFramework
            ? `Configured test framework: ${configuredTestFramework}, Test directory: ${configuredTestDir}, Application framework: ${codebaseAnalysis.framework || 'Drupal'}`
            : `Detected framework: ${detectedTestFramework}, Structure: ${codebaseAnalysis.testPatterns[0].structure}`,
          hint: configuredTestFramework
            ? `${configuredTestFramework} is configured in testGeneration config - recommended for this project`
            : undefined,
          // SPEC-KIT FIELDS - auto-apply: use configured/detected test framework
          confidence: configuredTestFramework ? 0.95 : 0.85,
          inferredAnswer: defaultAnswer,
          inferenceSource: configuredTestFramework
            ? `Test framework ${configuredTestFramework} is configured - use it`
            : `Test framework ${detectedTestFramework} detected - follow codebase conventions`,
          category: 'testing',
        });
      } else if (configuredTestFramework && configuredTestDir) {
        // No detected patterns but config specifies framework - ask about configured framework
        questions.push({
          id: 'test-framework-configured',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'test',
          text: `The project is configured to use ${configuredTestFramework} tests in ${configuredTestDir}. Should I generate ${configuredTestFramework} E2E test plans following project patterns?`,
          options: [
            `Yes, generate ${configuredTestFramework} E2E tests (recommended)`,
            'Use different test framework',
            'Show test framework options',
          ],
          required: true,
          context: `Configured test framework: ${configuredTestFramework}, Test directory: ${configuredTestDir}, Application framework: ${codebaseAnalysis.framework || 'Drupal'}`,
          hint: `${configuredTestFramework} is configured in testGeneration config - this matches the project's test setup`,
          // SPEC-KIT FIELDS - auto-apply: use configured test framework
          confidence: 0.95,
          inferredAnswer: `Yes, generate ${configuredTestFramework} E2E tests (recommended)`,
          inferenceSource: `Test framework ${configuredTestFramework} is explicitly configured`,
          category: 'testing',
        });
      }
    }

    if (phase === 'feature') {
      // Feature-specific codebase questions
      if (codebaseAnalysis.featureTypes && codebaseAnalysis.featureTypes.length > 0) {
        questions.push({
          id: 'feature-types',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'feature',
          text: `I detected these feature types in the codebase: ${codebaseAnalysis.featureTypes.join(', ')}. Should I generate configurations for these types?`,
          options: ['Yes, generate for all', 'No, only for PRD requirements', 'Let me select'],
          required: false,
          context: `Detected types: ${codebaseAnalysis.featureTypes.join(', ')}`,
          // SPEC-KIT FIELDS - moderate confidence, scope decision
          confidence: 0.7,
          inferredAnswer: 'No, only for PRD requirements',
          inferenceSource: 'Scope should be limited to PRD requirements by default',
          category: 'scope',
        });
      }

      // Prioritize configured framework over detected framework plugin
      const configuredFrameworkType = projectConfig?.framework?.type;
      const detectedFrameworkName = codebaseAnalysis.frameworkPlugin?.name;
      const frameworkName = configuredFrameworkType || detectedFrameworkName || codebaseAnalysis.framework;
      
      if (frameworkName && frameworkName !== 'generic' && frameworkName !== 'composite') {
        const defaultAnswer = configuredFrameworkType
          ? `Yes, use ${configuredFrameworkType} framework config (recommended)`
          : 'Yes, use framework config';
        questions.push({
          id: 'feature-framework-config',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'feature',
          text: configuredFrameworkType
            ? `The project is configured to use ${configuredFrameworkType} framework. Should I generate ${configuredFrameworkType}-specific configurations following project patterns?`
            : `Framework detected: ${detectedFrameworkName}. Should I generate framework-specific configurations?`,
          options: configuredFrameworkType
            ? [
                `Yes, use ${configuredFrameworkType} framework config (recommended)`,
                'Use generic config',
                'Show framework configuration options',
              ]
            : ['Yes, use framework config', 'No, use generic config', 'Show framework options'],
          required: false,
          context: configuredFrameworkType
            ? `Configured framework: ${configuredFrameworkType} (from devloop.config.js framework.type)`
            : `Detected framework: ${detectedFrameworkName}`,
          hint: configuredFrameworkType
            ? `${configuredFrameworkType} framework is explicitly configured in project config - use framework-specific patterns`
            : undefined,
          // SPEC-KIT FIELDS - auto-apply: use framework config
          confidence: configuredFrameworkType ? 0.95 : 0.85,
          inferredAnswer: defaultAnswer,
          inferenceSource: configuredFrameworkType
            ? `Framework ${configuredFrameworkType} is explicitly configured`
            : `Framework ${detectedFrameworkName} detected - use framework-specific config`,
          category: 'implementation',
        });
      } else if (configuredFrameworkType && configuredFrameworkType !== 'composite') {
        // Framework is configured but not detected as plugin - still ask about it
        questions.push({
          id: 'feature-framework-configured',
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase: 'feature',
          text: `The project is configured to use ${configuredFrameworkType} framework. Should I generate ${configuredFrameworkType}-specific configurations?`,
          options: [
            `Yes, use ${configuredFrameworkType} framework config (recommended)`,
            'Use generic config',
            'Show framework configuration options',
          ],
          required: false,
          context: `Configured framework: ${configuredFrameworkType} (from devloop.config.js framework.type), Current framework: ${codebaseAnalysis.framework || 'auto-detected'}`,
          hint: `${configuredFrameworkType} framework is explicitly configured in project config`,
          // SPEC-KIT FIELDS - auto-apply: use configured framework
          confidence: 0.95,
          inferredAnswer: `Yes, use ${configuredFrameworkType} framework config (recommended)`,
          inferenceSource: `Framework ${configuredFrameworkType} is explicitly configured`,
          category: 'implementation',
        });
      }
    }

    return questions;
  }

  /**
   * Generate clarifying questions
   */
  private generateClarifyingQuestions(
    phase: 'schema' | 'test' | 'feature',
    prd: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult
  ): RefinementQuestion[] {
    const questions: RefinementQuestion[] = [];

    if (phase === 'schema') {
      // Use framework plugin for PRD concept inference if available
      const frameworkPlugin = codebaseAnalysis.frameworkPlugin;
      if (frameworkPlugin?.inferFromPrd && frameworkPlugin?.getPrdConcepts) {
        // Framework-agnostic: use plugin to extract concepts
        const inference = frameworkPlugin.inferFromPrd(prd);
        const concepts = frameworkPlugin.getPrdConcepts();

        for (const inferred of inference.concepts) {
          const conceptDef = concepts.find((c: any) => c.name === inferred.type);
          if (!conceptDef || inferred.items.length <= 1) continue;

          // Schema generation question for this concept type
          if (conceptDef.schemaQuestion) {
            questions.push({
              id: `${inferred.type}-generate`,
              refinementType: 'clarifying',
              type: 'confirm',
              phase: 'schema',
              text: conceptDef.schemaQuestion.replace('{count}', String(inferred.items.length)),
              options: [`Yes, all ${inferred.items.length}`, 'Select specific ones', 'None'],
              required: false,
              context: `${conceptDef.label}: ${inferred.items.join(', ')}`,
              // SPEC-KIT FIELDS:
              confidence: inferred.confidence,
              inferredAnswer: `Yes, all ${inferred.items.length}`,
              inferenceSource: `Extracted ${conceptDef.label.toLowerCase()} from PRD`,
              category: 'scope',
            });
          }
        }

        // Schema type question if framework provides it
        if (inference.schemaType) {
          const schemaTypeOptions = this.getSchemaTypeOptions(frameworkPlugin.name);
          questions.push({
            id: 'schema-type-preference',
            refinementType: 'clarifying',
            type: 'multiple-choice',
            phase: 'schema',
            text: `What type of ${frameworkPlugin.name} schemas should I generate?`,
            options: schemaTypeOptions,
            required: false,
            hint: 'Config schemas are for module settings, other schemas are for framework-specific entities',
            // SPEC-KIT FIELDS:
            confidence: inference.schemaType.confidence,
            inferredAnswer: this.mapSchemaTypeToOption(inference.schemaType.value, schemaTypeOptions),
            inferenceSource: 'Inferred from PRD content analysis',
            category: 'scope',
          });
        }
      } else {
        // Fallback: generic schema type question (no framework-specific inference)
        questions.push({
          id: 'schema-type-preference',
          refinementType: 'clarifying',
          type: 'multiple-choice',
          phase: 'schema',
          text: 'What type of schemas should I generate?',
          options: ['Config schemas only', 'All schemas'],
          required: false,
          hint: 'Config schemas are for module/application settings',
          // SPEC-KIT FIELDS - moderate confidence
          confidence: 0.7,
          inferredAnswer: 'All schemas',
          inferenceSource: 'Default: generate all required schemas',
          category: 'scope',
        });
      }
    }

    if (phase === 'test') {
      // Count tasks in PRD
      const totalTasks = prd.phases.reduce((sum, p) => sum + (p.tasks?.length || 0), 0);
      if (totalTasks > 5) {
        questions.push({
          id: 'test-coverage-level',
          refinementType: 'clarifying',
          type: 'multiple-choice',
          phase: 'test',
          text: `I found ${totalTasks} tasks in the PRD. What test coverage level do you want?`,
          options: ['High - Test all tasks', 'Medium - Test critical tasks', 'Low - Test key tasks only'],
          required: false,
          context: `Total tasks: ${totalTasks}`,
          // SPEC-KIT FIELDS - moderate confidence, coverage is a genuine question
          confidence: 0.7,
          inferredAnswer: 'Medium - Test critical tasks',
          inferenceSource: 'Balanced coverage: test critical tasks thoroughly',
          category: 'testing',
        });
      }

      // Prioritize E2E tests if Playwright framework is configured
      // Note: testGeneration may be under metrics, autonomous, or top-level depending on config structure
      const testGenConfig = (this.config.projectConfig as any)?.testGeneration || (this.config.projectConfig as any)?.metrics?.testGeneration || (this.config.projectConfig as any)?.autonomous?.testGeneration;
      const configuredTestFramework = testGenConfig?.framework;
      const configuredTestDir = testGenConfig?.testDir;
      const preferredTestType = configuredTestFramework === 'playwright' 
        ? 'E2E tests (Playwright)' 
        : 'E2E tests';
      const defaultAnswer = configuredTestFramework === 'playwright'
        ? 'Yes, generate Playwright E2E tests (recommended)'
        : 'E2E tests';
      
      questions.push({
        id: 'test-type-preference',
        refinementType: 'clarifying',
        type: 'multiple-choice',
        phase: 'test',
        text: configuredTestFramework === 'playwright'
          ? `The project uses Playwright for E2E testing. Should I generate Playwright E2E test plans?`
          : 'What types of tests should I prioritize?',
        options: configuredTestFramework === 'playwright'
          ? [
              'Yes, generate Playwright E2E tests (recommended)',
              'Generate all test types (E2E + Integration + Unit)',
              'Generate Integration tests only',
              'Generate Unit tests only',
            ]
          : ['E2E tests', 'Integration tests', 'Unit tests', 'All types'],
        required: false,
        context: configuredTestFramework 
          ? `Test framework: ${configuredTestFramework}, Test directory: ${configuredTestDir || 'tests/'}`
          : undefined,
        hint: configuredTestFramework === 'playwright'
          ? 'Playwright E2E tests verify full user workflows and UI behavior'
          : 'E2E tests verify full workflows, integration tests verify modules work together, unit tests are fast',
        // SPEC-KIT FIELDS - auto-apply if framework configured
        confidence: configuredTestFramework === 'playwright' ? 0.95 : 0.75,
        inferredAnswer: defaultAnswer,
        inferenceSource: configuredTestFramework === 'playwright'
          ? 'Playwright is configured - use E2E tests'
          : 'E2E tests provide best coverage for user workflows',
        category: 'testing',
      });
    }

    if (phase === 'feature') {
      questions.push({
        id: 'feature-enhancement-types',
        refinementType: 'clarifying',
        type: 'multiple-choice',
        phase: 'feature',
        text: 'What types of feature enhancements should I generate?',
        options: ['Error guidance only', 'Log patterns only', 'Framework config only', 'All enhancement types'],
        required: false,
        hint: 'Error guidance helps with debugging, log patterns help with monitoring, framework config helps with integration',
        // SPEC-KIT FIELDS - auto-apply: generate all enhancements
        confidence: 0.85,
        inferredAnswer: 'All enhancement types',
        inferenceSource: 'Complete feature enhancements provide best developer experience',
        category: 'scope',
      });
    }

    return questions;
  }

  /**
   * Get schema type options for a specific framework
   */
  private getSchemaTypeOptions(framework: string): string[] {
    switch (framework) {
      case 'drupal':
        return ['Config schemas only', 'Entity type schemas only', 'Both config and entity schemas'];
      case 'django':
        return ['Model schemas only', 'Serializer schemas only', 'Both'];
      case 'laravel':
        return ['Migration schemas only', 'Eloquent model schemas only', 'Both'];
      case 'react':
      case 'nextjs':
        return ['TypeScript interfaces only', 'Zod schemas only', 'Both'];
      default:
        return ['Config schemas only', 'All schemas'];
    }
  }

  /**
   * Map a schema type value to its corresponding option string
   */
  private mapSchemaTypeToOption(value: string, options: string[]): string {
    const valueMap: Record<string, string[]> = {
      'config': ['Config schemas only', 'Config schemas', 'TypeScript interfaces only'],
      'entity': ['Entity type schemas only', 'Model schemas only', 'Migration schemas only'],
      'both': ['Both config and entity schemas', 'Both', 'All schemas'],
    };
    const candidates = valueMap[value] || [];
    for (const candidate of candidates) {
      if (options.includes(candidate)) return candidate;
    }
    return options[options.length - 1]; // Default to last option (usually "All" or "Both")
  }

  /**
   * Generate prioritization questions
   */
  private generatePrioritizationQuestions(
    phase: 'schema' | 'test' | 'feature',
    prd: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult
  ): RefinementQuestion[] {
    const questions: RefinementQuestion[] = [];

    if (phase === 'schema') {
      // Use framework plugin for PRD concept inference if available
      const frameworkPlugin = codebaseAnalysis.frameworkPlugin;
      if (frameworkPlugin?.inferFromPrd && frameworkPlugin?.getPrdConcepts) {
        const inference = frameworkPlugin.inferFromPrd(prd);
        const concepts = frameworkPlugin.getPrdConcepts();

        for (const inferred of inference.concepts) {
          const conceptDef = concepts.find((c: any) => c.name === inferred.type);
          if (!conceptDef || inferred.items.length <= 3) continue;

          // Priority question for this concept type (only if > 3 items)
          if (conceptDef.priorityQuestion) {
            questions.push({
              id: `${inferred.type}-priority`,
              refinementType: 'prioritization',
              type: 'multi-select',
              phase: 'schema',
              text: conceptDef.priorityQuestion.replace('{count}', String(inferred.items.length)),
              options: inferred.items,
              required: false,
              hint: `Select the most important ${conceptDef.label.toLowerCase()} to generate first`,
              // SPEC-KIT FIELDS:
              confidence: inferred.confidence,
              inferredAnswer: inferred.priorities.join(', '),
              inferenceSource: 'First items in PRD phase order',
              category: 'scope',
            });
          }
        }
      }
    }

    if (phase === 'test') {
      const tasks = prd.phases.flatMap(p => p.tasks || []);
      if (tasks.length > 5) {
        const taskTitles = tasks.slice(0, 10).map(t => `${t.id}: ${t.title}`);
        // Auto-select first 3 tasks as priority
        const priorityTasks = taskTitles.slice(0, 3).join(', ');
        questions.push({
          id: 'test-priority',
          refinementType: 'prioritization',
          type: 'multi-select',
          phase: 'test',
          text: `Which tasks should I prioritize for test planning? (${tasks.length} total tasks)`,
          options: taskTitles,
          required: false,
          hint: 'Select the most critical tasks to generate test plans first',
          // SPEC-KIT FIELDS - use phase order for priority
          confidence: 0.8,
          inferredAnswer: priorityTasks,
          inferenceSource: 'First tasks in PRD phase order are typically highest priority',
          category: 'scope',
        });
      }
    }

    return questions;
  }

  /**
   * Generate AI-powered questions for additional context
   */
  private async generateAIQuestions(
    phase: 'schema' | 'test' | 'feature',
    prd: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult,
    insights: CodebaseInsight[],
    existingQuestions: RefinementQuestion[]
  ): Promise<RefinementQuestion[]> {
    try {
      const prompt = await this.config.promptSelector.getPromptForUseCase(
        'question-generation',
        {
          mode: 'convert',
          framework: codebaseAnalysis.frameworkPlugin?.name,
          featureTypes: codebaseAnalysis.featureTypes as any[],
        }
      );

      const aiPrompt = this.buildQuestionGenerationPrompt(
        phase,
        prd,
        codebaseAnalysis,
        insights,
        existingQuestions,
        prompt
      );

      const response = await this.textGenerator.generate(aiPrompt, {
        maxTokens: 1500,
        temperature: 0.6,
        systemPrompt: 'You are an expert at generating clarifying questions for software development planning.',
      });

      // Parse AI response to extract questions
      const aiQuestions = this.parseAIQuestionsResponse(response, phase);
      return aiQuestions;
    } catch (error) {
      logger.warn(`[RefinementQuestionGenerator] Failed to generate AI questions: ${error}`);
      return [];
    }
  }

  /**
   * Build prompt for AI question generation
   */
  private buildQuestionGenerationPrompt(
    phase: 'schema' | 'test' | 'feature',
    prd: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult,
    insights: CodebaseInsight[],
    existingQuestions: RefinementQuestion[],
    basePrompt: string
  ): string {
    const parts: string[] = [];

    parts.push(basePrompt);
    parts.push('\n---\n');
    parts.push(`## Phase: ${phase.toUpperCase()} Enhancement`);
    parts.push('');
    parts.push(`## PRD Context`);
    parts.push(`Title: ${prd.title || prd.prdId}`);
    parts.push(`Phases: ${prd.phases.length}`);
    parts.push(`Total Tasks: ${prd.phases.reduce((sum, p) => sum + (p.tasks?.length || 0), 0)}`);
    parts.push('');

    if (insights.length > 0) {
      parts.push('## Codebase Insights');
      for (const insight of insights.slice(0, 5)) {
        parts.push(`- [${insight.relevance}] ${insight.description}`);
        if (insight.example) {
          parts.push(`  Example: ${insight.example}`);
        }
      }
      parts.push('');
    }

    parts.push('## Codebase Analysis Summary');
    if (codebaseAnalysis.frameworkPlugin) {
      parts.push(`Framework: ${codebaseAnalysis.frameworkPlugin.name}`);
    }
    if (codebaseAnalysis.featureTypes && codebaseAnalysis.featureTypes.length > 0) {
      parts.push(`Feature Types: ${codebaseAnalysis.featureTypes.join(', ')}`);
    }
    if (codebaseAnalysis.schemaPatterns && codebaseAnalysis.schemaPatterns.length > 0) {
      parts.push(`Schema Patterns: ${codebaseAnalysis.schemaPatterns.length} pattern(s) found`);
    }
    if (codebaseAnalysis.testPatterns && codebaseAnalysis.testPatterns.length > 0) {
      parts.push(`Test Patterns: ${codebaseAnalysis.testPatterns.length} pattern(s) found`);
    }
    parts.push('');

    if (existingQuestions.length > 0) {
      parts.push('## Existing Questions (do not duplicate)');
      for (const q of existingQuestions) {
        parts.push(`- ${q.text}`);
      }
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push(`Generate 2-3 additional clarifying or codebase-focused questions for the ${phase} enhancement phase.`);
    parts.push('Questions should:');
    parts.push('- Help guide what to enhance based on codebase patterns');
    parts.push('- Clarify requirements or preferences');
    parts.push('- Prioritize what to generate');
    parts.push('');
    parts.push('Return questions in JSON format:');
    parts.push('{');
    parts.push('  "questions": [');
    parts.push('    {');
    parts.push('      "id": "question-id",');
    parts.push('      "type": "clarifying" | "codebase-focused" | "prioritization",');
    parts.push('      "text": "Question text?",');
    parts.push('      "options": ["Option 1", "Option 2"],');
    parts.push('      "required": false,');
    parts.push('      "context": "Optional context that triggered this question"');
    parts.push('    }');
    parts.push('  ]');
    parts.push('}');

    return parts.join('\n');
  }

  /**
   * Parse AI response to extract questions
   */
  private parseAIQuestionsResponse(
    response: string,
    phase: 'schema' | 'test' | 'feature'
  ): RefinementQuestion[] {
    const questions: RefinementQuestion[] = [];

    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.questions && Array.isArray(parsed.questions)) {
          for (const q of parsed.questions) {
            if (q.text && q.type) {
              questions.push({
                id: q.id || `ai-${phase}-${questions.length + 1}`,
                refinementType: q.type as RefinementQuestionType,
                type: q.options && q.options.length > 0 ? 'multiple-choice' : 'open-ended',
                phase,
                text: q.text,
                options: q.options,
                required: q.required || false,
                context: q.context,
                hint: q.hint,
                // AI-generated questions get moderate confidence
                confidence: 0.6,
                inferredAnswer: q.options?.[0],
                inferenceSource: 'AI-generated question',
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn(`[RefinementQuestionGenerator] Failed to parse AI questions: ${error}`);
    }

    return questions;
  }

  /**
   * Generate questions based on learned patterns and observations
   */
  private generateLearningBasedQuestions(
    phase: 'schema' | 'test' | 'feature',
    prd: ParsedPlanningDoc,
    codebaseAnalysis: CodebaseAnalysisResult
  ): RefinementQuestion[] {
    const questions: RefinementQuestion[] = [];
    const configuredFrameworkType = this.config.projectConfig?.framework?.type;

    // Use patterns relevant to this phase and framework
    const relevantPatterns = this.patterns.filter(pattern => {
      // Filter by phase category (schema, test, feature)
      if (phase === 'schema' && pattern.category !== 'schema' && pattern.category !== 'error-pattern') {
        return false;
      }
      if (phase === 'test' && pattern.category !== 'test' && pattern.category !== 'error-pattern') {
        return false;
      }
      if (phase === 'feature' && pattern.category !== 'feature' && pattern.category !== 'error-pattern') {
        return false;
      }

      // Filter by framework if configured
      if (configuredFrameworkType && pattern.framework && pattern.framework !== configuredFrameworkType) {
        return false;
      }

      return true;
    });

    // Use observations relevant to this phase
    const relevantObservations = this.observations.filter(observation => {
      // Filter by category if it matches phase
      if (phase === 'schema' && observation.category !== 'pattern' && observation.category !== 'error') {
        return false;
      }
      if (phase === 'test' && observation.category !== 'success' && observation.category !== 'pattern') {
        return false;
      }
      if (phase === 'feature' && observation.category !== 'recommendation' && observation.category !== 'pattern') {
        return false;
      }

      // Filter by framework if configured
      if (configuredFrameworkType && observation.metadata?.framework && observation.metadata.framework !== configuredFrameworkType) {
        return false;
      }

      return true;
    });

    // Generate questions based on patterns
    if (relevantPatterns.length > 0) {
      // Top patterns (by relevance score)
      const topPatterns = relevantPatterns
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 5);

      if (topPatterns.length > 0) {
        questions.push({
          id: `pattern-based-${phase}`,
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase,
          text: `I found ${topPatterns.length} relevant pattern(s) from past PRD sets. Should I apply these patterns to this PRD set?`,
          options: [
            'Yes, apply relevant patterns (recommended)',
            'Show me the patterns first',
            'No, generate from scratch',
          ],
          required: false,
          context: `Top patterns: ${topPatterns.slice(0, 3).map(p => p.pattern.substring(0, 50) + (p.pattern.length > 50 ? '...' : '')).join('; ')}`,
          hint: `Patterns learned from ${topPatterns[0].prdId || 'previous'} PRD execution${topPatterns.length > 1 ? `s` : ''}`,
          // SPEC-KIT FIELDS - auto-apply: use learned patterns
          confidence: 0.9,
          inferredAnswer: 'Yes, apply relevant patterns (recommended)',
          inferenceSource: 'Learned patterns from successful past PRD executions',
          category: 'implementation',
        });
      }
    }

    // Generate questions based on observations (common issues/successes)
    if (relevantObservations.length > 0) {
      // Group observations by category
      const successObservations = relevantObservations.filter(o => o.category === 'success');
      const errorObservations = relevantObservations.filter(o => o.category === 'error');
      const recommendationObservations = relevantObservations.filter(o => o.category === 'recommendation');

      if (errorObservations.length > 0 && phase === 'test') {
        questions.push({
          id: `observation-errors-${phase}`,
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase,
          text: `I found ${errorObservations.length} observation(s) about common test issues in past PRD sets. Should I avoid these patterns?`,
          options: [
            'Yes, avoid known issues (recommended)',
            'Show me the issues first',
            'No, proceed normally',
          ],
          required: false,
          context: `Common issues: ${errorObservations.slice(0, 3).map(o => o.observation.substring(0, 50) + (o.observation.length > 50 ? '...' : '')).join('; ')}`,
          hint: `Based on observations from ${errorObservations[0].prdId || 'previous'} PRD execution${errorObservations.length > 1 ? `s` : ''}`,
          // SPEC-KIT FIELDS - auto-apply: avoid known issues
          confidence: 0.95,
          inferredAnswer: 'Yes, avoid known issues (recommended)',
          inferenceSource: 'Learned from past test failures - avoid repeating mistakes',
          category: 'testing',
        });
      }

      if (successObservations.length > 0) {
        questions.push({
          id: `observation-success-${phase}`,
          refinementType: 'codebase-focused',
          type: 'multiple-choice',
          phase,
          text: `I found ${successObservations.length} observation(s) about successful patterns in past PRD sets. Should I apply these patterns?`,
          options: [
            'Yes, apply successful patterns (recommended)',
            'Show me the successes first',
            'No, proceed normally',
          ],
          required: false,
          context: `Successful patterns: ${successObservations.slice(0, 3).map(o => o.observation.substring(0, 50) + (o.observation.length > 50 ? '...' : '')).join('; ')}`,
          hint: `Based on observations from ${successObservations[0].prdId || 'previous'} PRD execution${successObservations.length > 1 ? `s` : ''}`,
          // SPEC-KIT FIELDS - auto-apply: use successful patterns
          confidence: 0.9,
          inferredAnswer: 'Yes, apply successful patterns (recommended)',
          inferenceSource: 'Learned from past successes - replicate what works',
          category: 'implementation',
        });
      }
    }

    return questions;
  }

  // NOTE: extractEntityTypesFromPrd() was removed as it was Drupal-specific.
  // PRD concept extraction is now handled by FrameworkPlugin.inferFromPrd()
  // which each framework implements with its own patterns.
  // See: DrupalPlugin.getPrdConcepts() and DrupalPlugin.inferFromPrd()
}
