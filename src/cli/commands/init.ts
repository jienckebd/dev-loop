import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { CodebaseAnalyzer } from '../../core/analysis/codebase-analyzer';
import { FrameworkLoader, createFrameworkLoader, FrameworkPlugin } from '../../frameworks/index';
import { InteractivePromptSystem } from '../../core/prd/builder/interactive-prompt-system';
import { AIProviderFactory } from '../../providers/ai/factory';
import { ConstitutionParser } from '../../core/prd/builder/constitution-parser';
import { loadConfig } from '../../config/loader';
import { validateConfig, Config } from '../../config/schema';
import { promptInitConfig, type InitAnswers } from '../prompts';
import { getDefaultModel, PROVIDER_MODELS } from '../utils/model-list';
import { detectAvailableProviders, formatDetectedProviders, getBestAvailableProvider } from '../utils/env-detector';
import { analyzeConstitutionForConfig, analysisToConfigSuggestions, ConstitutionAnalysis } from '../utils/constitution-analyzer';
import { buildCompleteConfigFromAnalysis, mergeConfigSuggestions } from '../utils/codebase-config-builder';
import type { CodebaseAnalysisResult } from '../../core/analysis/codebase-analyzer';
import type { AIProvider } from '../../providers/ai/interface';

/**
 * Get default answers for dry-run mode
 */
async function getDefaultAnswers(
  suggestions: Partial<Config>,
  framework: FrameworkPlugin | null,
  codebaseAnalysis: CodebaseAnalysisResult,
  suggestedProvider?: string
): Promise<InitAnswers> {
  const frameworkDefaults = (framework && typeof framework.getDefaultConfig === 'function')
    ? framework.getDefaultConfig()
    : {};

  // Use suggested provider from env detection, or from suggestions, or fallback to cursor
  const provider = (suggestedProvider as any) || (suggestions?.ai?.provider as any) || 'cursor';

  return {
    aiProvider: provider,
    aiModel: suggestions?.ai?.model || getDefaultModel(provider),
    aiFallback: suggestions?.ai?.fallback,
    templateSource: suggestions?.templates?.source || 'builtin',
    customTemplatePath: suggestions?.templates?.customPath,
    testRunner: (suggestions?.testing?.runner as any) || (frameworkDefaults.testRunner as any) || 'playwright',
    testCommand: suggestions?.testing?.command || frameworkDefaults.testCommand || 'npm test',
    testTimeout: suggestions?.testing?.timeout || 300000,
    artifactsDir: suggestions?.testing?.artifactsDir || 'test-results',
    logSources: suggestions?.logs?.sources || [],
    interventionMode: 'autonomous',
    approvalRequired: [],
    tasksPath: suggestions?.taskMaster?.tasksPath || '.taskmaster/tasks/tasks.json',
    testing: suggestions?.testing,
    logs: suggestions?.logs,
  };
}

/**
 * Format config for console output (pretty-printed)
 */
function formatConfigForOutput(config: Config): string {
  // Convert RegExp to strings for JSON serialization
  const configForOutput = JSON.parse(JSON.stringify(config, (key, value) => {
    if (value instanceof RegExp) {
      return value.toString();
    }
    return value;
  }, 2));

  return `module.exports = ${JSON.stringify(configForOutput, null, 2)};`;
}

/**
 * Format config as JavaScript module
 */
function formatConfigAsModule(config: Config): string {
  return formatConfigForOutput(config);
}

/**
 * Compare config sections and return differences
 */
function compareConfigSections(
  generated: Config,
  existing: Config
): Array<{ path: string; message: string }> {
  const differences: Array<{ path: string; message: string }> = [];

  // Compare key sections
  const sectionsToCompare = [
    'ai',
    'testing',
    'logs',
    'framework',
    'autonomous',
    'cursor',
    'prdBuilding',
    'codebase',
  ];

  for (const section of sectionsToCompare) {
    const genValue = (generated as any)[section];
    const existValue = (existing as any)[section];

    if (genValue && !existValue) {
      differences.push({
        path: section,
        message: 'Generated config includes this section, existing does not',
      });
    } else if (!genValue && existValue) {
      differences.push({
        path: section,
        message: 'Existing config includes this section, generated does not',
      });
    } else if (genValue && existValue) {
      // Deep comparison for nested objects
      try {
        const genStr = JSON.stringify(genValue);
        const existStr = JSON.stringify(existValue);
        if (genStr !== existStr) {
          differences.push({
            path: section,
            message: 'Section exists but values differ',
          });
        }
      } catch {
        // If JSON.stringify fails, values are likely functions or complex objects
        // Consider them different
        differences.push({
          path: section,
          message: 'Section exists but values differ (non-serializable)',
        });
      }
    }
  }

  return differences;
}

/**
 * Calculate similarity score between two configs (0-1)
 */
function calculateConfigSimilarity(generated: Config, existing: Config): number {
  // Simple similarity: count matching top-level keys
  const genKeys = Object.keys(generated);
  const existKeys = Object.keys(existing);
  const allKeys = new Set([...genKeys, ...existKeys]);

  let matches = 0;
  let total = 0;

  for (const key of allKeys) {
    total++;
    if (genKeys.includes(key) && existKeys.includes(key)) {
      // Check if values are similar (deep comparison)
      try {
        const genVal = JSON.stringify((generated as any)[key]);
        const existVal = JSON.stringify((existing as any)[key]);
        if (genVal === existVal) {
          matches++;
        } else {
          // Partial match (both have the key but different values)
          matches += 0.5;
        }
      } catch {
        // Non-serializable values - count as partial match
        matches += 0.5;
      }
    }
  }

  return total > 0 ? matches / total : 0;
}

/**
 * Compare generated config with existing config
 */
async function compareWithExistingConfig(
  generatedConfig: Config,
  existingConfigPath: string
): Promise<void> {
  try {
    const existingConfig = await loadConfig(existingConfigPath);

    console.log(chalk.yellow('\n=== Config Comparison ===\n'));

    // Compare key sections
    const differences = compareConfigSections(generatedConfig, existingConfig);

    if (differences.length === 0) {
      console.log(chalk.green('✓ Generated config matches existing config structure'));
    } else {
      console.log(chalk.yellow('⚠ Differences found:'));
      differences.forEach(diff => {
        console.log(chalk.gray(`  - ${diff.path}: ${diff.message}`));
      });
    }

    // Show similarity score
    const similarity = calculateConfigSimilarity(generatedConfig, existingConfig);
    console.log(chalk.cyan(`\nSimilarity: ${(similarity * 100).toFixed(1)}%`));

  } catch (error) {
    console.warn(chalk.yellow('Could not compare with existing config:'), error);
  }
}

export interface InitCommandOptions {
  template?: string;
  debug?: boolean;
  dryRun?: boolean;
}

export async function initCommand(options: InitCommandOptions = {}): Promise<void> {
  const spinner = ora('Initializing dev-loop configuration').start();

  try {
    const configPath = path.join(process.cwd(), 'devloop.config.js');
    const hasExistingConfig = await fs.pathExists(configPath);

    // Initialize services (same pattern as build-prd-set)
    let baseConfig: Partial<Config> = {};
    if (hasExistingConfig) {
      try {
        baseConfig = await loadConfig(configPath);
      } catch {
        // Config exists but may be invalid, continue with empty config
      }
    }

    spinner.text = 'Initializing services...';

    // Initialize CodebaseAnalyzer
    const codebaseAnalyzer = new CodebaseAnalyzer({
      projectRoot: process.cwd(),
      skipAnalysis: false,
      maxFiles: 100,
      maxContextChars: 50000,
      debug: options.debug || false,
      projectConfig: baseConfig as any,
    });

    // Initialize FrameworkLoader
    const frameworkLoader = createFrameworkLoader(process.cwd(), options.debug || false);

    // Initialize InteractivePromptSystem
    const interactivePrompts = new InteractivePromptSystem({
      useRichUI: true,
      debug: options.debug || false,
    });

    spinner.succeed('Services initialized');

    // Detect available AI providers from environment
    spinner.start('Detecting AI providers...');
    const detectedProviders = await detectAvailableProviders(process.cwd());
    const availableProviders = detectedProviders.filter(p => p.hasApiKey);

    if (availableProviders.length > 0 && !options.dryRun) {
      spinner.succeed(`Detected ${availableProviders.length} AI provider(s)`);
      console.log(chalk.cyan(formatDetectedProviders(detectedProviders)));
    } else if (availableProviders.length > 0) {
      spinner.succeed(`Detected ${availableProviders.length} AI provider(s)`);
    } else {
      spinner.info('No AI providers detected in environment, will use Cursor');
    }

    // Determine suggested provider from detection
    const suggestedProvider = availableProviders.length > 0
      ? availableProviders[0].provider
      : 'cursor';

    // Analyze codebase and detect framework
    spinner.start('Analyzing codebase...');
    let codebaseAnalysis: CodebaseAnalysisResult;
    let selectedFramework: FrameworkPlugin | null = null;

    try {
      codebaseAnalysis = await codebaseAnalyzer.analyze('create', undefined);
      const detectedFramework = codebaseAnalysis.framework || 'generic';
      selectedFramework = codebaseAnalysis.frameworkPlugin || null;

      // If no framework plugin from analysis, try detection
      if (!selectedFramework) {
        const detectedFrameworks = await frameworkLoader.detectAllFrameworks();
        if (detectedFrameworks.length === 0) {
          selectedFramework = frameworkLoader.getBuiltinFramework('generic')!;
        } else if (detectedFrameworks.length === 1) {
          selectedFramework = detectedFrameworks[0];
        } else {
          // Multiple frameworks - prompt for selection
          spinner.stop();
          const frameworkNames = detectedFrameworks.map(f => f.name);
          const selectedName = await interactivePrompts.askQuestion({
            id: 'framework-selection',
            type: 'multiple-choice',
            text: 'Multiple frameworks detected. Select primary framework:',
            options: frameworkNames,
            default: frameworkNames[0],
            required: true,
          });
          selectedFramework = detectedFrameworks.find(f => f.name === selectedName) || detectedFrameworks[0];
          spinner.start('Processing...');
        }
      }

      spinner.succeed(`Framework detected: ${selectedFramework.name}`);

      // Display framework info
      if (selectedFramework && selectedFramework.name !== 'generic') {
        console.log(chalk.cyan(`  ${selectedFramework.description || 'No description available'}`));
      }
    } catch (error) {
      spinner.warn('Codebase analysis failed, using generic framework');
      selectedFramework = frameworkLoader.getBuiltinFramework('generic')!;
      codebaseAnalysis = {
        projectRoot: process.cwd(),
        framework: 'generic',
        relevantFiles: [],
        fileContexts: new Map(),
        codebaseContext: '',
      };
    }

    // Load constitution for spec-kit integration
    let constitution = null;
    let constitutionParser: ConstitutionParser | null = null;
    let constitutionAnalysis: ConstitutionAnalysis | null = null;

    try {
      constitutionParser = new ConstitutionParser({
        projectRoot: process.cwd(),
        debug: options.debug || false,
      });

      spinner.start('Loading project constitution...');
      let parsedConstitution = await constitutionParser.parse('.cursorrules');

      // Merge constitution with framework rules if framework detected
      if (selectedFramework && constitutionParser) {
        parsedConstitution = constitutionParser.mergeWithFramework(parsedConstitution, selectedFramework);
      }
      constitution = parsedConstitution;

      if (constitution.constraints.length > 0 || constitution.patterns.length > 0) {
        spinner.succeed(`Loaded ${constitution.constraints.length} constraints, ${constitution.patterns.length} patterns from .cursorrules`);

        // Analyze constitution for config hints
        constitutionAnalysis = analyzeConstitutionForConfig(constitution, {
          projectRoot: process.cwd(),
          debug: options.debug || false,
        });

        if (options.debug) {
          console.log(chalk.gray('\nConstitution Analysis:'));
          console.log(chalk.gray(`  - Editable paths: ${constitutionAnalysis.editablePaths.length}`));
          console.log(chalk.gray(`  - Protected paths: ${constitutionAnalysis.protectedPaths.length}`));
          console.log(chalk.gray(`  - Tool requirements: ${constitutionAnalysis.toolRequirements.join(', ') || 'none'}`));
          console.log(chalk.gray(`  - Framework hints: ${constitutionAnalysis.frameworkHints.join(', ') || 'none'}`));
        }
      } else {
        spinner.info('No constitution rules found in .cursorrules');
      }
    } catch (error) {
      spinner.info('No constitution file found, skipping spec-kit integration');
    }

    // Check for existing config and prompt for overwrite
    if (hasExistingConfig && !options.dryRun) {
      spinner.stop();
      const overwriteAnswer = await interactivePrompts.askQuestion({
        id: 'overwrite-config',
        type: 'confirm',
        text: 'Config file already exists. Overwrite existing config file?',
        default: false,
        required: true,
      });

      if (!overwriteAnswer) {
        spinner.info('Cancelled');
        return;
      }
      spinner.start('Continuing...');
    }

    spinner.stop();

    // Build comprehensive config suggestions from analysis
    spinner.start('Building config from analysis...');
    let configSuggestions: Partial<Config> = buildCompleteConfigFromAnalysis({
      codebaseAnalysis,
      framework: selectedFramework,
      constitution: constitutionAnalysis,
      projectRoot: process.cwd(),
    });

    // Merge constitution analysis suggestions
    if (constitutionAnalysis) {
      const constitutionSuggestions = analysisToConfigSuggestions(constitutionAnalysis);
      configSuggestions = mergeConfigSuggestions(configSuggestions, constitutionSuggestions);
    }

    // Pre-set suggested AI provider from environment detection
    if (!configSuggestions.ai) {
      configSuggestions.ai = {
        provider: suggestedProvider,
        model: getDefaultModel(suggestedProvider),
      };
    } else if (availableProviders.length > 0) {
      // Override with detected provider if available
      configSuggestions.ai.provider = suggestedProvider;
      configSuggestions.ai.model = getDefaultModel(suggestedProvider);
    }

    spinner.succeed('Config suggestions built from analysis');

    let aiProvider: AIProvider | null = null;

    // In dry-run mode, skip AI prompts and use defaults
    const useAI = options.dryRun ? false : (await interactivePrompts.askQuestion({
      id: 'use-ai-suggestions',
      type: 'confirm',
      text: 'Use AI to enhance config suggestions with deeper analysis?',
      default: true,
      required: true,
    })) as boolean;

    if (useAI) {
      spinner.start('AI analyzing codebase patterns...');

      // Get framework defaults first
      const frameworkDefaults = (selectedFramework && typeof selectedFramework.getDefaultConfig === 'function')
        ? selectedFramework.getDefaultConfig()
        : {};

      // For AI suggestions, we need an AI provider
      // Use a default minimal config for now (user will select provider later)
      const tempConfig: Partial<Config> = {
        ai: {
          provider: 'anthropic', // Default for suggestions
          model: 'claude-sonnet-4-20250514',
        },
      };

      try {
        aiProvider = AIProviderFactory.create(tempConfig as Config);

        // Build AI prompt for config generation
        const codebaseContext = codebaseAnalysis.codebaseContext || '';
        const relevantFiles = codebaseAnalysis.relevantFiles.slice(0, 20).join('\n');

        const constitutionContext = constitution
          ? `\n\nConstitution Constraints:\n${constitution.constraints.slice(0, 10).join('\n')}\n\nConstitution Patterns:\n${constitution.patterns.slice(0, 5).map(p => `${p.pattern} (when: ${p.when})`).join('\n')}`
          : '';

        const configPrompt = `Analyze this codebase and generate a COMPLETE dev-loop configuration matching the full dev-loop config schema.

Codebase Context:
${codebaseContext}

Key Files:
${relevantFiles}

Detected Framework: ${selectedFramework?.name || 'generic'}
Detected AI Provider: ${suggestedProvider}

Framework Defaults:
${JSON.stringify(frameworkDefaults, null, 2)}

Current Config Suggestions (enhance these):
${JSON.stringify(configSuggestions, null, 2)}
${constitutionContext}

IMPORTANT: Generate a COMPLETE config including ALL relevant sections:
- testing (runner, command, timeout, artifactsDir - from test patterns)
- validation (enabled, baseUrl, urls, timeout, authCommand - from test files and framework)
- logs (sources with type/path/command, patterns, ignorePatterns, useAI - from framework)
- hooks (preTest, postApply - from framework cache commands)
- codebase (extensions, searchDirs, excludeDirs, ignoreGlobs, editablePaths, protectedPaths, documentationPaths, filePathPatterns, identifierStopwords)
- framework (type, rules, errorGuidance)
- context (includeSkeleton, includeImports, maxHelperSignatures)
- rules (cursorRulesPath - if .cursorrules detected)
- preValidation (enabled, maxRetries, validateSyntax, validateReferences - if TypeScript/PHP)
- patternLearning (enabled, patternsPath, useBuiltinPatterns)
- autonomous (enabled, skipInvestigation, maxIterations, etc.)
- prdBuilding (preProductionDir, productionDir, refinement, learningFiles, specKit)

Analyze the codebase thoroughly and return ONLY valid JSON matching the dev-loop Config schema.
Do not include explanatory text, only the JSON configuration object.`;

        const aiResponse = await aiProvider.generateCode(configPrompt, {
          task: { id: 'init', title: 'Generate dev-loop config', description: 'Initial config generation', status: 'pending', priority: 'medium' },
        });

        // Parse AI response to extract config suggestions
        const suggestionsText = aiResponse.files[0]?.content || '';
        try {
          // Extract JSON from markdown code blocks if present
          const jsonMatch = suggestionsText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) ||
                           suggestionsText.match(/(\{[\s\S]*\})/);
          if (jsonMatch) {
            configSuggestions = JSON.parse(jsonMatch[1]);
          }
        } catch (parseError) {
          console.warn(chalk.yellow('Could not parse AI config suggestions, using framework defaults'));
        }
      } catch (aiError) {
        console.warn(chalk.yellow('AI analysis failed, using framework defaults only'));
      }

      spinner.succeed('AI analysis complete');
    } else {
      // Use framework defaults only
      const frameworkDefaults = (selectedFramework && typeof selectedFramework.getDefaultConfig === 'function')
        ? selectedFramework.getDefaultConfig()
        : {};
      configSuggestions = {
        testing: {
          runner: (frameworkDefaults.testRunner as any) || 'playwright',
          command: frameworkDefaults.testCommand || 'npm test',
          timeout: 300000,
          artifactsDir: 'test-results',
        },
      };
    }

    // Display suggestions if available
    if (Object.keys(configSuggestions).length > 0 && !options.dryRun) {
      console.log(chalk.yellow('\nSuggested configuration:'));
      console.log(chalk.gray(JSON.stringify(configSuggestions, null, 2)));

      const useSuggestions = await interactivePrompts.askQuestion({
        id: 'use-suggestions',
        type: 'confirm',
        text: 'Use these configuration suggestions?',
        default: true,
        required: true,
      });

      if (!useSuggestions) {
        configSuggestions = {};
      }
    } else if (options.dryRun && Object.keys(configSuggestions).length > 0) {
      console.log(chalk.yellow('\nSuggested configuration:'));
      console.log(chalk.gray(JSON.stringify(configSuggestions, null, 2)));
    }

    // Process framework-specific questionnaire if available (only in interactive mode)
    if (!options.dryRun && selectedFramework && typeof selectedFramework.getInitQuestionnaire === 'function') {
      const questionnaire = selectedFramework.getInitQuestionnaire();
      if (questionnaire && questionnaire.questions && questionnaire.questions.length > 0) {
        console.log(chalk.cyan('\n📋 Framework-specific configuration:'));
        const questionAnswers: Record<string, any> = {};

        for (const question of questionnaire.questions) {
          // Check dependencies
          if (question.dependsOn && !questionAnswers[question.dependsOn]) {
            continue; // Skip if dependency not met
          }

          let answer: any;
          if (question.type === 'confirm') {
            answer = await interactivePrompts.askQuestion({
              id: `framework-${question.id}`,
              text: question.question,
              type: 'confirm',
              default: question.default as boolean,
              required: false,
            });
          } else if (question.type === 'multiple-choice' && question.options) {
            answer = await interactivePrompts.askQuestion({
              id: `framework-${question.id}`,
              text: question.question,
              type: 'multiple-choice',
              options: question.options,
              default: question.default as string,
              required: false,
            });
          } else {
            answer = await interactivePrompts.askQuestion({
              id: `framework-${question.id}`,
              text: question.question,
              type: 'open-ended',
              default: question.default as string,
              required: false,
            });
          }

          questionAnswers[question.id] = answer;
        }

        // Validate answers
        for (const rule of questionnaire.validationRules || []) {
          const result = rule.validate(questionAnswers);
          if (result !== true) {
            console.log(chalk.yellow(`  ⚠ ${result}`));
          }
        }

        // Generate config from answers and merge into suggestions
        for (const generator of questionnaire.configGenerators || []) {
          const generatedConfig = generator.generate(questionAnswers, selectedFramework);
          configSuggestions = mergeConfigSuggestions(configSuggestions, generatedConfig);
        }

        console.log(chalk.green('  ✓ Framework configuration complete'));
      }
    }

    // In dry-run mode, use defaults; otherwise prompt
    const useSpecKit = options.dryRun ? !!constitution : (await interactivePrompts.askQuestion({
      id: 'enable-spec-kit',
      type: 'confirm',
      text: 'Enable spec-kit integration for intelligent clarification and research?',
      default: !!constitution,
      required: true,
    })) as boolean;

    // Get user input via prompts (with suggestions pre-filled)
    // In dry-run mode, use defaults from suggestions/framework
    const answers = options.dryRun
      ? await getDefaultAnswers(configSuggestions, selectedFramework, codebaseAnalysis, suggestedProvider)
      : await promptInitConfig({
          suggestions: configSuggestions,
          framework: selectedFramework || undefined,
          codebaseAnalysis,
          interactivePrompts,
        });

    // Override template source if provided via CLI
    if (options.template) {
      answers.templateSource = options.template as any;
    }

    // Prompt for recent features (use defaults in dry-run mode)
    const enableAIPatterns = options.dryRun ? false : (await interactivePrompts.askQuestion({
      id: 'enable-ai-patterns',
      type: 'confirm',
      text: 'Enable AI pattern detection for code analysis?',
      default: false,
      required: true,
    })) as boolean;

    const enablePatternLearning = options.dryRun ? true : (await interactivePrompts.askQuestion({
      id: 'enable-pattern-learning',
      type: 'confirm',
      text: 'Enable pattern learning from past executions?',
      default: true,
      required: true,
    })) as boolean;

    const enableAutonomous = options.dryRun ? true : (await interactivePrompts.askQuestion({
      id: 'enable-autonomous',
      type: 'confirm',
      text: 'Enable autonomous mode (skip investigation tasks, auto-retry)?',
      default: true,
      required: true,
    })) as boolean;

    const enablePrdBuilding = options.dryRun ? true : (await interactivePrompts.askQuestion({
      id: 'enable-prd-building',
      type: 'confirm',
      text: 'Configure PRD building features (refinement, learning files)?',
      default: true,
      required: true,
    })) as boolean;

    const enableEventMonitoring = options.dryRun ? false : (await interactivePrompts.askQuestion({
      id: 'enable-event-monitoring',
      type: 'confirm',
      text: 'Enable MCP event monitoring for proactive intervention? (Advanced)',
      default: false,
      required: true,
    })) as boolean;

    // Build config object matching latest schema
    const config: Config = {
      debug: options.debug || false,
      metrics: {
        enabled: true,
        path: '.devloop/metrics.json',
      },
      ai: {
        provider: answers.aiProvider,
        model: answers.aiModel,
        fallback: answers.aiFallback,
      },
      templates: {
        source: answers.templateSource,
        customPath: answers.customTemplatePath,
      },
      testing: answers.testing || configSuggestions?.testing || {
        runner: answers.testRunner,
        command: answers.testCommand,
        timeout: answers.testTimeout,
        artifactsDir: answers.artifactsDir,
      },
      logs: answers.logs || configSuggestions?.logs || {
        sources: answers.logSources || [],
        patterns: {
          error: /Error|Exception|Fatal/i,
          warning: /Warning|Deprecated/i,
        },
        useAI: true,
      },
      intervention: {
        mode: answers.interventionMode,
        approvalRequired: Array.isArray(answers.approvalRequired)
          ? answers.approvalRequired
          : typeof answers.approvalRequired === 'string'
          ? [answers.approvalRequired]
          : [],
      },
      taskMaster: {
        tasksPath: answers.tasksPath || '.taskmaster/tasks/tasks.json',
      },
      framework: selectedFramework && selectedFramework.name !== 'generic' ? {
        type: selectedFramework.name,
      } : undefined,
    };

    // Add optional sections based on user selections and suggestions
    if (configSuggestions.codebase || codebaseAnalysis.relevantFiles.length > 0) {
      const codebaseConfig = configSuggestions.codebase || {};
      config.codebase = {
        extensions: codebaseConfig.extensions || codebaseAnalysis.relevantFiles
          .map(f => path.extname(f).slice(1))
          .filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i),
        searchDirs: codebaseConfig.searchDirs || (selectedFramework && typeof selectedFramework.getSearchDirs === 'function' ? selectedFramework.getSearchDirs() : undefined) || ['src'],
        excludeDirs: codebaseConfig.excludeDirs || (selectedFramework && typeof selectedFramework.getExcludeDirs === 'function' ? selectedFramework.getExcludeDirs() : undefined) || ['node_modules'],
      };

      // Add documentation paths if detected
      const docPaths: string[] = [];
      const docIndicators = ['docs/', 'README.md', '.md'];
      for (const file of codebaseAnalysis.relevantFiles) {
        if (docIndicators.some(ind => file.includes(ind))) {
          const dir = path.dirname(file);
          if (dir && !docPaths.includes(dir)) {
            docPaths.push(dir);
          }
        }
      }
      if (docPaths.length > 0) {
        config.codebase.documentationPaths = docPaths;
      }
    }

    // Add framework-specific sections
    if (selectedFramework?.name === 'drupal') {
      const drupalConfig = (configSuggestions as any)?.drupal || {
        enabled: true,
        cacheCommand: selectedFramework.getCacheCommand?.() || 'ddev exec drush cr',
      };
      (config as any).drupal = drupalConfig;
    }

    // Add spec-kit config if enabled
    if (useSpecKit && constitution) {
      config.prdBuilding = {
        ...config.prdBuilding,
        preProductionDir: '.taskmaster/pre-production',
        productionDir: '.taskmaster/production',
        specKit: {
          autoAnswerThreshold: 0.85,
          skipIfHighConfidence: true,
          inferParallelFromDependencies: true,
          constitutionDrivenQuestions: true,
        },
      };
    }

    // Add PRD building features if enabled
    if (enablePrdBuilding) {
      config.prdBuilding = {
        ...config.prdBuilding,
        preProductionDir: '.taskmaster/pre-production',
        productionDir: '.taskmaster/production',
        refinement: {
          interactive: true,
          askPrePhaseQuestions: true,
          askMidPhaseQuestions: true,
          askPostPhaseQuestions: true,
          maxRefinementIterations: 3,
          showCodebaseInsights: true,
          semanticDiscovery: {
            enabled: true,
            minScore: 0.6,
            maxResults: 10,
            cacheEmbeddings: true,
          },
        },
        learningFiles: {
          enabled: true,
          patterns: '.devloop/patterns.json',
          observations: '.devloop/observations.json',
          testResults: '.devloop/test-results.json',
          prdSetState: '.devloop/execution-state.json',
          filtering: {
            patternsRetentionDays: 180,
            observationsRetentionDays: 180,
            testResultsRetentionDays: 180,
            prdStateRetentionDays: 90,
            relevanceThreshold: 0.5,
            autoPrune: true,
          },
        },
        ...config.prdBuilding,
      };
    }

    // Add pattern learning if enabled
    if (enablePatternLearning) {
      config.patternLearning = {
        enabled: true,
        patternsPath: '.devloop/patterns.json',
        useBuiltinPatterns: true,
      };
    }

    // Add autonomous mode if enabled
    if (enableAutonomous) {
      config.autonomous = {
        enabled: true,
        skipInvestigation: true,
        skipPrerequisiteValidation: false,
        maxIterations: 100,
        maxTaskRetries: 3,
        stuckDetectionWindow: 300000,
        contextPath: '.devloop/context.json',
        maxHistoryIterations: 10,
        testEvolutionInterval: 5,
        learnFromSuccess: true,
        learnFromFailure: true,
        testGeneration: {
          framework: (config.testing.runner as any) || 'playwright',
          testDir: 'tests/playwright/auto',
        },
      };
    }

    // Add AI pattern detection if enabled
    if (enableAIPatterns) {
      config.aiPatterns = {
        enabled: true,
        provider: 'auto',
        providers: {
          anthropic: {
            model: 'claude-3-haiku-20240307',
            embeddingModel: 'voyage-3',
          },
          openai: {
            model: 'gpt-4o-mini',
            embeddingModel: 'text-embedding-3-small',
          },
        },
        analysis: {
          mode: 'hybrid',
          similarityThreshold: 0.85,
          minOccurrences: 3,
        },
      };
    }

    // Add MCP event monitoring if enabled
    if (enableEventMonitoring) {
      config.mcp = {
        eventMonitoring: {
          enabled: true,
          pollingInterval: 5000,
          actions: {
            requireApproval: [],
            autoExecute: [],
            maxInterventionsPerHour: 10,
          },
        },
        contributionMode: {
          enabled: true,
        },
      };
    }

    // Validate final config
    try {
      validateConfig(config);
    } catch (validationError: any) {
      spinner.fail('Configuration validation failed');
      console.error(chalk.red('Configuration validation error:'));
      console.error(validationError.message || validationError);
      process.exit(1);
    }

    // Handle dry-run mode
    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan('\n=== Generated devloop.config.js (DRY RUN) ===\n'));
      console.log(formatConfigForOutput(config));
      console.log(chalk.cyan('\n=== End of Generated Config ===\n'));

      // Compare with existing config if available
      if (hasExistingConfig) {
        await compareWithExistingConfig(config, configPath);
      }

      spinner.info('Dry-run complete - no files were written');
      return;
    }

    // Write config file
    const configContent = formatConfigAsModule(config);
    await fs.writeFile(configPath, configContent, 'utf-8');

    console.log(chalk.green('✓ Configuration file created: devloop.config.js'));
    console.log(chalk.cyan('\nNext steps:'));
    console.log(chalk.gray('  1. Review and customize devloop.config.js'));
    console.log(chalk.gray('  2. Set up your AI provider API keys in environment variables'));
    console.log(chalk.gray('  3. Run "dev-loop run" to start the workflow'));
  } catch (error) {
    spinner.fail('Failed to initialize configuration');
    console.error(error);
    process.exit(1);
  }
}
