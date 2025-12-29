import chalk from 'chalk';
import * as path from 'path';
import { loadConfig } from '../../config/loader';
import { DebugMetrics } from '../../core/debug-metrics';
import { ObservationTracker, Observation } from '../../core/observation-tracker';
import { ImprovementSuggester, ImprovementSuggestion } from '../../core/improvement-suggester';

export async function evolveCommand(options: {
  config?: string;
  projectType?: string;
  json?: boolean;
}): Promise<void> {
  try {
    const config = await loadConfig(options.config);
    const debug = (config as any).debug || false;
    const metricsPath = (config as any).metrics?.path || '.devloop/metrics.json';

    const metrics = new DebugMetrics(metricsPath);
    const observationTracker = new ObservationTracker('.devloop/observations.json', debug);
    const improvementSuggester = new ImprovementSuggester(debug);

    const metricsData = metrics.getMetrics();

    // Analyze metrics to generate observations
    const observations = await observationTracker.analyzeMetrics(metricsData);

    // Get existing observations
    const existingObservations = await observationTracker.getObservations(options.projectType);

    // Combine new and existing observations
    const allObservations = [...observations, ...existingObservations];

    // Remove duplicates based on ID
    const uniqueObservations = Array.from(
      new Map(allObservations.map(obs => [obs.id, obs])).values()
    );

    // Generate improvement suggestions
    const suggestions = await improvementSuggester.analyze(uniqueObservations, metricsData);

    if (options.json) {
      console.log(JSON.stringify({
        observations: uniqueObservations,
        suggestions,
        metrics: {
          totalRuns: metricsData.summary.totalRuns,
          successRate: metricsData.summary.successRate,
        },
      }, null, 2));
      return;
    }

    // Display insights
    printInsights(uniqueObservations, suggestions, metricsData, options.projectType);
  } catch (error) {
    console.error(chalk.red(`Failed to load evolution insights: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

function printInsights(
  observations: Observation[],
  suggestions: ImprovementSuggestion[],
  metrics: any,
  projectType?: string
): void {
  console.log(chalk.cyan.bold('🔬 Evolution Insights'));
  console.log(chalk.gray('='.repeat(60)));

  if (projectType) {
    console.log(chalk.yellow(`Filtered by project type: ${projectType}`));
    console.log('');
  }

  // Metrics summary
  console.log(chalk.cyan.bold('📊 Metrics Summary'));
  console.log(`  Total runs: ${chalk.white.bold(metrics.summary.totalRuns)}`);
  console.log(`  Success rate: ${chalk.white.bold((metrics.summary.successRate * 100).toFixed(1))}%`);
  console.log(`  Total tokens: ${chalk.white.bold((metrics.summary.totalTokensInput + metrics.summary.totalTokensOutput).toLocaleString())}`);
  console.log('');

  // Observations
  if (observations.length === 0) {
    console.log(chalk.yellow('No observations yet. Run dev-loop a few times to generate insights.'));
    console.log('');
  } else {
    console.log(chalk.cyan.bold(`🔍 Observations (${observations.length})`));
    console.log('');

    // Group by type
    const byType = observations.reduce((acc, obs) => {
      if (!acc[obs.type]) acc[obs.type] = [];
      acc[obs.type].push(obs);
      return acc;
    }, {} as Record<string, Observation[]>);

    for (const [type, obsList] of Object.entries(byType)) {
      console.log(chalk.gray(`  ${type.toUpperCase().replace(/-/g, ' ')}:`));
      for (const obs of obsList.slice(0, 5)) {
        const severityColor = obs.severity === 'high' ? chalk.red : obs.severity === 'medium' ? chalk.yellow : chalk.gray;
        console.log(`    ${severityColor(obs.severity.toUpperCase())} ${obs.description}`);
        console.log(`      Occurrences: ${obs.occurrences} | Projects: ${obs.affectedProjects.join(', ') || 'N/A'}`);
        if (obs.evidence && obs.evidence.length > 0) {
          console.log(`      Evidence: ${obs.evidence[0]}`);
        }
        console.log('');
      }
      if (obsList.length > 5) {
        console.log(chalk.gray(`    ... and ${obsList.length - 5} more`));
        console.log('');
      }
    }
  }

  // Improvement suggestions
  if (suggestions.length === 0) {
    console.log(chalk.yellow('No improvement suggestions at this time.'));
    console.log('');
  } else {
    console.log(chalk.cyan.bold(`💡 Improvement Suggestions (${suggestions.length})`));
    console.log('');

    // Group by category
    const byCategory = suggestions.reduce((acc, sug) => {
      if (!acc[sug.category]) acc[sug.category] = [];
      acc[sug.category].push(sug);
      return acc;
    }, {} as Record<string, ImprovementSuggestion[]>);

    for (const [category, sugList] of Object.entries(byCategory)) {
      console.log(chalk.gray(`  ${category.toUpperCase()}:`));
      for (const sug of sugList) {
        const priorityColor = sug.priority === 'high' ? chalk.red.bold : sug.priority === 'medium' ? chalk.yellow.bold : chalk.gray.bold;
        console.log(`    ${priorityColor(`[${sug.priority.toUpperCase()}]`)} ${chalk.white.bold(sug.title)}`);
        console.log(`      ${sug.description}`);
        console.log(`      ${chalk.cyan('Action:')} ${sug.suggestedAction}`);
        console.log(`      ${chalk.cyan('Impact:')} ${sug.estimatedImpact}`);
        if (sug.evidence && sug.evidence.length > 0) {
          console.log(`      ${chalk.cyan('Evidence:')} ${sug.evidence.slice(0, 2).join('; ')}`);
        }
        console.log('');
      }
    }
  }

  console.log(chalk.gray('='.repeat(60)));
  console.log(chalk.dim('Use --json to export data for analysis'));
}
