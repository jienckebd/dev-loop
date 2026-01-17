import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { FrameworkLoader } from '../../frameworks';
import { PatternLearningSystem } from "../../core/analysis/pattern/learner";
import { ObservationTracker } from "../../core/tracking/observation-tracker";
import { PluginRecommender } from "../../core/analysis/plugin-recommender";
import { logger } from '../../core/utils/logger';

// Note: AI pattern detection has been migrated to LangChain.
// The --ai flag now uses LangChain structured output instead of legacy pattern-detection providers.

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
