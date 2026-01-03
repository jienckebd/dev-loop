import chalk from 'chalk';
import * as fs from 'fs-extra';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { FeedbackStore } from '../../ai/feedback-store';
import { AbstractionRecommendation } from '../../frameworks/interface';

export async function feedbackCommand(
  recommendationId: string,
  options: {
    accept?: boolean;
    reject?: boolean;
    notes?: string;
    implementation?: string;
    config?: string;
  }
): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const projectRoot = process.cwd();

    if (!config.aiPatterns?.enabled) {
      console.error(chalk.red('AI pattern features are not enabled in config.'));
      process.exit(1);
    }

    if (!config.aiPatterns.learning?.enabled) {
      console.error(chalk.red('AI learning is not enabled in config.'));
      process.exit(1);
    }

    // Load feedback store
    const feedbackStore = new FeedbackStore(
      projectRoot,
      config.aiPatterns.learning.feedbackFile
    );
    await feedbackStore.load();

    // Try to find the recommendation
    const recommendationsPath = path.join(projectRoot, '.devloop', 'recommendations.json');
    if (!(await fs.pathExists(recommendationsPath))) {
      console.error(chalk.red('No recommendations file found. Run "dev-loop recommend" first.'));
      process.exit(1);
    }

    const recommendationsData = await fs.readJson(recommendationsPath);
    const recommendation = recommendationsData.recommendations?.find(
      (r: any) => r.pattern?.id === recommendationId || r.id === recommendationId
    );

    if (!recommendation) {
      console.error(chalk.red(`Recommendation with ID "${recommendationId}" not found.`));
      process.exit(1);
    }

    // Determine feedback type
    let feedback: 'accepted' | 'rejected' | 'modified' = 'accepted';
    if (options.reject) {
      feedback = 'rejected';
    } else if (options.implementation) {
      feedback = 'modified';
    }

    // Record feedback
    const entry = {
      id: recommendationId,
      timestamp: Date.now(),
      recommendation: recommendation as AbstractionRecommendation,
      feedback,
      userNotes: options.notes,
      actualImplementation: options.implementation,
    };

    await feedbackStore.recordFeedback(entry);

    console.log(chalk.green(`\nFeedback recorded: ${feedback}`));
    if (options.notes) {
      console.log(chalk.gray(`Notes: ${options.notes}`));
    }

    console.log(chalk.cyan('\nThis feedback will improve future AI recommendations.'));
  } catch (error) {
    console.error(chalk.red('Failed to record feedback:'));
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}
