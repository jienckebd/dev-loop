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
import { Question, QuestionType, Answer } from '../../conversation/types';
import { logger } from '../../utils/logger';
import { TextGenerationAdapter, TextGenerationOptions } from './text-generation-adapter';
import { AIProvider, AIProviderConfig } from '../../../providers/ai/interface';
import { PromptSelector } from '../../../prompts/code-generation/prompt-selector';
import { FrameworkPlugin } from '../../../frameworks';
import { Config } from '../../../config/schema/core';
import { PatternEntry, ObservationEntry } from '../learning/types';

/**
 * Refinement Question
 */
export interface RefinementQuestion {
  id: string;
  type: 'clarifying' | 'codebase-focused' | 'prioritization';
  phase: 'schema' | 'test' | 'feature';
  text: string;
  options?: string[]; // For multiple-choice
  required: boolean;
  context?: string; // Codebase context that triggered this question
  hint?: string; // Additional guidance
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
        type: 'codebase-focused',
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
          type: 'codebase-focused',
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
          type: 'clarifying',
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
          type: 'prioritization',
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
          type: 'prioritization',
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
          type: 'prioritization',
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
            type: 'codebase-focused',
            phase: 'schema',
            text: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `${configuredFrameworkType} framework provides ${schemaTools.length} code quality tool(s) (${schemaTools.map(t => t.name).join(', ')}). Should I use these to validate generated schemas?`
              : `Framework ${frameworkName} provides ${schemaTools.length} code quality tool(s) (${schemaTools.map(t => t.name).join(', ')}). Should I use these to validate generated schemas?`,
            options: ['Yes, validate with tools', 'No, skip validation', 'Show tool details'],
            required: false,
            context: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `Configured framework: ${configuredFrameworkType}, Available tools: ${schemaTools.map(t => `${t.name} (${t.purpose})`).join(', ')}`
              : `Framework: ${frameworkName}, Available tools: ${schemaTools.map(t => `${t.name} (${t.purpose})`).join(', ')}`,
          });
        }
      }

      // Ask about tech debt indicators
      if (techDebtIndicators.length > 0) {
        const schemaDebt = techDebtIndicators.filter(t => t.category === 'deprecated-api' || t.category === 'obsolete-pattern');
        if (schemaDebt.length > 0) {
          questions.push({
            id: 'schema-tech-debt',
            type: 'codebase-focused',
            phase: 'schema',
            text: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `${configuredFrameworkType} framework has ${schemaDebt.length} tech debt indicator(s) for deprecated patterns. Should I avoid these patterns in generated schemas?`
              : `Framework ${frameworkName} has ${schemaDebt.length} tech debt indicator(s) for deprecated patterns. Should I avoid these patterns in generated schemas?`,
            options: ['Yes, avoid deprecated patterns', 'No, allow all patterns', 'Show deprecated patterns'],
            required: false,
            context: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `Configured framework: ${configuredFrameworkType}, Deprecated patterns: ${schemaDebt.map(t => t.description).join('; ')}`
              : `Framework: ${frameworkName}, Deprecated patterns: ${schemaDebt.map(t => t.description).join('; ')}`,
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
          type: 'codebase-focused',
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
            type: 'codebase-focused',
            phase: 'feature',
            text: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `${configuredFrameworkType} framework suggests ${featureRecommendations.length} pattern(s) for new features. Should I follow these recommendations?`
              : `Framework ${frameworkName} suggests ${featureRecommendations.length} pattern(s) for new features. Should I follow these recommendations?`,
            options: ['Yes, use recommendations', 'No, create from scratch', 'Show recommendations'],
            required: false,
            context: configuredFrameworkType && configuredFrameworkType !== 'composite'
              ? `Configured framework: ${configuredFrameworkType}, Recommendations: ${featureRecommendations.map(r => r.description).join('; ')}`
              : `Framework: ${frameworkName}, Recommendations: ${featureRecommendations.map(r => r.description).join('; ')}`,
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
      questions.push({
        id: 'test-framework-pattern',
        type: 'codebase-focused',
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
      });
    }

    // Test isolation rules question (critical for Drupal/Playwright tests)
    if (isolationRules.length > 0) {
      questions.push({
        id: 'test-isolation',
        type: 'codebase-focused',
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
          type: 'codebase-focused',
          phase: 'schema',
          text: `I found ${schemaFiles} existing schema file(s) in the codebase. Should I follow these patterns when generating new schemas?`,
          options: ['Yes, use existing patterns', 'No, create new patterns', 'Show me the existing schemas first'],
          required: false,
          context: `Found ${schemaFiles} schema-related files`,
        });
      }

      if (codebaseAnalysis.schemaPatterns && codebaseAnalysis.schemaPatterns.length > 0) {
        questions.push({
          id: 'schema-pattern-type',
          type: 'codebase-focused',
          phase: 'schema',
          text: `I detected schema pattern: ${codebaseAnalysis.schemaPatterns[0].type}. Should I use this pattern?`,
          options: ['Yes, use this pattern', 'No, use different pattern', 'Ask for each schema'],
          required: false,
          context: `Pattern: ${codebaseAnalysis.schemaPatterns[0].pattern}`,
          hint: codebaseAnalysis.schemaPatterns[0].examples?.[0],
        });
      }

      // Reference framework-specific schema patterns from config
      if (projectConfig?.framework?.prdGeneration?.scenarios?.schema) {
        const schemaScenarios = projectConfig.framework.prdGeneration.scenarios.schema;
        if (schemaScenarios.patterns && schemaScenarios.patterns.length > 0) {
          questions.push({
            id: 'schema-framework-patterns',
            type: 'codebase-focused',
            phase: 'schema',
            text: `Framework provides ${schemaScenarios.patterns.length} schema pattern(s): ${schemaScenarios.patterns.slice(0, 2).join(', ')}${schemaScenarios.patterns.length > 2 ? '...' : ''}. Should I use these patterns?`,
            options: ['Yes, use framework patterns', 'No, use codebase patterns', 'Show all patterns'],
            required: false,
            context: `Framework patterns: ${schemaScenarios.patterns.join(', ')}`,
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
          type: 'codebase-focused',
          phase: 'test',
          text: `I found ${testFiles} existing test file(s). Should I follow the same test structure and patterns?`,
          options: ['Yes, use existing patterns', 'No, create new structure', 'Show me test examples'],
          required: false,
          context: `Found ${testFiles} test files`,
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
        
        questions.push({
          id: 'test-framework',
          type: 'codebase-focused',
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
        });
      } else if (configuredTestFramework && configuredTestDir) {
        // No detected patterns but config specifies framework - ask about configured framework
        questions.push({
          id: 'test-framework-configured',
          type: 'codebase-focused',
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
        });
      }
    }

    if (phase === 'feature') {
      // Feature-specific codebase questions
      if (codebaseAnalysis.featureTypes && codebaseAnalysis.featureTypes.length > 0) {
        questions.push({
          id: 'feature-types',
          type: 'codebase-focused',
          phase: 'feature',
          text: `I detected these feature types in the codebase: ${codebaseAnalysis.featureTypes.join(', ')}. Should I generate configurations for these types?`,
          options: ['Yes, generate for all', 'No, only for PRD requirements', 'Let me select'],
          required: false,
          context: `Detected types: ${codebaseAnalysis.featureTypes.join(', ')}`,
        });
      }

      // Prioritize configured framework over detected framework plugin
      const configuredFrameworkType = projectConfig?.framework?.type;
      const detectedFrameworkName = codebaseAnalysis.frameworkPlugin?.name;
      const frameworkName = configuredFrameworkType || detectedFrameworkName || codebaseAnalysis.framework;
      
      if (frameworkName && frameworkName !== 'generic' && frameworkName !== 'composite') {
        questions.push({
          id: 'feature-framework-config',
          type: 'codebase-focused',
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
        });
      } else if (configuredFrameworkType && configuredFrameworkType !== 'composite') {
        // Framework is configured but not detected as plugin - still ask about it
        questions.push({
          id: 'feature-framework-configured',
          type: 'codebase-focused',
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
      // Count entity types mentioned in PRD
      const entityTypes = this.extractEntityTypesFromPrd(prd);
      if (entityTypes.length > 1) {
        questions.push({
          id: 'schema-entity-types',
          type: 'clarifying',
          phase: 'schema',
          text: `I found ${entityTypes.length} entity types mentioned in the PRD. Should I generate schemas for all of them?`,
          options: ['Yes, all entity types', 'No, only specified ones', 'Let me select'],
          required: false,
          context: `Entity types: ${entityTypes.join(', ')}`,
        });
      }

      questions.push({
        id: 'schema-type-preference',
        type: 'clarifying',
        phase: 'schema',
        text: 'What type of schemas should I generate?',
        options: ['Config schemas only', 'Entity type schemas only', 'Both config and entity type schemas'],
        required: false,
        hint: 'Config schemas are for module settings, entity type schemas are for content entities',
      });
    }

    if (phase === 'test') {
      // Count tasks in PRD
      const totalTasks = prd.phases.reduce((sum, phase) => sum + (phase.tasks?.length || 0), 0);
      if (totalTasks > 5) {
        questions.push({
          id: 'test-coverage-level',
          type: 'clarifying',
          phase: 'test',
          text: `I found ${totalTasks} tasks in the PRD. What test coverage level do you want?`,
          options: ['High - Test all tasks', 'Medium - Test critical tasks', 'Low - Test key tasks only'],
          required: false,
          context: `Total tasks: ${totalTasks}`,
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
      
      questions.push({
        id: 'test-type-preference',
        type: 'clarifying',
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
          ? 'Playwright E2E tests verify full user workflows and UI behavior - recommended for Drupal projects'
          : 'E2E tests verify full workflows, integration tests verify modules work together, unit tests are fast',
      });
    }

    if (phase === 'feature') {
      questions.push({
        id: 'feature-enhancement-types',
        type: 'clarifying',
        phase: 'feature',
        text: 'What types of feature enhancements should I generate?',
        options: ['Error guidance only', 'Log patterns only', 'Framework config only', 'All enhancement types'],
        required: false,
        hint: 'Error guidance helps with debugging, log patterns help with monitoring, framework config helps with integration',
      });
    }

    return questions;
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
      const entityTypes = this.extractEntityTypesFromPrd(prd);
      if (entityTypes.length > 3) {
        questions.push({
          id: 'schema-priority',
          type: 'prioritization',
          phase: 'schema',
          text: `Which entity types should I prioritize for schema generation? (${entityTypes.length} found)`,
          options: entityTypes,
          required: false,
          hint: 'Select the most important entity types to generate schemas first',
        });
      }
    }

    if (phase === 'test') {
      const tasks = prd.phases.flatMap(phase => phase.tasks || []);
      if (tasks.length > 5) {
        const taskTitles = tasks.slice(0, 10).map(t => `${t.id}: ${t.title}`);
        questions.push({
          id: 'test-priority',
          type: 'prioritization',
          phase: 'test',
          text: `Which tasks should I prioritize for test planning? (${tasks.length} total tasks)`,
          options: taskTitles,
          required: false,
          hint: 'Select the most critical tasks to generate test plans first',
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
                type: q.type as 'clarifying' | 'codebase-focused' | 'prioritization',
                phase,
                text: q.text,
                options: q.options,
                required: q.required || false,
                context: q.context,
                hint: q.hint,
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
          type: 'codebase-focused',
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
          type: 'codebase-focused',
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
        });
      }

      if (successObservations.length > 0) {
        questions.push({
          id: `observation-success-${phase}`,
          type: 'codebase-focused',
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
        });
      }
    }

    return questions;
  }

  /**
   * Extract entity types mentioned in PRD
   */
  private extractEntityTypesFromPrd(prd: ParsedPlanningDoc): string[] {
    const entityTypes: string[] = [];
    const content = prd.rawContent || prd.title || '';

    // Look for entity type mentions (basic pattern matching)
    const entityMatches = content.match(/\b(entity\s+type|entity_type|entity)[\s:]+([a-z_]+)/gi);
    if (entityMatches) {
      for (const match of entityMatches) {
        const parts = match.split(/:|\s+/);
        if (parts.length > 1) {
          const type = parts[parts.length - 1].trim();
          if (type && !entityTypes.includes(type)) {
            entityTypes.push(type);
          }
        }
      }
    }

    // Also check task descriptions
    for (const phase of prd.phases) {
      for (const task of phase.tasks || []) {
        const taskContent = `${task.title} ${task.description || ''}`;
        const matches = taskContent.match(/\b([a-z_]+_entity|entity_type_[a-z_]+)\b/gi);
        if (matches) {
          for (const match of matches) {
            if (!entityTypes.includes(match.toLowerCase())) {
              entityTypes.push(match.toLowerCase());
            }
          }
        }
      }
    }

    return entityTypes;
  }
}
