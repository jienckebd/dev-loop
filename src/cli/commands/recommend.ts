import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { FrameworkLoader } from '../../frameworks';
import { PatternLearningSystem } from "../../core/analysis/pattern/learner";
import { ObservationTracker } from "../../core/tracking/observation-tracker";
import { PluginRecommender } from "../../core/analysis/plugin-recommender";
import { CodeQualityScanner } from "../../core/analysis/code/quality-scanner";
import { AbstractionDetector } from "../../core/analysis/code/abstraction-detector";
import { AIProviderManager } from '../../ai/provider-manager';
import { EmbeddingService } from '../../ai/embedding-service';
import { EmbeddingCacheManager } from '../../ai/embedding-cache';
import { PatternClusterer } from '../../ai/pattern-clusterer';
import { SemanticAnalyzer } from '../../ai/semantic-analyzer';
import { FeedbackStore } from '../../ai/feedback-store';
import { AnthropicPatternProvider } from '../../providers/ai/pattern-detection/anthropic';
import { OpenAIPatternProvider } from '../../providers/ai/pattern-detection/openai';
import { OllamaPatternProvider } from '../../providers/ai/pattern-detection/ollama';

export async function recommendCommand(options: {
  source?: 'errors' | 'codebase' | 'both';
  output?: 'console' | 'json';
  applyToConfig?: boolean;
  config?: string;
  ai?: boolean;
  aiMode?: 'embeddings-only' | 'llm-only' | 'hybrid';
  similarity?: number;
  incremental?: boolean;
  fullScan?: boolean;
  maxTokens?: number;
  includeAbstraction?: boolean;
}): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const projectRoot = process.cwd();
    const source = options.source || 'both';

    console.log(chalk.bold('\nPlugin Recommendations\n'));
    console.log(chalk.gray('─'.repeat(50)));

    // Load framework
    const frameworkLoader = new FrameworkLoader(projectRoot, config.debug);
    const framework = await frameworkLoader.loadFramework(config.framework?.type);

    console.log(chalk.cyan(`Framework: ${framework.name}\n`));

    // Initialize pattern learner and observation tracker
    const patternLearner = new PatternLearningSystem(undefined, config.debug);
    await patternLearner.load();

    const observationTracker = new ObservationTracker(undefined, config.debug);

    // Create recommender
    const recommender = new PluginRecommender(
      patternLearner,
      observationTracker,
      framework,
      projectRoot,
      config.debug
    );

    let recommendations = await recommender.generateRecommendations();

    // AI-enhanced pattern detection if enabled
    const aiConfig = config.aiPatterns;
    if (options.ai && aiConfig?.enabled) {
      console.log(chalk.cyan('Running AI-enhanced pattern detection...\n'));

      // Initialize AI services
      const providerManager = new AIProviderManager({
        maxTokensPerScan: options.maxTokens || aiConfig.costs?.maxTokensPerScan,
        maxRequestsPerScan: aiConfig.costs?.maxRequestsPerScan,
      });

      // Register providers based on config
      if (aiConfig.providers?.anthropic?.apiKey) {
        providerManager.registerProvider(
          new AnthropicPatternProvider({ apiKey: aiConfig.providers.anthropic.apiKey, model: aiConfig.providers.anthropic.model, embeddingModel: aiConfig.providers.anthropic.embeddingModel }),
          aiConfig.provider === 'anthropic'
        );
      }
      if (aiConfig.providers?.openai?.apiKey) {
        providerManager.registerProvider(
          new OpenAIPatternProvider({ apiKey: aiConfig.providers.openai.apiKey, model: aiConfig.providers.openai.model, embeddingModel: aiConfig.providers.openai.embeddingModel }),
          aiConfig.provider === 'openai'
        );
      }
      if (aiConfig.providers?.ollama) {
        providerManager.registerProvider(
          new OllamaPatternProvider(aiConfig.providers.ollama),
          aiConfig.provider === 'ollama'
        );
      }

      const embeddingCache = new EmbeddingCacheManager(projectRoot);
      await embeddingCache.load();

      const embeddingService = new EmbeddingService(providerManager, embeddingCache);
      const patternClusterer = new PatternClusterer(embeddingService);

      const feedbackStore = aiConfig.learning?.enabled
        ? new FeedbackStore(projectRoot, aiConfig.learning.feedbackFile)
        : undefined;
      if (feedbackStore) {
        await feedbackStore.load();
      }

      const semanticAnalyzer = new SemanticAnalyzer(
        providerManager,
        patternClusterer,
        feedbackStore
      );

      const scanner = new CodeQualityScanner(config.debug);
      const detector = new AbstractionDetector(
        scanner,
        embeddingService,
        semanticAnalyzer,
        patternClusterer,
        config.debug
      );

      // Run AI detection
      const aiMode = options.aiMode || aiConfig.analysis?.mode || 'hybrid';
      const useLLM = aiMode === 'llm-only' || aiMode === 'hybrid';

      const aiPatterns = await detector.detectPatternsWithAI({
        projectRoot,
        useAI: true,
        useLLMAnalysis: useLLM,
        similarityThreshold: options.similarity || aiConfig.analysis?.similarityThreshold,
        minOccurrences: aiConfig.analysis?.minOccurrences,
        maxTokensPerScan: options.maxTokens || aiConfig.costs?.maxTokensPerScan,
        incrementalOnly: options.incremental && !options.fullScan,
      });

      // Convert patterns to recommendations
      if (aiPatterns.length > 0) {
        console.log(chalk.green(`Found ${aiPatterns.length} AI-detected patterns\n`));
        // Add AI patterns as abstraction recommendations (cast to any to avoid TS issues with extended properties)
        for (const pattern of aiPatterns) {
          (recommendations as any[]).push({
            type: 'abstraction-pattern',
            trigger: `AI detected ${pattern.occurrences} similar patterns`,
            suggestion: pattern.suggestedName || 'Abstract pattern',
            evidence: pattern.evidence,
            priority: pattern.similarity > 0.9 ? 'high' : pattern.similarity > 0.7 ? 'medium' : 'low',
            pattern,
            implementation: {
              type: pattern.suggestedAbstraction,
              name: pattern.suggestedName || 'AbstractPattern',
              description: `Abstraction for ${pattern.occurrences} similar patterns`,
            },
            impact: {
              codeReduction: pattern.occurrences * 10, // Estimate
              filesAffected: pattern.files.length,
              maintenanceBenefit: pattern.similarity > 0.9 ? 'high' : pattern.similarity > 0.7 ? 'medium' : 'low',
            },
          });
        }
      }

      // Save cache
      await embeddingCache.save();
    }

    // Generate recommendations
    console.log(chalk.cyan('Analyzing patterns...\n'));

    if (recommendations.length === 0) {
      console.log(chalk.yellow('No recommendations found.'));
      return;
    }

    // Display recommendations
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.bold(`Found ${recommendations.length} Recommendation(s)\n`));

    for (const rec of recommendations) {
      const priorityColor = rec.priority === 'high' ? chalk.red : rec.priority === 'medium' ? chalk.yellow : chalk.gray;
      console.log(`${priorityColor(`[${rec.priority.toUpperCase()}]`)} ${chalk.cyan(rec.type)}`);
      console.log(`  Trigger: ${rec.trigger}`);
      console.log(`  Suggestion: ${rec.suggestion}`);
      if (rec.evidence.length > 0) {
        console.log(`  Evidence:`);
        for (const evidence of rec.evidence) {
          console.log(`    - ${evidence}`);
        }
      }
      console.log('');
    }

    // Save JSON output if requested
    if (options.output === 'json') {
      const outputPath = path.join(projectRoot, '.devloop', 'recommendations.json');
      await fs.ensureDir(path.dirname(outputPath));
      await fs.writeFile(
        outputPath,
        JSON.stringify({ recommendations, timestamp: new Date().toISOString() }, null, 2),
        'utf-8'
      );
      console.log(chalk.green(`\nRecommendations saved to ${outputPath}`));
    }

    // Apply to config if requested
    if (options.applyToConfig) {
      console.log(chalk.cyan('\nApplying recommendations to config...\n'));

      const configPath = path.join(projectRoot, 'devloop.config.js');
      if (!(await fs.pathExists(configPath))) {
        console.log(chalk.yellow('devloop.config.js not found. Skipping auto-apply.'));
        return;
      }

      // For now, just log what would be applied
      // Full implementation would parse and modify the config file
      console.log(chalk.yellow('Auto-apply to config not yet implemented.'));
      console.log(chalk.gray('Please manually add recommendations to devloop.config.js'));
    }
  } catch (error) {
    console.error(chalk.red('Recommendation generation failed:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
